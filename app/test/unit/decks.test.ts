import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabases, type TestDatabases } from './helpers/testDb'
import { createSeeder } from './helpers/seed'

// ============================================================
// decks — placement auto (moteur YGO), limites de copies (alias,
// banlist par format), déplacements, validation, copies possédées.
// ============================================================

const h = vi.hoisted(() => ({ dbs: null as unknown as TestDatabases }))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))

const {
  addCardToDeck,
  moveCardBoard,
  validateDeck,
  getDeckContents,
  getDeckState,
  deckSearchMeta,
  limitCheck,
  validateContents,
  deckEngine,
} = await import('~/services/decks')
const { getYgoFilterOptions } = await import('~/services/search')

const DM = '46986414'
const DM_ALT = '36996508'
const POT = '55144522'
const POT_ALT = '55144523' // artwork fictif, hérite de la banlist de POT via alias
const ZEUS = '90448279' // XYZ Monster
const SANGAN = '26202165'

const EFFECT = 'Normal Monster'
const XYZ = 'XYZ Monster'

let dbs: TestDatabases
let seed: ReturnType<typeof createSeeder>

beforeEach(() => {
  dbs = createTestDatabases()
  h.dbs = dbs
  seed = createSeeder(dbs)
  seed.card(DM, 'Dark Magician', null, { type: EFFECT })
  seed.card(DM_ALT, 'Dark Magician', DM, { type: EFFECT })
  seed.card(POT, 'Pot of Greed', null, { type: 'Spell Card', tcg: 'Forbidden' })
  seed.card(POT_ALT, 'Pot of Greed', POT, { type: 'Spell Card' })
  seed.card(ZEUS, 'Divine Arsenal AA-ZEUS - Sky Thunder', null, { type: XYZ })
  seed.card(SANGAN, 'Sangan', null, { type: 'Effect Monster', tcg: 'Limited', ocg: null })
})

afterEach(() => {
  dbs.user.close()
  dbs.ygo.close()
})

function boards(deckId: string): Record<string, number> {
  const rows = dbs.user.raw
    .prepare(`SELECT card_id, board, quantity FROM deck_cards WHERE deck_id = ?`)
    .all(deckId) as { card_id: string; board: string; quantity: number }[]
  return Object.fromEntries(rows.map((r) => [`${r.card_id}@${r.board}`, r.quantity]))
}

describe('moteur YGO — placement automatique', () => {
  const engine = deckEngine('ygo')
  it.each([
    ['XYZ Monster', 'extra'],
    ['XYZ Pendulum Effect Monster', 'extra'],
    ['Synchro Tuner Monster', 'extra'],
    ['Fusion Monster', 'extra'],
    ['Link Monster', 'extra'],
    ['Effect Monster', 'main'],
    ['Pendulum Effect Ritual Monster', 'main'],
    ['Spell Card', 'main'],
  ])('%s → %s', (type, board) => {
    expect(engine.boardForCard({ cardId: 'x', type })).toBe(board)
  })
})

