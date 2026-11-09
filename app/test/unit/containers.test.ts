import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabases, TestDatabase, type TestDatabases } from './helpers/testDb'
import { contentsOf, createSeeder } from './helpers/seed'

// ============================================================
// containers — rangement par carte (classeur, deckbox, bulk),
// capacité, cartes non rangées, retrait, migration 005.
// ============================================================

const h = vi.hoisted(() => ({ dbs: null as unknown as TestDatabases }))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))

const {
  assignCardToContainer,
  assignCardToBinderSlot,
  unassignCardFromContainer,
  unrangedCount,
  listContainerCards,
} = await import('~/services/containers')

const DM = '46986414'
const DM_ALT = '36996508'

let dbs: TestDatabases
let seed: ReturnType<typeof createSeeder>

beforeEach(() => {
  dbs = createTestDatabases()
  h.dbs = dbs
  seed = createSeeder(dbs)
  seed.card(DM, 'Dark Magician')
  seed.card(DM_ALT, 'Dark Magician', DM)
})

afterEach(() => {
  dbs.user.close()
  dbs.ygo.close()
})

describe('assignCardToContainer', () => {
  it('classeur : plusieurs copies d’une même pile occupent plusieurs cases', async () => {
    seed.owned(DM, 3)
    const binder = seed.binder('Binder')
    expect(await assignCardToContainer('ygo', DM, binder, 'binder', 2)).toBe(2)
    expect(contentsOf(dbs, binder)).toEqual({ [DM]: 2 })
    expect(await unrangedCount('ygo')).toBe(1)
  })

  it('classeur plein : s’arrête et renvoie ce qui a été placé', async () => {
    seed.owned(DM, 5)
    const binder = seed.binder('Mini', 1, 1, 2) // 2 cases
    expect(await assignCardToContainer('ygo', DM, binder, 'binder', 5)).toBe(2)
    expect(contentsOf(dbs, binder)).toEqual({ [DM]: 2 })
  })

  it('deckbox : la demande est plafonnée à la place restante', async () => {
    seed.owned(DM, 5)
    const box = seed.deckbox('Box', 3)
    expect(await assignCardToContainer('ygo', DM, box, 'deckbox', 2)).toBe(2)
    expect(await assignCardToContainer('ygo', DM, box, 'deckbox', 2)).toBe(1)
    expect(await assignCardToContainer('ygo', DM, box, 'deckbox', 1)).toBe(0)
    expect(contentsOf(dbs, box)).toEqual({ [DM]: 3 })
  })

  it('ne range jamais plus que les copies non rangées', async () => {
    seed.owned(DM, 2)
    const bulk = seed.bulkBox('Bulk')
    const box = seed.deckbox('Box')
    expect(await assignCardToContainer('ygo', DM, bulk, 'bulk_box', 5)).toBe(2)
    expect(await assignCardToContainer('ygo', DM, box, 'deckbox', 1)).toBe(0)
    expect(await unrangedCount('ygo')).toBe(0)
  })
})

describe('assignCardToBinderSlot', () => {
  it('place deux copies d’une même pile dans deux cases choisies', async () => {
    seed.owned(DM, 2)
    const binder = seed.binder('Binder')
    await assignCardToBinderSlot('ygo', DM, binder, 0, 0, 0)
    await assignCardToBinderSlot('ygo', DM, binder, 0, 1, 2)
    expect(contentsOf(dbs, binder)).toEqual({ [DM]: 2 })
  })
})

describe('unassignCardFromContainer', () => {
  it('retire N copies et les rend non rangées', async () => {
    seed.owned(DM, 3)
    const binder = seed.binder('Binder')
    await assignCardToContainer('ygo', DM, binder, 'binder', 3)
    expect(await unassignCardFromContainer('ygo', DM, binder, 'binder', 2)).toBe(2)
    expect(contentsOf(dbs, binder)).toEqual({ [DM]: 1 })
    expect(await unrangedCount('ygo')).toBe(2)
  })
})

describe('listContainerCards', () => {
  it('regroupe les artworks d’une même carte', async () => {
    const box = seed.deckbox('Box')
    seed.inDeckbox(box, seed.owned(DM, 1), 1)
    seed.inDeckbox(box, seed.owned(DM_ALT, 2), 2)
    expect(await listContainerCards(box, 'deckbox', 'ygo')).toMatchObject([
      { rootId: DM, name: 'Dark Magician', totalQty: 3 },
    ])
  })
})

describe('migration 005 — classeur multi-copies', () => {
  it('conserve les cases valides, écarte les orphelines, garde la vue utilisable', () => {
    const legacy: TestDatabases = createTestDatabases({ user: new TestDatabase('user', { upTo: 4 }), ygo: dbs.ygo })
    const s = createSeeder(legacy)
    const binder = s.binder('Binder')
    const entry = s.owned(DM, 3)
    s.inBinder(binder, entry, 0, 0, 0)
    // ligne orpheline, comme en laissaient les bases d'avant foreign_keys = ON
    legacy.user.raw.exec('PRAGMA foreign_keys = OFF')
    legacy.user.raw
      .prepare(
        `INSERT INTO binder_slots (id, container_id, collection_id, page, row, col)
         VALUES ('orphan', ?, 'gone', 0, 0, 1)`
      )
      .run(binder)
    legacy.user.raw.exec('PRAGMA foreign_keys = ON')

    legacy.user.applyMigration(5)

    // la case valide est conservée, l'orpheline écartée
    expect(contentsOf(legacy, binder)).toEqual({ [DM]: 1 })
    expect(legacy.user.raw.prepare(`SELECT id FROM binder_slots WHERE id = 'orphan'`).get()).toBe(
      undefined
    )
    // une 2e case pour la même entrée est désormais acceptée
    s.inBinder(binder, entry, 0, 0, 1)
    expect(contentsOf(legacy, binder)).toEqual({ [DM]: 2 })
    // une case reste unique
    expect(() => s.inBinder(binder, entry, 0, 0, 1)).toThrow(/UNIQUE/)
    // la vue recréée fonctionne
    const locs = legacy.user.raw
      .prepare(`SELECT COUNT(*) AS n FROM card_locations WHERE location_type = 'binder'`)
      .get() as { n: number }
    expect(locs.n).toBe(2)
    legacy.user.close()
  })
})
