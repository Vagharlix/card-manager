import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabases, type TestDatabases } from './helpers/testDb'
import { createSeeder } from './helpers/seed'

// ============================================================
// Transport Google Drive + compte Google, contre un faux Drive qui
// implémente les routes réellement utilisées (liste appDataFolder, ETag
// via l'API v2, écriture If-Match → 412, création multipart, jetons).
// ============================================================

vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-pc')
vi.stubEnv('VITE_GOOGLE_CLIENT_SECRET', 'secret-pc')

const h = vi.hoisted(() => ({ dbs: null as unknown as TestDatabases }))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const { DriveTransport, SYNC_FILE } = await import('~/services/userSync/drive')
const google = await import('~/services/userSync/google')
const { syncNow } = await import('~/services/userSync')
const { addCard } = await import('~/services/collection')

type Req = { method: string; url: string; headers: [string, string][]; body?: string }

class FakeGoogle {
  files = new Map<
    string,
    { name: string; created: string; etag: string; content: string; parents: string[] }
  >()
  seq = 0
  log: Req[] = []
  token = 'jeton-valide'
  /** appelé avant chaque requête (simule un autre appareil) */
  before?: (r: Req) => void

  private newId() {
    return `f${++this.seq}`
  }

  create(name: string, content: string) {
    const id = this.newId()
    this.files.set(id, {
      name,
      content,
      parents: ['appDataFolder'],
      created: new Date(Date.UTC(2026, 0, 1, 0, 0, this.seq)).toISOString(),
      etag: `"e${this.seq}"`,
    })
    return id
  }

  fetch = async (method: string, url: string, headers: [string, string][] = [], body?: string) => {
    const req = { method, url, headers, body }
    this.log.push(req)
    this.before?.(req)
    const u = new URL(url)
    const auth = headers.find(([k]) => k === 'Authorization')?.[1]
    const json = (status: number, v: unknown) => ({ status, body: JSON.stringify(v) })

    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token') {
      const p = new URLSearchParams(body)
      if (p.get('refresh_token') === 'revoque') return json(400, { error: 'invalid_grant' })
      return json(200, { access_token: 'jeton-neuf', expires_in: 3600 })
    }
    if (auth !== `Bearer ${this.token}`) return json(401, { error: 'unauthorized' })
    if (u.pathname === '/oauth2/v3/userinfo') return json(200, { email: 'felix@example.com' })

    let m: RegExpMatchArray | null
    if (method === 'GET' && u.pathname === '/drive/v3/files') {
      expect(u.searchParams.get('spaces')).toBe('appDataFolder')
      const name = /name = '([^']+)'/.exec(u.searchParams.get('q') ?? '')?.[1]
      const files = [...this.files.entries()]
        .filter(([, f]) => f.name === name)
        .sort((a, b) => a[1].created.localeCompare(b[1].created))
        .map(([id, f]) => ({ id, createdTime: f.created }))
      return json(200, { files })
    }
    if ((m = u.pathname.match(/^\/drive\/v2\/files\/(\w+)$/)) && method === 'GET') {
      const f = this.files.get(m[1]!)
      return f ? json(200, { etag: f.etag }) : json(404, {})
    }
    if ((m = u.pathname.match(/^\/drive\/v3\/files\/(\w+)$/))) {
      if (method === 'DELETE') {
        this.files.delete(m[1]!)
        return { status: 204, body: '' }
      }
      const f = this.files.get(m[1]!)
      return f ? { status: 200, body: f.content } : json(404, {})
    }
    if ((m = u.pathname.match(/^\/upload\/drive\/v2\/files\/(\w+)$/)) && method === 'PUT') {
      const f = this.files.get(m[1]!)
      if (!f) return json(404, {})
      const ifMatch = headers.find(([k]) => k === 'If-Match')?.[1]
      if (ifMatch !== f.etag) return json(412, { error: 'conditionNotMet' })
      f.content = body!
      f.etag = `"e${++this.seq}"`
      return json(200, u.searchParams.get('fields') === 'etag' ? { etag: f.etag } : { id: m[1] })
    }
    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const boundary = /boundary=(\S+)/.exec(headers.find(([k]) => k === 'Content-Type')![1])![1]
      const parts = body!.split(`--${boundary}`).slice(1, 3)
      const meta = JSON.parse(parts[0]!.split('\r\n\r\n')[1]!.trim())
      const content = parts[1]!.split('\r\n\r\n')[1]!.replace(/\r\n$/, '')
      expect(meta.parents).toEqual(['appDataFolder'])
      return json(200, { id: this.create(meta.name, content) })
    }
    return json(404, { error: `route inconnue ${method} ${url}` })
  }
}

