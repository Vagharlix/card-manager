import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabases, type TestDatabases } from './helpers/testDb'
import { capacityOf, contentsOf, createSeeder, deckboxesOfDeck } from './helpers/seed'

// ============================================================
// deckLink — plan + apply du rangement deck → deckbox.
// useDatabase est remplacé par deux SQLite en mémoire construits
// avec les vraies migrations (cf. helpers/testDb.ts).
// ============================================================

const h = vi.hoisted(() => ({ dbs: null as unknown as TestDatabases }))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))

const { planDeckToDeckbox, applyDeckToDeckbox, deckCurrentDeckbox } =
  await import('~/services/deckLink')

// passcodes : DM a un artwork alternatif qui pointe vers lui (alias)
const DM = '46986414'
const DM_ALT = '36996508'
const POT = '55144522'
const BEWD = '89631139'

let dbs: TestDatabases
let seed: ReturnType<typeof createSeeder>

beforeEach(() => {
  dbs = createTestDatabases()
  h.dbs = dbs
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

/** total de copies assignées par entrée de collection (ne doit jamais dépasser quantity) */
function overAssigned(): { id: string; quantity: number; assigned: number }[] {
  return dbs.user.raw
    .prepare(
      `SELECT c.id, c.quantity, SUM(a.qty) AS assigned FROM collection c JOIN (
         SELECT collection_id, quantity AS qty FROM deckbox_cards
         UNION ALL SELECT collection_id, 1 FROM binder_slots
         UNION ALL SELECT collection_id, quantity FROM bulk_box_contents
       ) a ON a.collection_id = c.id
       GROUP BY c.id HAVING SUM(a.qty) > c.quantity`
    )
    .all() as { id: string; quantity: number; assigned: number }[]
}

// ============================================================
// PLAN
// ============================================================

describe('planDeckToDeckbox', () => {
  it('deck vide : aucun mouvement', async () => {
    const deck = seed.deck()
    const box = seed.deckbox('Box')
    const plan = await planDeckToDeckbox(deck, box)
    expect(plan.lines).toEqual([])
    expect(plan.totalToPlace).toBe(0)
    expect(plan.purge).toEqual([])
    expect(plan.neededCapacity).toBe(0)
    expect(plan.willExceed).toBe(false)
  })

  it('copies non rangées : toutes à assigner, noms et nom de deckbox résolus', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 3)
    seed.owned(DM, 3)
    const box = seed.deckbox('Ma Box')

    const plan = await planDeckToDeckbox(deck, box)
    expect(plan.deckboxName).toBe('Ma Box')
    expect(plan.lines).toHaveLength(1)
    expect(plan.lines[0]).toMatchObject({
      rootId: DM,
      displayId: DM,
      name: 'Dark Magician',
      needed: 3,
      owned: 3,
      alreadyHere: 0,
      toAssign: 3,
      toMove: 0,
      movedFrom: [],
      missing: 0,
    })
    expect(plan.totalToPlace).toBe(3)
  })

  it('copies manquantes : on ne place que ce qui est possédé', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 3)
    seed.owned(DM, 1)
    const box = seed.deckbox('Box')

    const plan = await planDeckToDeckbox(deck, box)
    expect(plan.lines[0]).toMatchObject({ needed: 3, owned: 1, toAssign: 1, missing: 2 })
    expect(plan.totalToPlace).toBe(1)
  })

  it('carte non possédée du tout : ligne en manquant uniquement', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, BEWD, 2)
    const box = seed.deckbox('Box')

    const plan = await planDeckToDeckbox(deck, box)
    expect(plan.lines[0]).toMatchObject({ owned: 0, toAssign: 0, toMove: 0, missing: 2 })
    expect(plan.totalToPlace).toBe(0)
  })

  it('alias : artworks et boards fusionnés en une seule carte logique', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM_ALT, 1, 'main') // 1re ligne → displayId
    seed.deckCard(deck, DM, 1, 'main')
    seed.deckCard(deck, DM, 1, 'side')
    seed.owned(DM, 1)
    seed.owned(DM_ALT, 2)
    const box = seed.deckbox('Box')

    const plan = await planDeckToDeckbox(deck, box)
    expect(plan.lines).toHaveLength(1)
    expect(plan.lines[0]).toMatchObject({
      rootId: DM,
      displayId: DM_ALT,
      needed: 3,
      owned: 3,
      toAssign: 3,
    })
  })

  it('déjà dans la deckbox (même via un autre artwork) : pas de ligne', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 2)
    const box = seed.deckbox('Box')
    seed.inDeckbox(box, seed.owned(DM_ALT, 2), 2)

    const plan = await planDeckToDeckbox(deck, box)
    expect(plan.lines).toEqual([])
    expect(plan.totalToPlace).toBe(0)
    expect(plan.purge).toEqual([]) // l'alt art n'est PAS étrangère au deck
    expect(plan.currentInBox).toBe(2)
  })

  it('partiellement là : complète seulement le reste', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 3)
    const box = seed.deckbox('Box')
    const col = seed.owned(DM, 3)
    seed.inDeckbox(box, col, 2)

    const plan = await planDeckToDeckbox(deck, box)
    expect(plan.lines[0]).toMatchObject({ alreadyHere: 2, toAssign: 1, toMove: 0 })
  })

  it('préfère les non rangées, puis déplace depuis les autres conteneurs', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 3)
    const other = seed.deckbox('Other')
    const col = seed.owned(DM, 3)
    seed.inDeckbox(other, col, 1) // 2 non rangées + 1 ailleurs
    const box = seed.deckbox('Box')

    const plan = await planDeckToDeckbox(deck, box)
    expect(plan.lines[0]).toMatchObject({ toAssign: 2, toMove: 1 })
    expect(plan.lines[0].movedFrom).toEqual([{ containerId: other, name: 'Other', qty: 1 }])
    expect(plan.totalToPlace).toBe(3)
  })

  it('multi-conteneurs sources : pris dans l’ordre des noms jusqu’au besoin', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 3)
    const binder = seed.binder('B-Binder')
    const bulk = seed.bulkBox('A-Bulk')
    const deckboxSrc = seed.deckbox('C-Deckbox')
    const c1 = seed.owned(DM, 2)
    const c2 = seed.owned(DM_ALT, 1)
    const c3 = seed.owned(DM, 1)
    seed.inBulk(bulk, c1, 2)
    seed.inBinder(binder, c2, 0, 0, 0)
    seed.inDeckbox(deckboxSrc, c3, 1)
    const box = seed.deckbox('Box')

    const plan = await planDeckToDeckbox(deck, box)
    expect(plan.lines[0]).toMatchObject({ owned: 4, toAssign: 0, toMove: 3 })
    expect(plan.lines[0].movedFrom).toEqual([
      { containerId: bulk, name: 'A-Bulk', qty: 2 },
      { containerId: binder, name: 'B-Binder', qty: 1 },
    ])
  })

  it('un conteneur supprimé ne retient plus ses cartes (elles sont non rangées)', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 2)
    const gone = seed.bulkBox('Gone')
    seed.inBulk(gone, seed.owned(DM, 2), 2)
    seed.softDeleteContainer(gone)
    const box = seed.deckbox('Box')

    const plan = await planDeckToDeckbox(deck, box)
    expect(plan.lines[0]).toMatchObject({ toAssign: 2, toMove: 0, movedFrom: [] })
  })

  it('isole par jeu : un même card_id d’un autre jeu ne compte pas', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 2)
    seed.owned(DM, 2, 'mtg')
    const box = seed.deckbox('Box')

    const plan = await planDeckToDeckbox(deck, box)
    expect(plan.lines[0]).toMatchObject({ owned: 0, missing: 2 })
  })

  it('purge : les cartes étrangères au deck présentes dans la deckbox', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 1)
    seed.owned(DM, 1)
    const box = seed.deckbox('Box')
    seed.inDeckbox(box, seed.owned(POT, 2), 2)
    seed.inDeckbox(box, seed.owned(BEWD, 1), 1)

    const plan = await planDeckToDeckbox(deck, box)
    expect(plan.purge).toEqual(
      expect.arrayContaining([
        { name: 'Pot of Greed', qty: 2 },
        { name: 'Blue-Eyes White Dragon', qty: 1 },
      ])
    )
    expect(plan.purgeTotal).toBe(3)
    expect(plan.currentInBox).toBe(3)
    expect(plan.neededCapacity).toBe(3 - 3 + 1)
  })

  describe('capacité', () => {
    function setup(capacity: number | null) {
      const deck = seed.deck()
      seed.deckCard(deck, DM, 3)
      seed.owned(DM, 3)
      const box = seed.deckbox('Box', capacity)
      seed.inDeckbox(box, seed.owned(POT, 1), 1) // purgée → libère 1 place
      return { deck, box }
    }

    it('illimitée (NULL) : jamais de dépassement', async () => {
      const { deck, box } = setup(null)
      const plan = await planDeckToDeckbox(deck, box)
      expect(plan.capacity).toBeNull()
      expect(plan.willExceed).toBe(false)
    })

    it('la purge est déduite avant le calcul', async () => {
      const { deck, box } = setup(3)
      const plan = await planDeckToDeckbox(deck, box)
      expect(plan.neededCapacity).toBe(3)
      expect(plan.willExceed).toBe(false)
    })

    it('dépassement détecté', async () => {
      const { deck, box } = setup(2)
      const plan = await planDeckToDeckbox(deck, box)
      expect(plan.neededCapacity).toBe(3)
      expect(plan.willExceed).toBe(true)
    })
  })

  // Une entrée de collection supprimée (removeCard = soft delete) garde ses
  // lignes d'assignation : le plan ne doit pas la compter comme présente.
  describe('entrées de collection supprimées', () => {
    it('ne comptent pas comme déjà dans la deckbox', async () => {
      const deck = seed.deck()
      seed.deckCard(deck, DM, 1)
      const box = seed.deckbox('Box')
      const dead = seed.owned(DM, 1)
      seed.inDeckbox(box, dead, 1)
      seed.softDeleteCollection(dead)
      seed.owned(DM, 1) // la vraie copie, non rangée

      const plan = await planDeckToDeckbox(deck, box)
      expect(plan.lines[0]).toMatchObject({ owned: 1, alreadyHere: 0, toAssign: 1 })
      expect(plan.currentInBox).toBe(0)
      expect(plan.purge).toEqual([])
    })

    it('ne sont pas proposées comme source à déplacer', async () => {
      const deck = seed.deck()
      seed.deckCard(deck, DM, 1)
      const ghost = seed.bulkBox('A-Ghost')
      const real = seed.bulkBox('B-Real')
      const dead = seed.owned(DM, 1)
      seed.inBulk(ghost, dead, 1)
      seed.softDeleteCollection(dead)
      seed.inBulk(real, seed.owned(DM, 1), 1)
      const box = seed.deckbox('Box')

      const plan = await planDeckToDeckbox(deck, box)
      expect(plan.lines[0].movedFrom).toEqual([{ containerId: real, name: 'B-Real', qty: 1 }])
    })
  })
})

