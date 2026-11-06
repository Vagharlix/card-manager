import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabases, TestDatabase, type TestDatabases } from './helpers/testDb'
import { contentsOf, createSeeder } from './helpers/seed'

// ============================================================
// collection — ajout (défauts par jeu), modification, suppression,
// et cohérence avec les conteneurs.
// ============================================================

const h = vi.hoisted(() => ({ dbs: null as unknown as TestDatabases }))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))

const { addCard, updateCard, removeCard, ownedQuantity } = await import('~/services/collection')
const { listContainers } = await import('~/services/containers')
const { setGameSetting, invalidateSettingsCache } = await import('~/services/settings')

const DM = '46986414'
const POT = '55144522'

let dbs: TestDatabases
let seed: ReturnType<typeof createSeeder>

beforeEach(() => {
  dbs = createTestDatabases()
  h.dbs = dbs
  invalidateSettingsCache() // le cache des settings est module-level
  seed = createSeeder(dbs)
  seed.card(DM, 'Dark Magician')
  seed.card(POT, 'Pot of Greed')
})

afterEach(() => {
  dbs.user.close()
  dbs.ygo.close()
})

function row(id: string) {
  return dbs.user.raw
    .prepare(`SELECT quantity, condition, language, deleted_at FROM collection WHERE id = ?`)
    .get(id) as { quantity: number; condition: string; language: string; deleted_at: string | null }
}

function countOf(containerId: string, items: { id: string; cardCount: number }[]) {
  return items.find((c) => c.id === containerId)?.cardCount
}

describe('addCard', () => {
  it('sans précision : état et langue par défaut du jeu', async () => {
    const id = await addCard({ game: 'ygo', cardId: DM })
    expect(row(id)).toMatchObject({ quantity: 1, condition: 'NM', language: 'en' })
  })

  it('respecte les réglages par jeu', async () => {
    await setGameSetting('ygo', 'default_condition', 'LP')
    await setGameSetting('ygo', 'default_language', 'fr')
    const id = await addCard({ game: 'ygo', cardId: DM, quantity: 2 })
    expect(row(id)).toMatchObject({ quantity: 2, condition: 'LP', language: 'fr' })
    expect(await ownedQuantity('ygo', DM)).toBe(2)
  })
})

describe('removeCard', () => {
  it('retire les copies de tous leurs conteneurs et soft-delete la ligne', async () => {
    const box = seed.deckbox('Box')
    const binder = seed.binder('Binder')
    const bulk = seed.bulkBox('Bulk')
    const dm = seed.owned(DM, 4)
    const pot = seed.owned(POT, 1)
    seed.inDeckbox(box, dm, 2)
    seed.inBinder(binder, dm, 0, 0, 0)
    seed.inBulk(bulk, dm, 1)
    seed.inDeckbox(box, pot, 1)

    await removeCard(dm)

    expect(row(dm).deleted_at).not.toBeNull()
    expect(contentsOf(dbs, box)).toEqual({ [POT]: 1 }) // l'autre entrée reste
    expect(contentsOf(dbs, binder)).toEqual({})
    expect(contentsOf(dbs, bulk)).toEqual({})
    expect(await ownedQuantity('ygo', DM)).toBe(0)
  })

  it('les compteurs de conteneurs ne comptent plus les copies supprimées', async () => {
    const box = seed.deckbox('Box')
    const dm = seed.owned(DM, 3)
    seed.inDeckbox(box, dm, 3)
    expect(countOf(box, await listContainers())).toBe(3)

    await removeCard(dm)
    expect(countOf(box, await listContainers())).toBe(0)
  })
})

describe('updateCard', () => {
  it('refuse une quantité inférieure aux copies rangées, sans rien modifier', async () => {
    const box = seed.deckbox('Box')
    const binder = seed.binder('Binder')
    const dm = seed.owned(DM, 3)
    seed.inDeckbox(box, dm, 1)
    seed.inBinder(binder, dm, 0, 0, 0)

    await expect(updateCard(dm, { quantity: 1, condition: 'HP' })).rejects.toThrow(
      'QUANTITY_BELOW_ASSIGNED'
    )
    expect(row(dm)).toMatchObject({ quantity: 3, condition: 'NM' })
  })

  it('accepte une quantité égale aux copies rangées', async () => {
    const box = seed.deckbox('Box')
    const dm = seed.owned(DM, 3)
    seed.inDeckbox(box, dm, 2)

    await updateCard(dm, { quantity: 2 })
    expect(row(dm).quantity).toBe(2)
  })

  it('ignore les rangements dans un conteneur supprimé', async () => {
    const gone = seed.bulkBox('Gone')
    const dm = seed.owned(DM, 3)
    seed.inBulk(gone, dm, 3)
    seed.softDeleteContainer(gone)

    await updateCard(dm, { quantity: 1 })
    expect(row(dm).quantity).toBe(1)
  })

  it('sans quantité : modifie les autres champs librement', async () => {
    const box = seed.deckbox('Box')
    const dm = seed.owned(DM, 2)
    seed.inDeckbox(box, dm, 2)

    await updateCard(dm, { language: 'de' })
    expect(row(dm)).toMatchObject({ quantity: 2, language: 'de' })
  })
})

describe('migration 004 — nettoyage des copies fantômes', () => {
  it('supprime les rangements des entrées déjà soft-deleted, garde les autres', () => {
    const legacy: TestDatabases = { user: new TestDatabase('user', { upTo: 3 }), ygo: dbs.ygo }
    const s = createSeeder(legacy)
    const box = s.deckbox('Box')
    const binder = s.binder('Binder')
    const bulk = s.bulkBox('Bulk')
    const dead = s.owned(DM, 3)
    const live = s.owned(POT, 2)
    s.inDeckbox(box, dead, 1)
    s.inBinder(binder, dead, 0, 0, 0)
    s.inBulk(bulk, dead, 1)
    s.inDeckbox(box, live, 2)
    s.softDeleteCollection(dead)

    legacy.user.applyMigration(4)

    expect(contentsOf(legacy, box)).toEqual({ [POT]: 2 })
    expect(contentsOf(legacy, binder)).toEqual({})
    expect(contentsOf(legacy, bulk)).toEqual({})
    legacy.user.close()
  })
})