let g: FakeGoogle
let pc: TestDatabases
let phone: TestDatabases
const token = async () => g.token
const transport = () => new DriveTransport(token, g.fetch)

function device() {
  const dbs = createTestDatabases()
  createSeeder(dbs).card('46986414', 'Dark Magician')
  createSeeder(dbs).card('55144522', 'Pot of Greed')
  return dbs
}

async function on<T>(dbs: TestDatabases, fn: () => Promise<T>) {
  h.dbs = dbs
  return fn()
}

beforeEach(() => {
  g = new FakeGoogle()
  pc = device()
  phone = device()
})

afterEach(() => {
  for (const d of [pc, phone]) {
    d.user.close()
    d.ygo.close()
  }
})

describe('transport Drive', () => {
  it('rien de publié → null ; première publication = un fichier dans le dossier caché', async () => {
    expect(await transport().pull()).toBeNull()
    const snap = { protocol: 1, schema: 9, deviceId: 'a', createdAt: '', tables: {} }
    expect(await transport().push(snap, null)).toEqual({ ok: true, version: null })
    const [file] = [...g.files.values()]
    expect(file).toMatchObject({ name: SYNC_FILE, parents: ['appDataFolder'] })
    const pulled = await transport().pull()
    expect(pulled?.snapshot).toEqual(snap)
    expect(pulled?.version).toMatch(/^f1\|"e1"$/)
  })

  it('écriture avec un ETag périmé : refusée (412), le fichier n’est pas écrasé', async () => {
    const id = g.create(SYNC_FILE, '{"v":1}')
    const state = await transport().pull()
    g.files.get(id)!.content = '{"v":2}' // un autre appareil écrit
    g.files.get(id)!.etag = '"autre"'
    const snap = { protocol: 1, schema: 9, deviceId: 'a', createdAt: '', tables: {} }
    expect(await transport().push(snap, state!.version)).toEqual({ ok: false })
    expect(g.files.get(id)!.content).toBe('{"v":2}')
  })

  it('création simultanée sur deux appareils : le plus récent retire le sien', async () => {
    const snap = { protocol: 1, schema: 9, deviceId: 'a', createdAt: '', tables: {} }
    // juste après notre vérification « aucun fichier », un autre appareil crée le sien
    let first = true
    g.before = (r) => {
      if (first && r.method === 'POST' && r.url.includes('/upload/drive/v3/files')) {
        first = false
        g.create(SYNC_FILE, '{"autre":true}')
      }
    }
    expect(await transport().push(snap, null)).toEqual({ ok: false })
    expect([...g.files.values()].map((f) => f.content)).toEqual(['{"autre":true}'])
  })

  it('accès expiré ou retiré : erreur NOT_CONNECTED', async () => {
    const stale = new DriveTransport(async () => 'jeton-expire', g.fetch)
    await expect(stale.pull()).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
  })

  it('l’écriture renvoie la version écrite, celle que relira version()', async () => {
    const id = g.create(SYNC_FILE, '{}')
    const state = await transport().pull()
    const snap = { protocol: 1, schema: 9, deviceId: 'a', createdAt: '', tables: {} }
    const r = await transport().push(snap, state!.version)
    expect(r.ok).toBe(true)
    expect(r.ok && r.version).toBe(await transport().version())
    expect(r.ok && r.version).toMatch(new RegExp(`^${id}\\|`))
  })

  it('synchro sans changement nulle part : aucun téléchargement', async () => {
    await on(pc, () => addCard({ game: 'ygo', cardId: '46986414' }))
    await on(pc, () => syncNow(transport())) // création
    await on(pc, () => syncNow(transport())) // lit et retient la version
    const downloads = () => g.log.filter((r) => r.url.includes('alt=media')).length
    const before = downloads()
    const r = await on(pc, () => syncNow(transport()))
    expect(downloads()).toBe(before)
    expect(r.applied).toEqual({ inserted: 0, updated: 0, deleted: 0 })
    // un autre appareil publie : cette fois on télécharge
    await on(phone, () => syncNow(transport()))
    await on(phone, () => addCard({ game: 'ygo', cardId: '55144522' }))
    await on(phone, () => syncNow(transport()))
    const r2 = await on(pc, () => syncNow(transport()))
    expect(downloads()).toBeGreaterThan(before)
    expect(r2.applied.inserted).toBe(1)
  })

  it('deux appareils synchronisés par Drive convergent', async () => {
    await on(pc, () => addCard({ game: 'ygo', cardId: '46986414' }))
    await on(phone, () => addCard({ game: 'ygo', cardId: '55144522' }))
    await on(pc, () => syncNow(transport()))
    await on(phone, () => syncNow(transport()))
    const r = await on(pc, () => syncNow(transport()))
    expect(r.applied.inserted).toBe(1)
    const cards = (d: TestDatabases) =>
      d.user.raw.prepare(`SELECT card_id FROM collection ORDER BY card_id`).all()
    expect(cards(pc)).toEqual(cards(phone))
    expect(cards(pc)).toHaveLength(2)
    expect(g.files.size).toBe(1)
  })
})