// ============================================================
// APPLY
// ============================================================

describe('applyDeckToDeckbox', () => {
  it('assigne les non rangées et lie le deck à la deckbox', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 2)
    seed.deckCard(deck, BEWD, 1)
    seed.owned(DM, 3)
    seed.owned(BEWD, 1)
    const box = seed.deckbox('Box')

    await applyDeckToDeckbox(deck, box)
    expect(contentsOf(dbs, box)).toEqual({ [DM]: 2, [BEWD]: 1 })
    expect(deckboxesOfDeck(dbs, deck)).toEqual([box])
    expect(await deckCurrentDeckbox(deck)).toEqual({ id: box, name: 'Box' })
  })

  it('répartit l’assignation sur plusieurs entrées (alias), sans sur-assigner', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 3)
    seed.owned(DM, 1)
    seed.owned(DM_ALT, 1)
    seed.owned(DM, 2)
    const box = seed.deckbox('Box')

    await applyDeckToDeckbox(deck, box)
    const c = contentsOf(dbs, box)
    expect((c[DM] ?? 0) + (c[DM_ALT] ?? 0)).toBe(3)
    expect(overAssigned()).toEqual([])
  })

  it('déplace depuis deckbox, binder et bulk (partiel et total)', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 4)
    const bulk = seed.bulkBox('A-Bulk')
    const binder = seed.binder('B-Binder')
    const other = seed.deckbox('C-Deckbox')
    seed.inBulk(bulk, seed.owned(DM, 2), 2)
    seed.inBinder(binder, seed.owned(DM_ALT, 1), 0, 0, 0)
    seed.inBinder(binder, seed.owned(BEWD, 1), 0, 0, 1) // ne bouge pas
    seed.inDeckbox(other, seed.owned(DM, 3), 3)
    const box = seed.deckbox('Box')

    await applyDeckToDeckbox(deck, box)
    const c = contentsOf(dbs, box)
    expect((c[DM] ?? 0) + (c[DM_ALT] ?? 0)).toBe(4)
    expect(contentsOf(dbs, bulk)).toEqual({})
    expect(contentsOf(dbs, binder)).toEqual({ [BEWD]: 1 })
    expect(contentsOf(dbs, other)).toEqual({ [DM]: 2 }) // 1 seule copie prise
    expect(overAssigned()).toEqual([])
  })

  it('purge les cartes étrangères (elles redeviennent non rangées), garde les alt arts', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 1)
    const box = seed.deckbox('Box')
    seed.inDeckbox(box, seed.owned(DM_ALT, 1), 1)
    const pot = seed.owned(POT, 2)
    seed.inDeckbox(box, pot, 2)

    await applyDeckToDeckbox(deck, box)
    expect(contentsOf(dbs, box)).toEqual({ [DM_ALT]: 1 })
    // la collection n'est pas touchée : la carte purgée existe toujours
    const row = dbs.user.raw.prepare(`SELECT quantity FROM collection WHERE id = ?`).get(pot) as {
      quantity: number
    }
    expect(row.quantity).toBe(2)
  })

  it('relève la capacité quand elle est dépassée', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 3)
    seed.owned(DM, 3)
    const box = seed.deckbox('Box', 2)

    await applyDeckToDeckbox(deck, box)
    expect(capacityOf(dbs, box)).toBe(3)
    expect(contentsOf(dbs, box)).toEqual({ [DM]: 3 })
  })

  it('ne touche pas une capacité suffisante ou illimitée', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 1)
    seed.owned(DM, 2)
    const big = seed.deckbox('Big', 60)
    await applyDeckToDeckbox(deck, big)
    expect(capacityOf(dbs, big)).toBe(60)

    const unlimited = seed.deckbox('Unlimited', null)
    await applyDeckToDeckbox(deck, unlimited)
    expect(capacityOf(dbs, unlimited)).toBeNull()
  })

  it('un deck vit dans une seule deckbox : re-ranger remplace le lien', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 2)
    seed.owned(DM, 2)
    const first = seed.deckbox('First')
    const second = seed.deckbox('Second')

    await applyDeckToDeckbox(deck, first)
    await applyDeckToDeckbox(deck, second)
    expect(deckboxesOfDeck(dbs, deck)).toEqual([second])
    // « last in wins » : les copies ont suivi
    expect(contentsOf(dbs, first)).toEqual({})
    expect(contentsOf(dbs, second)).toEqual({ [DM]: 2 })
  })

  it('idempotent : un second apply ne change rien', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 2)
    const bulk = seed.bulkBox('Bulk')
    seed.inBulk(bulk, seed.owned(DM, 1), 1)
    seed.owned(DM, 1)
    const box = seed.deckbox('Box')

    await applyDeckToDeckbox(deck, box)
    const after1 = contentsOf(dbs, box)
    await applyDeckToDeckbox(deck, box)
    expect(contentsOf(dbs, box)).toEqual(after1)
    expect((await planDeckToDeckbox(deck, box)).lines).toEqual([])
  })

  it('n’emporte pas une entrée supprimée depuis un autre conteneur', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 1)
    const ghost = seed.bulkBox('A-Ghost')
    const real = seed.bulkBox('B-Real')
    const dead = seed.owned(DM, 1)
    seed.inBulk(ghost, dead, 1)
    seed.softDeleteCollection(dead)
    const live = seed.owned(DM, 1)
    seed.inBulk(real, live, 1)
    const box = seed.deckbox('Box')

    await applyDeckToDeckbox(deck, box)
    const inBox = dbs.user.raw
      .prepare(`SELECT collection_id FROM deckbox_cards WHERE deckbox_id = ?`)
      .all(box) as { collection_id: string }[]
    expect(inBox.map((r) => r.collection_id)).toEqual([live])
  })
})