describe('addCardToDeck', () => {
  it('place un monstre Xyz dans l’Extra Deck', async () => {
    const deck = seed.deck()
    expect(await addCardToDeck(deck, 'ygo', ZEUS, XYZ)).toEqual({ ok: true })
    expect(boards(deck)).toEqual({ [`${ZEUS}@extra`]: 1 })
  })

  it('limite à 3 copies par carte logique, tous artworks confondus', async () => {
    const deck = seed.deck()
    for (const id of [DM, DM, DM_ALT]) {
      expect((await addCardToDeck(deck, 'ygo', id, EFFECT)).ok).toBe(true)
    }
    expect(await addCardToDeck(deck, 'ygo', DM_ALT, EFFECT)).toEqual({
      ok: false,
      reason: 'max',
      limit: 3,
      formatStatus: null,
    })
  })

  it('refuse une carte interdite en TCG, y compris via un artwork alternatif', async () => {
    const deck = seed.deck('Deck', 'ygo', 'tcg')
    expect(await addCardToDeck(deck, 'ygo', POT_ALT, 'Spell Card')).toEqual({
      ok: false,
      reason: 'forbidden',
      limit: 0,
      formatStatus: 'Forbidden',
    })
  })

  it('limitée : une seule copie en TCG, trois en OCG et en casual', async () => {
    const tcg = seed.deck('T', 'ygo', 'tcg')
    expect((await addCardToDeck(tcg, 'ygo', SANGAN, 'Effect Monster')).ok).toBe(true)
    expect(await addCardToDeck(tcg, 'ygo', SANGAN, 'Effect Monster')).toMatchObject({
      ok: false,
      reason: 'limited',
    })

    for (const format of ['ocg', 'casual']) {
      const deck = seed.deck(format, 'ygo', format)
      for (let i = 0; i < 3; i++) {
        expect((await addCardToDeck(deck, 'ygo', SANGAN, 'Effect Monster')).ok).toBe(true)
      }
    }
  })

  it('un board explicite l’emporte sur le placement automatique', async () => {
    const deck = seed.deck()
    await addCardToDeck(deck, 'ygo', DM, EFFECT, 'side')
    expect(boards(deck)).toEqual({ [`${DM}@side`]: 1 })
  })
})

describe('moveCardBoard', () => {
  it('déplace une copie sans être bloqué par la limite', async () => {
    const deck = seed.deck()
    for (let i = 0; i < 3; i++) await addCardToDeck(deck, 'ygo', DM, EFFECT)
    await moveCardBoard(deck, 'ygo', DM, EFFECT, 'main', 'side')
    expect(boards(deck)).toEqual({ [`${DM}@main`]: 2, [`${DM}@side`]: 1 })
  })
})

describe('validateDeck', () => {
  it('signale une carte interdite en TCG (tous ses artworks), pas en casual', async () => {
    const deck = seed.deck('Deck', 'ygo', 'tcg')
    seed.deckCard(deck, POT_ALT, 1)
    seed.deckCard(deck, DM, 2)

    const v = await validateDeck(deck)
    expect(v.valid).toBe(false)
    expect(v.violations).toEqual([
      {
        rootId: POT,
        name: 'Pot of Greed',
        quantity: 1,
        limit: 0,
        status: 'Forbidden',
        formatStatus: 'Forbidden',
      },
    ])
    expect([...v.flagged]).toEqual([POT_ALT])

    const casual = seed.deck('Casual', 'ygo', 'casual')
    seed.deckCard(casual, POT_ALT, 1)
    expect((await validateDeck(casual)).valid).toBe(true)
  })

  it('compte les copies sur tous les boards', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 2, 'main')
    seed.deckCard(deck, DM_ALT, 2, 'side')
    expect((await validateDeck(deck)).violations).toMatchObject([
      { rootId: DM, quantity: 4, limit: 3, status: 'Over' },
    ])
  })
})

describe('getDeckContents', () => {
  it('compte les copies possédées par carte logique (n’importe quel artwork)', async () => {
    const deck = seed.deck()
    seed.deckCard(deck, DM, 2)
    seed.deckCard(deck, ZEUS, 1, 'extra')
    seed.owned(DM_ALT, 2)
    seed.owned(DM, 1)

    const c = await getDeckContents(deck)
    expect(c.main).toMatchObject([{ cardId: DM, quantity: 2, owned: 3 }])
    expect(c.extra).toMatchObject([{ cardId: ZEUS, quantity: 1, owned: 0 }])
  })
})