describe('compte Google (PC)', () => {
  const seedAccount = (dbs: TestDatabases, account: object) =>
    dbs.user.raw
      .prepare(`INSERT INTO sync_state (key, value, updated_at) VALUES ('google_account', ?, '')`)
      .run(JSON.stringify(account))

  it('PKCE : défi conforme au vecteur de la RFC 7636', async () => {
    expect(await google.pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    )
  })

  it('jeton encore valide : réutilisé sans appel réseau', async () => {
    h.dbs = pc
    seedAccount(pc, {
      email: 'x',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 3600_000,
    })
    expect(await google.accessToken(g.fetch)).toBe('a')
    expect(g.log).toEqual([])
  })

  it('jeton expiré : renouvelé avec le jeton de renouvellement, puis mémorisé', async () => {
    h.dbs = pc
    seedAccount(pc, { email: 'x', accessToken: 'vieux', refreshToken: 'r', expiresAt: 0 })
    expect(await google.accessToken(g.fetch)).toBe('jeton-neuf')
    const sent = new URLSearchParams(g.log[0]!.body)
    expect(sent.get('grant_type')).toBe('refresh_token')
    expect(sent.get('client_id')).toBe('client-pc')
    expect(await google.accessToken(g.fetch)).toBe('jeton-neuf')
    expect(g.log).toHaveLength(1)
  })

  it('accès retiré chez Google : compte oublié, NOT_CONNECTED', async () => {
    h.dbs = pc
    seedAccount(pc, { email: 'x', refreshToken: 'revoque', expiresAt: 0 })
    await expect(google.accessToken(g.fetch)).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
    expect(await google.googleAccount()).toBeNull()
  })

  it('sans compte : NOT_CONNECTED ; déconnexion : compte oublié', async () => {
    h.dbs = pc
    await expect(google.accessToken(g.fetch)).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
    seedAccount(pc, { email: 'x', accessToken: 'a', refreshToken: 'r', expiresAt: 0 })
    expect(await google.googleAccount()).toEqual({ email: 'x' })
    await google.disconnectGoogle(g.fetch)
    expect(await google.googleAccount()).toBeNull()
  })

  it('synchro disponible quand le build contient l’identifiant Google', () => {
    expect(google.googleAvailable()).toBe(true)
  })
})
