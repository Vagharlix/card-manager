import { invoke } from '@tauri-apps/api/core'
import { useDatabase } from '~/composables/useDatabase'
import {
  syncProgress,
  syncStatus,
  syncError,
  isSyncing,
  syncBlocking,
} from '~/services/cardDataProgress'
import type { CardDataReport } from '~/services/game/modules'
import {
  CARD_COLS,
  ORACLE_COLS,
  PRINT_COLS,
  banRows,
  cardColumns,
  mapRiftbound,
  oracleColumns,
  printColumns,
  printHash,
  type LegalityRow,
  type RiftHuntBulk,
  type RiftHuntCard,
  type RiftHuntSet,
  type RiftboundData,
} from './import'
import { hashString } from '~/utils/hash'

// ============================================================
// MISE À JOUR DE LA BASE RIFTBOUND depuis RiftHunt — incrémentale.
// RiftHunt demande de ne pas télécharger le catalogue plus d'une fois par
// jour, avec un User-Agent qui nomme le projet (commande Rust card_data_get).
//  - Vérification (au plus une fois par AUTO_HOURS au lancement) : la liste
//    des extensions (nombre de cartes par extension, ~2 Ko) et les cartes
//    bannies ou dont le bannissement est annoncé (~50 Ko). Bannissements →
//    écrits aussitôt ; extensions inchangées → rien d'autre.
//  - Mise à jour du catalogue (installation, « Force », extension nouvelle ou
//    complétée, et au moins tous les FULL_DAYS jours pour les errata) :
//    /bulk/cards (~2 Mo) + recherche paginée (10 pages de 175, ~3,6 Mo,
//    PAGE_DELAY_MS entre deux pages), comparés impression par impression
//    (empreintes, card_hashes) : seules les nouvelles / modifiées sont écrites,
//    les disparues supprimées.
// Une transaction : l'ancienne base reste lisible pendant la mise à jour.
// Images : indices envoyés à Rust (image_sources_set) après chaque écriture.
// ============================================================

const API = 'https://api.rifthunt.com'
export const AUTO_HOURS = 24
export const FULL_DAYS = 30
// RiftHunt : « moins de ~10 requêtes/s, une pause entre deux appels »
const PAGE_DELAY_MS = 300
// réponse 429 (trop de requêtes) : nouvel essai après 2, 4, 8, 16 s
const RETRIES = 4
const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

type CardDb = import('@tauri-apps/plugin-sql').default

// ce qu'il faut lire chez RiftHunt (injecté dans les tests)
export interface RiftboundSource {
  sets(): Promise<RiftHuntSet[]>
  bans(): Promise<RiftHuntCard[]>
  bulk(): Promise<RiftHuntBulk>
  // objets « carte » de toutes les impressions des extensions ; onPage = progression
  prints(sets: RiftHuntSet[], onPage?: (done: number, total: number) => void): Promise<RiftHuntCard[]>
}

export interface RiftboundStats {
  changed: number
  removed: number
  unchanged: number
  catalog: boolean // le catalogue a été relu (sinon : bannissements seuls)
}

function setProgress(value: number, status: string) {
  syncProgress.value = value
  syncStatus.value = status
}

async function meta(db: CardDb, key: string): Promise<string | null> {
  const rows = await db.select<{ value: string }[]>(`SELECT value FROM sync_meta WHERE key = ?`, [
    key,
  ])
  return rows[0]?.value ?? null
}