// la page d'un deck affiche un changement avant de l'écrire : ses contrôles
// locaux doivent donner exactement ce que donne la base
describe('état du deck et contrôles locaux', () => {
  it('getDeckState : contenu (avec carte logique), limites du format, validation', async () => {
    const deck = seed.deck('Deck', 'ygo', 'tcg')
    seed.deckCard(deck, DM, 2)
    seed.deckCard(deck, DM_ALT, 2, 'side')
    seed.deckCard(deck, SANGAN, 1)
    seed.owned(DM_ALT, 1)

    const st = await getDeckState(deck)
    expect(st.format).toBe('tcg')
    expect(st.contents.main).toMatchObject([
      { cardId: DM, root: DM, quantity: 2, owned: 1 },
      { cardId: SANGAN, root: SANGAN, quantity: 1 },
    ])
    expect(st.contents.side).toMatchObject([{ cardId: DM_ALT, root: DM, quantity: 2 }])
    expect(st.limits.get(DM)).toEqual({ limit: 3, formatStatus: null })
    expect(st.limits.get(SANGAN)).toEqual({ limit: 1, formatStatus: 'Limited' })
    expect(st.validation).toEqual(await validateDeck(deck))
    expect(st.validation.violations).toMatchObject([{ rootId: DM, quantity: 4, limit: 3 }])
  })

  it('validateContents recalcule la validation après un changement local', async () => {
    const deck = seed.deck('Deck', 'ygo', 'tcg')
    seed.deckCard(deck, DM, 3)
    const st = await getDeckState(deck)
    expect(st.validation.valid).toBe(true)
    // une copie de plus en Side, à l'écran seulement
    const side = [{ ...st.contents.main[0]!, cardId: DM_ALT, quantity: 1 }]
    const local = validateContents({ ...st.contents, side }, st.limits)
    expect(local.violations).toMatchObject([{ rootId: DM, quantity: 4, status: 'Over' }])
    expect([...local.flagged].sort()).toEqual([DM, DM_ALT].sort())
  })

  it('limitCheck refuse comme addCardToDeck (même raison, même limite)', async () => {
    const deck = seed.deck('Deck', 'ygo', 'tcg')
    seed.deckCard(deck, SANGAN, 1)
    const engine = deckEngine('ygo')
    const meta = (await deckSearchMeta('ygo', [SANGAN, POT_ALT, DM])).get(SANGAN)!
    const local = limitCheck(
      engine,
      'tcg',
      { cardId: SANGAN, type: meta.type, banlist: meta.banlist },
      1
    )
    expect(local).toEqual(await addCardToDeck(deck, 'ygo', SANGAN, undefined, undefined, { format: 'tcg' }))
    expect(local).toMatchObject({ ok: false, reason: 'limited', limit: 1 })
    expect(limitCheck(engine, 'tcg', { cardId: SANGAN, type: null, banlist: meta.banlist }, 0)).toEqual({
      ok: true,
    })
  })

  it('deckSearchMeta : carte logique, type, statuts, exemplaires possédés (tous artworks)', async () => {
    seed.owned(DM, 2)
    seed.owned(DM_ALT, 1)
    const m = await deckSearchMeta('ygo', [DM_ALT, POT_ALT, ZEUS])
    expect(m.get(DM_ALT)).toEqual({ root: DM, type: EFFECT, banlist: {}, owned: 3 })
    expect(m.get(POT_ALT)).toMatchObject({ root: POT, banlist: { tcg: 'Forbidden' }, owned: 0 })
    expect(m.get(ZEUS)).toMatchObject({ root: ZEUS, type: XYZ })
  })

  it('addCardToDeck sans type le lit dans la base (placement Extra)', async () => {
    const deck = seed.deck()
    expect(await addCardToDeck(deck, 'ygo', ZEUS)).toEqual({ ok: true })
    expect(boards(deck)).toEqual({ [`${ZEUS}@extra`]: 1 })
  })
})

describe('filtres de recherche', () => {
  it('proposent « Xyz » quand la donnée écrit « XYZ Monster »', async () => {
    const { monsterTypes } = await getYgoFilterOptions()
    expect(monsterTypes).toContain('Xyz')
  })
})
