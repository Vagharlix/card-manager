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
const { importMtg, syncMtg, recentEnough } = await import('~/services/mtgData/sync')
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
