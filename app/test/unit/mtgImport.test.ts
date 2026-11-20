import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabases, type TestDatabases } from './helpers/testDb'

// ============================================================
// Import Magic : vrais objets Scryfall (fixtures/scryfall-sample.jsonl,
// 36 impressions choisies pour leurs pièges) → cards-mtg.db, avec les
// vraies migrations. Le téléchargement Rust est simulé (invoke).
// ============================================================

const h = vi.hoisted(() => ({
  dbs: null as unknown as TestDatabases,
  invoke: null as unknown as (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
}))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => h.invoke(cmd, args),
}))

const { mapCard, deckLimitOf, betterPrint } = await import('~/services/mtgData/import')
const {
  importMtg,
  syncMtg,
  recentEnough,
  updateMtgIncremental,
  recentPrintsUrl,
  recentWindowStart,
} = await import('~/services/mtgData/sync')
const { TestDatabase } = await import('./helpers/testDb')
const { cardMetaOf, legalityOf, variantsOfRoots, printingRarities } =
  await import('~/services/card/meta')

const SAMPLE = readFileSync(new URL('./fixtures/scryfall-sample.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
const byName = (name: string) => SAMPLE.filter((c) => c.name === name)
const one = (name: string) => byName(name)[0]

// lots de 10 objets, comme jsonl_next
function batches(items = SAMPLE, size = 10) {
  let i = 0
  return async () => {
    const part = items.slice(i, i + size)
    i += size
    return {
      items: part,
      read: Math.min(i, items.length),
      total: items.length,
      done: i >= items.length,
    }
  }
}

let dbs: TestDatabases
beforeEach(() => {
  dbs = createTestDatabases()
  h.dbs = dbs
})
afterEach(() => {
  for (const db of [dbs.user, dbs.ygo, dbs.mtg]) db.close()
})

const q = <T>(sql: string, ...p: (string | number)[]) => dbs.mtg.raw.prepare(sql).all(...p) as T[]

describe('mapCard', () => {
  it('ignore les cartes numériques, garde les jetons papier', () => {
    expect(mapCard(one('Bronze Horse'))).toBeNull() // MTGO seulement
    expect(mapCard(one('Goblin'))?.print.setType).toBe('token')
  })

  it('cartes à plusieurs faces : coût, texte, caractéristiques', () => {
    const fire = mapCard(one('Fire // Ice'))!
    expect(fire.oracle.manaCost).toBe('{1}{R} // {1}{U}')
    expect(fire.oracle.oracleText).toContain('\n//\n')
    expect(fire.oracle.colors).toBe('UR')
    const delver = mapCard(one('Delver of Secrets // Insectile Aberration'))!
    expect(delver.oracle.power).toBe('1')
    expect(delver.oracle.typeLine).toContain('//')
    expect(delver.print.illustrationId).toBeTruthy()
  })

  it('restrictions par format et limites de deck', () => {
    expect(mapCard(one('Black Lotus'))!.oracle.restrictions).toMatchObject({
      vintage: 'restricted',
      legacy: 'banned',
      commander: 'banned',
    })
    expect(mapCard(one('Lightning Bolt'))!.oracle.restrictions.modern).toBeUndefined()
    expect(mapCard(one('Forest'))!.oracle.deckLimit).toBe(-1)
    expect(mapCard(one('Snow-Covered Island'))!.oracle.deckLimit).toBe(-1)
    expect(mapCard(one('Relentless Rats'))!.oracle.deckLimit).toBe(-1)
    expect(mapCard(one('Seven Dwarves'))!.oracle.deckLimit).toBe(7)
    expect(mapCard(one('Lightning Bolt'))!.oracle.deckLimit).toBeNull()
    expect(deckLimitOf('Legendary Creature — Elf', 'Basic landcycling {1}')).toBeNull()
  })

  it('impression par défaut : extension normale, pas promo, la plus récente', () => {
    const prints = byName('Lightning Bolt').map((c) => mapCard(c)!.print)
    const best = prints.reduce((a, b) => (betterPrint(b, a) ? b : a))
    expect(best.setType).not.toBe('promo')
    expect(best.promo).toBe(false)
    expect(['commander', 'masters', 'expansion', 'core']).toContain(best.setType)
  })
})

describe('importMtg', () => {
  it('remplit le contrat commun et les tables Magic', async () => {
    const stats = await importMtg(dbs.mtg as never, batches(), 'v1')
    expect(stats).toEqual({ prints: 35, cards: 20, skipped: 1 })
    expect(q<{ n: number }>(`SELECT COUNT(*) AS n FROM cards`)[0]!.n).toBe(35)

    // toutes les impressions de Lightning Bolt partagent la même carte logique
    const bolts = byName('Lightning Bolt').map((c) => c.id as string)
    const meta = await cardMetaOf('mtg', bolts)
    const roots = new Set([...meta.values()].map((m) => m.root))
    expect(roots).toEqual(new Set([one('Lightning Bolt').oracle_id]))
    expect(meta.get(bolts[0]!)).toMatchObject({ name: 'Lightning Bolt', type: 'Instant' })
    const variants = await variantsOfRoots('mtg', roots)
    expect(variants.get(one('Lightning Bolt').oracle_id)!.sort()).toEqual([...bolts].sort())

    // légalités sur la carte logique + limite de deck
    const legal = await legalityOf('mtg', [one('Black Lotus').oracle_id, one('Forest').oracle_id])
    expect(legal.get(one('Black Lotus').oracle_id)).toMatchObject({
      vintage: 'restricted',
      legacy: 'banned',
    })
    expect(legal.get(one('Forest').oracle_id)).toMatchObject({ deck_limit: '-1' })

    // vue printings (contrat) : code affiché et rareté unique
    const id = one('Jace, the Mind Sculptor').id
    expect(q(`SELECT set_code, rarity FROM printings WHERE id = ?`, id)).toEqual([
      { set_code: 'WWK #31', rarity: 'mythic' },
    ])
    expect(await printingRarities('mtg', id)).toEqual(['mythic'])

    // recherche plein texte sur les cartes logiques
    expect(
      q<{ name: string }>(
        `SELECT name FROM mtg_oracle_fts WHERE mtg_oracle_fts MATCH 'bolt' ORDER BY name`
      ).map((r) => r.name)
    ).toEqual(['Lightning Bolt'])
    expect(
      q<{ name: string }>(
        `SELECT name FROM mtg_oracle_fts WHERE mtg_oracle_fts MATCH 'oracle_text:counter' ORDER BY name`
      ).map((r) => r.name)
    ).toContain('Counterspell')

    expect(q(`SELECT value FROM sync_meta WHERE key = 'db_version'`)).toEqual([{ value: 'v1' }])
  })

  it('un nouvel import remplace tout ; une erreur en route garde l’ancienne base', async () => {
    await importMtg(dbs.mtg as never, batches(), 'v1')
    await importMtg(dbs.mtg as never, batches(SAMPLE.slice(0, 5)), 'v2')
    expect(q<{ n: number }>(`SELECT COUNT(*) AS n FROM cards`)[0]!.n).toBe(5)

    let calls = 0
    const failing = async () => {
      if (++calls === 2) throw new Error('network down')
      return { items: SAMPLE.slice(0, 10), read: 1, total: 10, done: false }
    }
    await expect(importMtg(dbs.mtg as never, failing, 'v3')).rejects.toThrow('network down')
    expect(q<{ n: number }>(`SELECT COUNT(*) AS n FROM cards`)[0]!.n).toBe(5)
    expect(q(`SELECT value FROM sync_meta WHERE key = 'db_version'`)).toEqual([{ value: 'v2' }])
  })
})

describe('syncMtg', () => {
  function fakeScryfall(version: string) {
    const calls: string[] = []
    let next: ReturnType<typeof batches> | null = null
    h.invoke = async (cmd, args) => {
      calls.push(cmd)
      if (cmd === 'card_data_get')
        return JSON.stringify({
          updated_at: version,
          jsonl_download_uri: 'https://data.scryfall.io/x.jsonl.gz',
        })
      if (cmd === 'jsonl_open') {
        expect(args?.keys).toContain('oracle_id')
        next = batches()
        return { id: 7, total: SAMPLE.length }
      }
      if (cmd === 'jsonl_next') return next!()
      return null
    }
    return calls
  }

  it('télécharge, puis ne retélécharge pas la même version', async () => {
    const calls = fakeScryfall('2026-11-08')
    await syncMtg()
    expect(calls).toContain('jsonl_open')
    expect(q<{ n: number }>(`SELECT COUNT(*) AS n FROM mtg_oracle`)[0]!.n).toBe(20)
    calls.length = 0
    await syncMtg()
    expect(calls).toEqual(['card_data_get'])
    calls.length = 0
    await syncMtg({ force: true })
    expect(calls).toContain('jsonl_open')
  })

  it('ensuite : recherche des nouveautés ; import complet si la base l’exige', async () => {
    const urls: string[] = []
    const calls = fakeScryfall('2026-11-08')
    const inner = h.invoke
    h.invoke = async (cmd, args) => {
      if (cmd === 'card_data_get') urls.push(String(args?.url))
      return inner(cmd, args)
    }
    await syncMtg() // installation : import complet
    calls.length = 0
    urls.length = 0
    await syncMtg() // incrémental : une recherche, pas de fichier en masse
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('/cards/search?')
    expect(calls).not.toContain('jsonl_open')
    dbs.mtg.raw.exec(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('needs_full', '1')`)
    calls.length = 0
    await syncMtg()
    expect(calls).toContain('jsonl_open')
    expect(q(`SELECT value FROM sync_meta WHERE key = 'needs_full'`)).toEqual([])
  })

  it('au lancement : base récente → aucune requête', async () => {
    const calls = fakeScryfall('2026-11-08')
    await syncMtg({ auto: true }) // jamais synchronisée : téléchargement
    calls.length = 0
    await syncMtg({ auto: true })
    expect(calls).toEqual([])
    expect(recentEnough(new Date(Date.now() - 20 * 86_400_000).toISOString())).toBe(false)
    expect(recentEnough(null)).toBe(false)
  })
})

// ============================================================
// Mise à jour incrémentale : nouvelles impressions (recherche Scryfall),
// règles et légalités (oracle_cards). Une base mise à jour par incréments
// doit être identique à une base importée d'un coup.
// ============================================================
describe('mise à jour incrémentale', () => {
  // les impressions les plus récentes arrivent par la recherche
  const sorted = [...SAMPLE].sort((a, b) =>
    String(a.released_at).localeCompare(String(b.released_at))
  )
  const RECENT = sorted.slice(-10)
  const OLDER = sorted.slice(0, -10)
  async function* pages(items: unknown[], size = 4) {
    for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size) as never
  }
  const snapshot = (db: TestDatabase) => ({
    prints: db.raw.prepare(`SELECT * FROM mtg_prints ORDER BY card_id`).all(),
    meta: db.raw.prepare(`SELECT * FROM card_meta ORDER BY card_id`).all(),
    oracle: db.raw
      .prepare(
        `SELECT oracle_id, name, default_print, oracle_text, type_line, deck_limit, colors
         FROM mtg_oracle ORDER BY oracle_id`
      )
      .all(),
    legality: db.raw.prepare(`SELECT * FROM card_legality ORDER BY card_id, format`).all(),
  })

  it('anciennes + nouvelles impressions = import complet (impressions, cartes logiques, défauts, légalités)', async () => {
    const full = new TestDatabase('mtg')
    await importMtg(full as never, batches(SAMPLE), 'full')

    await importMtg(dbs.mtg as never, batches(OLDER), 'old')
    const stats = await updateMtgIncremental(dbs.mtg as never, {
      recentPrints: () => pages(RECENT),
    })
    expect(stats.newPrints).toBe(RECENT.filter((c) => mapCard(c)).length)
    expect(stats.oracleRefreshed).toBe(false)
    expect(snapshot(dbs.mtg)).toEqual(snapshot(full))
    // index plein texte reconstruit : une carte arrivée par incrément se trouve
    const name = mapCard(RECENT.find((c) => mapCard(c))!)!.oracle.name.split(' ')[0]!
    expect(
      q<{ n: number }>(
        `SELECT COUNT(*) AS n FROM mtg_oracle_fts WHERE mtg_oracle_fts MATCH ?`,
        `"${name}"`
      )[0]!.n
    ).toBeGreaterThan(0)
    full.close()
  })

  it('rien de nouveau : la base ne change pas', async () => {
    await importMtg(dbs.mtg as never, batches(SAMPLE), 'full')
    const before = snapshot(dbs.mtg)
    const stats = await updateMtgIncremental(dbs.mtg as never, { recentPrints: () => pages([]) })
    expect(stats).toEqual({ newPrints: 0, updatedPrints: 0, oracleRefreshed: false })
    expect(snapshot(dbs.mtg)).toEqual(before)
  })

  it('impressions déjà connues : réécrites sans doublon', async () => {
    await importMtg(dbs.mtg as never, batches(SAMPLE), 'full')
    const before = snapshot(dbs.mtg)
    const stats = await updateMtgIncremental(dbs.mtg as never, {
      recentPrints: () => pages(RECENT),
    })
    expect(stats.newPrints).toBe(0)
    expect(stats.updatedPrints).toBeGreaterThan(0)
    expect(snapshot(dbs.mtg)).toEqual(before)
  })

  it('règles et légalités : un bannissement arrive par oracle_cards, le reste ne bouge pas', async () => {
    await importMtg(dbs.mtg as never, batches(SAMPLE), 'full')
    const bolt = one('Lightning Bolt')
    const banned = { ...bolt, legalities: { ...bolt.legalities, modern: 'banned' } }
    const others = SAMPLE.filter((c) => c.oracle_id !== bolt.oracle_id)
    const stats = await updateMtgIncremental(dbs.mtg as never, {
      recentPrints: () => pages([]),
      oracleBatches: batches([banned, ...others]),
    })
    expect(stats.oracleRefreshed).toBe(true)
    expect(
      q(`SELECT status FROM card_legality WHERE card_id = ? AND format = 'modern'`, bolt.oracle_id)
    ).toEqual([{ status: 'banned' }])
    expect(q(`SELECT value FROM sync_meta WHERE key = 'oracle_at'`)).toHaveLength(1)
    // la carte logique garde son impression par défaut, la recherche la trouve
    expect(
      q<{ n: number }>(
        `SELECT COUNT(*) AS n FROM mtg_oracle_fts WHERE mtg_oracle_fts MATCH '"Lightning"'`
      )[0]!.n
    ).toBe(1)
  })

  it('recherche Scryfall : impressions papier sorties ou annoncées depuis la date', () => {
    const url = decodeURIComponent(recentPrintsUrl('2026-09-21'))
    expect(url).toContain('https://api.scryfall.com/cards/search?q=date>=2026-09-21 game:paper')
    expect(url).toContain('unique=prints')
  })

  it('fenêtre : depuis la dernière mise à jour moins 21 jours, au plus 60 jours', () => {
    const now = new Date('2026-11-20T12:00:00Z')
    expect(recentWindowStart('2026-11-13T08:00:00Z', now)).toBe('2026-10-23')
    expect(recentWindowStart('2026-01-01T00:00:00Z', now)).toBe('2026-09-21')
    expect(recentWindowStart(null, now)).toBe('2026-09-21')
  })

  it('migration 002 : une base déjà remplie demande un import complet', () => {
    const legacy = new TestDatabase('mtg', { upTo: 1 })
    legacy.raw.exec(`INSERT INTO cards (id, name) VALUES ('x', 'X')`)
    legacy.raw.exec(
      `INSERT INTO mtg_prints (card_id, oracle_id, set_code, set_name, collector_number)
       VALUES ('x', 'o', 'set', 'Set', '1')`
    )
    legacy.applyMigration(2)
    expect(
      legacy.raw.prepare(`SELECT value FROM sync_meta WHERE key = 'needs_full'`).all()
    ).toEqual([{ value: '1' }])
    legacy.close()
  })
})
