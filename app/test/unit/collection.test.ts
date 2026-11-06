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

const {
  addCard,
  updateCard,
  removeCard,
  ownedQuantity,
  entriesForCard,
  listCollectionCards,
  collectionTotal,
} = await import('~/services/collection')
const { listContainers } = await import('~/services/containers')
const { setGameSetting, invalidateSettingsCache } = await import('~/services/settings')

const DM = '46986414'
const DM_ALT = '36996508'
const POT = '55144522'
const BEWD = '89631139'

let dbs: TestDatabases
let seed: ReturnType<typeof createSeeder>

beforeEach(() => {
  dbs = createTestDatabases()
  h.dbs = dbs
  invalidateSettingsCache() // le cache des settings est module-level
  seed = createSeeder(dbs)
  seed.card(DM, 'Dark Magician')
  seed.card(DM_ALT, 'Dark Magician', DM)
  seed.card(POT, 'Pot of Greed')
  seed.card(BEWD, 'Blue-Eyes White Dragon')
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

describe('quantité à l’échange', () => {
  it('ajout : bornée à la quantité', async () => {
    const id = await addCard({ game: 'ygo', cardId: DM, quantity: 2, tradeQty: 5 })
    expect((await entriesForCard('ygo', DM))[0]).toMatchObject({ id, quantity: 2, tradeQty: 2 })
  })

  it('modification : bornée, et suit une baisse de quantité', async () => {
    const id = await addCard({ game: 'ygo', cardId: DM, quantity: 3 })
    await updateCard(id, { tradeQty: 2 })
    expect((await entriesForCard('ygo', DM))[0]?.tradeQty).toBe(2)
    await updateCard(id, { quantity: 1 })
    expect((await entriesForCard('ygo', DM))[0]?.tradeQty).toBe(1)
    await updateCard(id, { tradeQty: -4 })
    expect((await entriesForCard('ygo', DM))[0]?.tradeQty).toBe(0)
  })
})

describe('listCollectionCards — toute ma collection', () => {
  async function seedCollection() {
    const box = seed.deckbox('Box')
    const dm = await addCard({ game: 'ygo', cardId: DM, quantity: 1, tradeQty: 1 })
    await addCard({ game: 'ygo', cardId: DM_ALT, quantity: 2 })
    const pot = await addCard({ game: 'ygo', cardId: POT, quantity: 4 })
    await addCard({ game: 'ygo', cardId: BEWD, quantity: 1 })
    seed.inDeckbox(box, pot, 3)
    return { dm, pot }
  }

  it('regroupe les artworks, compte possédées / échange / non rangées', async () => {
    await seedCollection()
    const cards = await listCollectionCards('ygo')
    expect(cards.map((c) => c.name)).toEqual([
      'Blue-Eyes White Dragon',
      'Dark Magician',
      'Pot of Greed',
    ])
    expect(cards[1]).toMatchObject({
      rootId: DM,
      displayId: DM_ALT, // artwork le plus possédé
      totalQty: 3,
      tradeQty: 1,
      unrangedQty: 3,
    })
    expect(cards[2]).toMatchObject({ totalQty: 4, unrangedQty: 1 })
    expect(await collectionTotal('ygo')).toBe(8)
  })

  it('recherche par nom (insensible à la casse) et filtre « à l’échange »', async () => {
    await seedCollection()
    expect((await listCollectionCards('ygo', { search: 'magic' })).map((c) => c.rootId)).toEqual([
      DM,
    ])
    expect((await listCollectionCards('ygo', { onlyTrade: true })).map((c) => c.rootId)).toEqual([
      DM,
    ])
  })

  it('tri par quantité puis par ajout récent', async () => {
    await seedCollection()
    expect((await listCollectionCards('ygo', { sort: 'quantity' })).map((c) => c.rootId)).toEqual([
      POT,
      DM,
      BEWD,
    ])
    // BEWD est ajoutée en dernier
    expect((await listCollectionCards('ygo', { sort: 'recent' }))[0]?.rootId).toBe(BEWD)
  })

  it('ignore les cartes supprimées', async () => {
    const { pot } = await seedCollection()
    await removeCard(pot)
    expect((await listCollectionCards('ygo')).map((c) => c.rootId)).not.toContain(POT)
  })
})

describe('migration 006 — trade_qty', () => {
  it('ajoute la colonne à 0 sur les piles existantes', () => {
    const legacy: TestDatabases = { user: new TestDatabase('user', { upTo: 5 }), ygo: dbs.ygo }
    const id = createSeeder(legacy).owned(DM, 3)
    legacy.user.applyMigration(6)
    const r = legacy.user.raw.prepare(`SELECT trade_qty FROM collection WHERE id = ?`).get(id) as {
      trade_qty: number
    }
    expect(r.trade_qty).toBe(0)
    expect(() =>
      legacy.user.raw.prepare(`UPDATE collection SET trade_qty = -1 WHERE id = ?`).run(id)
    ).toThrow(/CHECK/)
    legacy.user.close()
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

describe('rareté et 1re édition', () => {
  it('enregistrées à l’ajout, modifiables, relues dans les exemplaires', async () => {
    const id = await addCard({
      game: 'ygo',
      cardId: DM,
      printingId: 'LOB-EN005',
      rarity: 'Ultra Rare',
      firstEdition: true,
    })
    expect((await entriesForCard('ygo', DM))[0]).toMatchObject({
      rarity: 'Ultra Rare',
      firstEdition: true,
    })

    await updateCard(id, { rarity: 'Secret Rare', firstEdition: false })
    expect((await entriesForCard('ygo', DM))[0]).toMatchObject({
      rarity: 'Secret Rare',
      firstEdition: false,
    })

    await updateCard(id, { rarity: null })
    expect((await entriesForCard('ygo', DM))[0]!.rarity).toBeNull()
  })

  it('non précisées par défaut', async () => {
    await addCard({ game: 'ygo', cardId: POT })
    expect((await entriesForCard('ygo', POT))[0]).toMatchObject({
      rarity: null,
      firstEdition: false,
    })
  })
})

describe('migration 008 — rareté et 1re édition', () => {
  it('ajoute les colonnes sans toucher aux piles existantes', () => {
    const legacy: TestDatabases = { user: new TestDatabase('user', { upTo: 7 }), ygo: dbs.ygo }
    const id = createSeeder(legacy).owned(DM, 2)
    legacy.user.applyMigration(8)
    const r = legacy.user.raw
      .prepare(`SELECT quantity, rarity, first_edition FROM collection WHERE id = ?`)
      .get(id)
    expect(r).toEqual({ quantity: 2, rarity: null, first_edition: 0 })
    legacy.user.close()
  })
})