async function setMeta(db: CardDb, entries: [string, string][]): Promise<void> {
  for (const [key, value] of entries)
    await db.execute(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)`, [key, value])
}

export async function localRiftboundVersion(): Promise<string | null> {
  return meta((await useDatabase()).cards('riftbound'), 'db_version')
}

async function insertRows(
  db: CardDb,
  table: string,
  columns: string[],
  rows: unknown[][],
  chunk = 300
): Promise<void> {
  const one = `(${columns.map(() => '?').join(', ')})`
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk)
    await db.execute(
      `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES ${part.map(() => one).join(', ')}`,
      part.flat()
    )
  }
}

async function deleteIds(db: CardDb, table: string, column: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500)
    await db.execute(
      `DELETE FROM ${table} WHERE ${column} IN (${part.map(() => '?').join(', ')})`,
      part
    )
  }
}

// signature de la liste des extensions : change quand une extension sort
// ou que RiftHunt y ajoute des cartes
export function setsSignature(sets: RiftHuntSet[]): string {
  return hashString(
    JSON.stringify(
      sets
        .map((s) => [s.id.toLowerCase(), s.count])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    )
  )
}

export function recentEnough(at: string | null, now: number, ms: number): boolean {
  if (!at) return false
  const t = Date.parse(at)
  return Number.isFinite(t) && now - t < ms
}

// écrit le catalogue (seulement ce qui a changé) ; force = tout réécrire
export async function writeRiftbound(
  db: CardDb,
  data: RiftboundData,
  opts: { force?: boolean; setsSig?: string; now?: Date } = {}
): Promise<Omit<RiftboundStats, 'catalog'>> {
  const at = (opts.now ?? new Date()).toISOString()
  const known = new Map(
    (await db.select<{ card_id: string; hash: string }[]>(`SELECT card_id, hash FROM card_hashes`)).map(
      (r) => [r.card_id, r.hash]
    )
  )
  // base remplie sans empreintes (ne devrait pas arriver) : tout réécrire
  const existing = await db.select<{ id: string; oracle_id: string }[]>(
    `SELECT card_id AS id, oracle_id FROM rb_prints`
  )
  const oracleOfExisting = new Map(existing.map((r) => [r.id, r.oracle_id]))

  const incoming = new Set(data.prints.map((p) => p.id))
  const changed = data.prints
    .map((p) => ({
      p,
      hash: printHash(p, data.oracles.get(p.oracle_id), data.defaults.get(p.oracle_id) === p.id),
    }))
    .filter(({ p, hash }) => opts.force || known.get(p.id) !== hash)
  const removed = existing.map((r) => r.id).filter((id) => !incoming.has(id))

  // cartes logiques à réécrire : celles d'une impression nouvelle / modifiée,
  // et celles dont une impression a disparu (impression par défaut)
  const touched = new Set(changed.map((c) => c.p.oracle_id))
  for (const id of removed) touched.add(oracleOfExisting.get(id)!)
  const goneOracles = [...touched].filter((o) => !data.oracles.has(o))
  const rewrite = [...touched].filter((o) => data.oracles.has(o))

  await db.execute('BEGIN TRANSACTION')
  try {
    if (removed.length) {
      setProgress(60, 'Removing withdrawn cards…')
      await deleteIds(db, 'rb_prints', 'card_id', removed)
      await deleteIds(db, 'card_meta', 'card_id', removed)
      await deleteIds(db, 'card_hashes', 'card_id', removed)
      await deleteIds(db, 'cards', 'id', removed)
    }
    if (goneOracles.length) await deleteIds(db, 'rb_cards', 'oracle_id', goneOracles)
    if (changed.length) {
      setProgress(70, `Writing ${changed.length.toLocaleString('en')} card(s)…`)
      await insertRows(db, 'cards', CARD_COLS, changed.map(({ p }) => cardColumns(p)))
      await insertRows(db, 'rb_prints', PRINT_COLS, changed.map(({ p }) => printColumns(p)))
      await insertRows(
        db,
        'card_meta',
        ['card_id', 'root', 'type'],
        changed.map(({ p }) => [p.id, p.oracle_id, p.meta_type])
      )
      await insertRows(
        db,
        'card_hashes',
        ['card_id', 'hash'],
        changed.map(({ p, hash }) => [p.id, hash])
      )
    }
    if (rewrite.length) {
      await insertRows(
        db,
        'rb_cards',
        ORACLE_COLS,
        rewrite.map((o) => oracleColumns(data.oracles.get(o)!, data.defaults.get(o)!))
      )
    }
    // statuts : petite table, réécrite entièrement
    await db.execute(`DELETE FROM rb_legality`)
    await insertRows(
      db,
      'rb_legality',
      ['oracle_id', 'format', 'status', 'since'],
      data.legality.map((l) => [l.oracle_id, l.format, l.status, l.since])
    )
    if (touched.size) {
      setProgress(90, 'Building the search index…')
      await db.execute(`INSERT INTO rb_cards_fts(rb_cards_fts) VALUES ('rebuild')`)
    }
    const entries: [string, string][] = [
      ['db_version', data.version],
      ['synced_at', at],
      ['checked_at', at],
      ['full_at', at],
    ]
    if (opts.setsSig) entries.push(['sets_sig', opts.setsSig])
    await setMeta(db, entries)
    await db.execute('COMMIT')
  } catch (err) {
    await db.execute('ROLLBACK').catch(() => {})
    throw err
  }
  return {
    changed: changed.length,
    removed: removed.length,
    unchanged: data.prints.length - changed.length,
  }
}

// bannissements seuls (vérification quotidienne) : remplace les statuts
// banned / annoncés, garde les « not_legal » des jetons. Retourne le nombre
// de cartes dont le statut a changé.
export async function writeBans(db: CardDb, rows: LegalityRow[], now = new Date()): Promise<number> {
  const before = await db.select<LegalityRow[]>(
    `SELECT oracle_id, format, status, since FROM rb_legality WHERE status != 'not_legal'`
  )
  const key = (l: LegalityRow) => `${l.oracle_id}|${l.format}|${l.status}|${l.since ?? ''}`
  const a = new Set(before.map(key))
  const b = new Set(rows.map(key))
  const diff = new Set<string>()
  for (const k of a) if (!b.has(k)) diff.add(k.split('|')[0]!)
  for (const k of b) if (!a.has(k)) diff.add(k.split('|')[0]!)
  await db.execute('BEGIN TRANSACTION')
  try {
    if (diff.size) {
      await db.execute(`DELETE FROM rb_legality WHERE status != 'not_legal'`)
      await insertRows(
        db,
        'rb_legality',
        ['oracle_id', 'format', 'status', 'since'],
        rows.map((l) => [l.oracle_id, l.format, l.status, l.since])
      )
    }
    await setMeta(db, [['checked_at', now.toISOString()]])
    await db.execute('COMMIT')
  } catch (err) {
    await db.execute('ROLLBACK').catch(() => {})
    throw err
  }
  return diff.size
}

// mise à jour complète ou bannissements seuls, selon la source (testé sans réseau)
export async function updateRiftbound(
  db: CardDb,
  source: RiftboundSource,
  opts: { force?: boolean; now?: Date } = {}
): Promise<RiftboundStats> {
  const now = opts.now ?? new Date()
  const local = await meta(db, 'db_version')
  setProgress(2, 'Checking for updates…')
  const sets = await source.sets()
  const sig = setsSignature(sets)
  const catalogDue =
    !!opts.force ||
    !local ||
    (await meta(db, 'sets_sig')) !== sig ||
    !recentEnough(await meta(db, 'full_at'), now.getTime(), FULL_DAYS * DAY_MS)

  if (!catalogDue) {
    const changed = await writeBans(db, banRows(await source.bans()), now)
    return { changed, removed: 0, unchanged: 0, catalog: false }
  }

  setProgress(5, 'Downloading card data…')
  const bulk = await source.bulk()
  const objects = await source.prints(sets, (done, total) =>
    setProgress(10 + Math.round((done / Math.max(1, total)) * 45), 'Downloading card data…')
  )
  const data = mapRiftbound(bulk, objects)
  if (!data.prints.length) throw new Error('RiftHunt returned no cards')
  const stats = await writeRiftbound(db, data, { force: opts.force, setsSig: sig, now })
  return { ...stats, catalog: true }
}

// ── images : indices envoyés à Rust ─────────────────────────

async function pushImageSources(db: CardDb, always: boolean): Promise<void> {
  const rows = await db.select<{ id: string; image_url: string }[]>(
    `SELECT id, image_url FROM cards WHERE image_url IS NOT NULL`
  )
  if (!always) {
    const known = await invoke<number>('image_sources_count', { game: 'riftbound' }).catch(() => -1)
    if (known === rows.length) return
  }
  await invoke('image_sources_set', {
    game: 'riftbound',
    sources: Object.fromEntries(rows.map((r) => [r.id, r.image_url])),
  })
}

// ── source réelle (RiftHunt, via la commande Rust card_data_get) ─────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getJson<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return JSON.parse(await invoke<string>('card_data_get', { url: `${API}${path}` })) as T
    } catch (e) {
      if (attempt >= RETRIES || !/\b(429|50[234])\b/.test(String(e))) throw e
      await sleep(2000 * 2 ** attempt)
    }
  }
}

interface SearchPage {
  data?: RiftHuntCard[]
  total_cards?: number
  has_more?: boolean
  next_page?: string | null
}

// recherche paginée ; 404 = aucune carte ne correspond
async function searchAll(
  query: string,
  unique: 'cards' | 'prints',
  onPage?: (done: number, total: number) => void
): Promise<RiftHuntCard[]> {
  const out: RiftHuntCard[] = []
  let path: string | null | undefined =
    `/cards/search?q=${encodeURIComponent(query)}&unique=${unique}&order=set`
  while (path) {
    let page: SearchPage
    try {
      page = await getJson<SearchPage>(path)
    } catch (e) {
      if (String(e).includes('404')) break
      throw e
    }
    out.push(...(page.data ?? []))
    onPage?.(out.length, page.total_cards ?? out.length)
    path = page.has_more ? page.next_page : null
    if (path && !path.startsWith('/')) throw new Error('Unexpected RiftHunt page link')
    if (path) await sleep(PAGE_DELAY_MS)
  }
  return out
}

export const riftHuntSource: RiftboundSource = {
  async sets() {
    const r = await getJson<{
      data?: { code: string; name: string; card_count: number; release_date?: string }[]
    }>('/sets')
    return (r.data ?? []).map((s) => ({
      id: s.code,
      name: s.name,
      count: s.card_count,
      released: s.release_date?.slice(0, 10) ?? null,
    }))
  },
  async bans() {
    const now = await searchAll('banned:any', 'cards')
    await sleep(PAGE_DELAY_MS)
    return [...now, ...(await searchAll('banned:upcoming', 'cards'))]
  },
  bulk: () => getJson<RiftHuntBulk>('/bulk/cards'),
  // extension par extension (« set:ogn ») : ~15 pages de 175 en tout
  async prints(sets, onPage) {
    const total = sets.reduce((n, s) => n + s.count, 0)
    const out: RiftHuntCard[] = []
    for (const s of sets) {
      const before = out.length
      out.push(
        ...(await searchAll(`set:${s.id.toLowerCase()}`, 'prints', (done) =>
          onPage?.(before + done, total)
        ))
      )
      await sleep(PAGE_DELAY_MS)
    }
    return out
  },
}

export async function syncRiftbound(
  options: { force?: boolean; auto?: boolean } = {},
  source: RiftboundSource = riftHuntSource
): Promise<CardDataReport | null> {
  if (isSyncing.value) return null
  const db = (await useDatabase()).cards('riftbound')
  const local = await meta(db, 'db_version')
  // au lancement, une vérification récente ne coûte pas une requête ; les
  // indices d'images sont quand même vérifiés (cache vidé, autre appareil…)
  if (
    options.auto &&
    local &&
    recentEnough(await meta(db, 'checked_at'), Date.now(), AUTO_HOURS * HOUR_MS)
  ) {
    await pushImageSources(db, false).catch(() => {})
    return null
  }

  isSyncing.value = true
  syncBlocking.value = !local // 1re installation : rien à afficher sans elle
  syncError.value = null
  try {
    const stats = await updateRiftbound(db, source, { force: options.force })
    await pushImageSources(db, stats.changed > 0 || !!options.force)
    setProgress(
      100,
      stats.changed || stats.removed
        ? `${stats.changed.toLocaleString('en')} card(s) updated`
        : 'Up to date'
    )
    return { changed: stats.changed, removed: stats.removed }
  } catch (err) {
    syncError.value = err instanceof Error ? err.message : String(err)
    setProgress(0, 'Sync failed')
    throw err
  } finally {
    isSyncing.value = false
    if (!syncError.value) syncBlocking.value = false
  }
}

// base de test (E2E, tests) : écrit un catalogue fourni, sans réseau
export async function seedRiftbound(
  bulk: RiftHuntBulk,
  objects: RiftHuntCard[]
): Promise<Omit<RiftboundStats, 'catalog'>> {
  const db = (await useDatabase()).cards('riftbound')
  const stats = await writeRiftbound(db, mapRiftbound(bulk, objects), {
    setsSig: setsSignature(bulk.sets),
  })
  await pushImageSources(db, true).catch(() => {})
  return stats
}
