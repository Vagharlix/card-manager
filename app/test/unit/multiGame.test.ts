import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabases, type TestDatabases } from './helpers/testDb'
import { createSeeder } from './helpers/seed'
import { FAKE, fakeCard, installFakeGame, uninstallFakeGame } from './helpers/fakeGame'

// ============================================================
// MULTI-JEU — un faux jeu (helpers/fakeGame.ts : schéma de base de
// cartes, vocabulaire, règles de deck, recherche à lui) traverse tous les
// services génériques, à côté de YGO. Si ça passe, rien de générique ne
// dépend de YGO. Plus une garde : aucun « ygo » en dur hors des modules
// propres à YGO.
// ============================================================

const h = vi.hoisted(() => ({ dbs: null as unknown as TestDatabases }))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))

const collection = await import('~/services/collection')
const containers = await import('~/services/containers')
const decks = await import('~/services/decks')
const deckLink = await import('~/services/deckLink')
const share = await import('~/services/share')
const backup = await import('~/services/backup')
const settings = await import('~/services/settings')
const { searchCards, countCards } = await import('~/services/search')
const { getCardDetail, printingRarities } = await import('~/services/card/detail')
const { canScan } = await import('~/services/scan')
const { allGames } = await import('~/services/game')
const { syncNow, MemoryTransport } = await import('~/services/userSync')

// faux jeu : un héros, une unité avec une variante d'illustration, une
// unité limitée en standard, une interdite en standard
const HERO = 'FK-HERO'
const UNIT = 'FK-001'
const UNIT_ALT = 'FK-001-ALT'
const RESTRICTED = 'FK-002'
const BANNED = 'FK-003'
// YGO : même id texte côté faux jeu pour vérifier l'isolation
const DM = '46986414'

let dbs: TestDatabases

beforeEach(async () => {
  dbs = createTestDatabases()
  h.dbs = dbs
  await installFakeGame(dbs)
  fakeCard(HERO, 'Aria the Bold', { kind: 'Hero', power: 9 })
  fakeCard(UNIT, 'Stone Golem', { power: 3 })
  fakeCard(UNIT_ALT, 'Stone Golem', { power: 3, base: UNIT })
  fakeCard(RESTRICTED, 'Time Twister', { kind: 'Spell', bans: { standard: 'restricted' } })
  fakeCard(BANNED, 'Doom Engine', { bans: { standard: 'banned' } })
  createSeeder(dbs).card(DM, 'Dark Magician')
  settings.invalidateSettingsCache()
})

afterEach(async () => {
  await uninstallFakeGame()
  dbs.user.close()
  dbs.ygo.close()
})

describe('registre', () => {
  it('le faux jeu est un jeu comme un autre', () => {
    expect(allGames().map((g) => g.id)).toEqual(['ygo', 'mtg', FAKE])
    expect(canScan(FAKE)).toBe(false)
    expect(canScan('ygo')).toBe(true)
  })

  it('défauts d’ajout tirés de sa définition (états et langues à lui)', async () => {
    const id = await collection.addCard({ game: FAKE, cardId: UNIT })
    const [entry] = await collection.entriesForCard(FAKE, UNIT)
    expect(entry).toMatchObject({ id, condition: 'LP', language: 'de' })
    expect(await settings.getDefaultCondition('ygo')).toBe('NM')
  })
})

describe('collection et rangements', () => {
  it('regroupe les variantes par carte logique, isolé de YGO', async () => {
    await collection.addCard({ game: FAKE, cardId: UNIT, quantity: 2 })
    await collection.addCard({ game: FAKE, cardId: UNIT_ALT, quantity: 1 })
    await collection.addCard({ game: 'ygo', cardId: DM, quantity: 5 })

    const cards = await collection.listCollectionCards(FAKE)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      game: FAKE,
      rootId: UNIT,
      displayId: UNIT,
      name: 'Stone Golem',
      totalQty: 3,
    })
    expect((await collection.listCollectionCards('ygo'))[0]).toMatchObject({ totalQty: 5 })
    expect(await collection.ownedCardIds(FAKE)).toEqual(new Set([UNIT, UNIT_ALT]))
  })

  it('une deckbox contient des cartes des deux jeux, listées par jeu', async () => {
    await collection.addCard({ game: FAKE, cardId: UNIT_ALT, quantity: 2 })
    await collection.addCard({ game: 'ygo', cardId: DM, quantity: 1 })
    const box = await containers.createDeckbox('Mixed')
    expect(await containers.assignCardToContainer(FAKE, UNIT_ALT, box, 'deckbox', 2)).toBe(2)
    expect(await containers.assignCardToContainer('ygo', DM, box, 'deckbox', 1)).toBe(1)

    expect(await containers.listContainerCards(box, 'deckbox', FAKE)).toMatchObject([
      { game: FAKE, rootId: UNIT, name: 'Stone Golem', totalQty: 2 },
    ])
    expect(await containers.listContainerCards(box, 'deckbox', 'ygo')).toMatchObject([
      { rootId: DM, totalQty: 1 },
    ])
    expect(await containers.unrangedCount(FAKE)).toBe(0)
  })

  it('classeur et non rangées', async () => {
    await collection.addCard({ game: FAKE, cardId: UNIT, quantity: 3 })
    const binder = await containers.createBinder('Fake binder', 1, 3, 3)
    await containers.assignCardToContainer(FAKE, UNIT, binder, 'binder', 1)
    expect(await containers.listBinderSlots(binder, FAKE)).toMatchObject([
      { cardId: UNIT, name: 'Stone Golem' },
    ])
    expect(await containers.listUnrangedCards(FAKE)).toMatchObject([{ rootId: UNIT, totalQty: 2 }])
  })
})

describe('decks (règles du faux jeu)', () => {
  it('placement, limite par carte logique, restrictions par format', async () => {
    const deck = await decks.createDeck(FAKE, 'Golems', 'standard')
    const add = (id: string, type: string | null) => decks.addCardToDeck(deck, FAKE, id, type)

    expect(await add(HERO, 'Hero')).toEqual({ ok: true })
    expect((await add(HERO, 'Hero')).ok).toBe(false) // un seul héros
    for (let i = 0; i < 2; i++) await add(UNIT, 'Unit')
    for (let i = 0; i < 2; i++) await add(UNIT_ALT, 'Unit')
    // 4 exemplaires max, toutes variantes confondues
    expect(await add(UNIT_ALT, 'Unit')).toMatchObject({ ok: false, limit: 4 })
    expect(await add(RESTRICTED, 'Spell')).toEqual({ ok: true })
    expect(await add(RESTRICTED, 'Spell')).toMatchObject({ ok: false, limit: 1 })
    expect(await add(BANNED, 'Unit')).toMatchObject({ ok: false, limit: 0 })

    const contents = await decks.getDeckContents(deck)
    expect(contents.commander).toMatchObject([{ cardId: HERO, quantity: 1 }])
    expect(contents.main.map((c) => [c.cardId, c.quantity])).toEqual([
      [UNIT, 2],
      [UNIT_ALT, 2],
      [RESTRICTED, 1],
    ])
    expect((await decks.validateDeck(deck)).valid).toBe(true)
  })

  it('validation : une carte devenue interdite est signalée (toutes variantes)', async () => {
    const deck = await decks.createDeck(FAKE, 'Free', 'free')
    for (let i = 0; i < 2; i++) await decks.addCardToDeck(deck, FAKE, BANNED, 'Unit')
    expect((await decks.validateDeck(deck)).valid).toBe(true) // aucune règle en « free »
    await decks.updateDeckMeta(deck, { format: 'standard' })
    const v = await decks.validateDeck(deck)
    expect(v.valid).toBe(false)
    expect(v.violations).toMatchObject([{ rootId: BANNED, quantity: 2, limit: 0 }])
    expect(v.flagged).toEqual(new Set([BANNED]))
  })

  it('possédées comptées par carte logique ; rangement deck → deckbox', async () => {
    await collection.addCard({ game: FAKE, cardId: UNIT_ALT, quantity: 3 })
    const deck = await decks.createDeck(FAKE, 'Golems')
    for (let i = 0; i < 2; i++) await decks.addCardToDeck(deck, FAKE, UNIT, 'Unit')
    expect((await decks.getDeckContents(deck)).main).toMatchObject([
      { cardId: UNIT, quantity: 2, owned: 3 },
    ])

    const box = await containers.createDeckbox('Golem box')
    const plan = await deckLink.planDeckToDeckbox(deck, box)
    expect(plan.lines).toMatchObject([{ rootId: UNIT, name: 'Stone Golem', needed: 2 }])
    await deckLink.applyDeckToDeckbox(deck, box)
    expect(await containers.listContainerCards(box, 'deckbox', FAKE)).toMatchObject([
      { rootId: UNIT, totalQty: 2 },
    ])
    expect((await decks.listDecks(FAKE)).map((d) => d.name)).toEqual(['Golems'])
    expect(await decks.listDecks('ygo')).toEqual([])
  })
})

describe('recherche, fiche, raretés', () => {
  it('passent par le module du jeu', async () => {
    expect((await searchCards(FAKE, { query: 'golem' })).map((r) => r.id)).toEqual([UNIT, UNIT_ALT])
    expect(await countCards(FAKE, { query: 'golem' })).toBe(2)
    expect(await getCardDetail(FAKE, HERO)).toMatchObject({
      name: 'Aria the Bold',
      facts: [
        { label: 'Kind', value: 'Hero' },
        { label: 'Power', value: '9' },
      ],
    })
    dbs.cards(FAKE).raw.exec(
      `INSERT INTO printings VALUES ('S1-001', '${UNIT}', 'Set One', 'S1-001', 'Common', NULL);
       INSERT INTO printing_rarities VALUES ('S1-001', 'Foil', NULL), ('S1-001', 'Common', NULL)`
    )
    expect(await printingRarities(FAKE, 'S1-001')).toEqual(['Common', 'Foil'])
  })
})

describe('partage (ids texte → CMSHARE2)', () => {
  it('code v2, lecture croisée avec ma collection', async () => {
    await collection.addCard({ game: FAKE, cardId: UNIT, quantity: 2, tradeQty: 1 })
    await collection.addCard({ game: FAKE, cardId: UNIT_ALT, quantity: 1 })
    await collection.addCard({ game: FAKE, cardId: HERO, quantity: 1 })
    const code = await share.shareCode(FAKE, { owner: 'Félix' })
    expect(code).toMatch(/^CMSHARE2:[A-Z2-7]+$/)

    // le QR animé transporte aussi un code v2
    const asm = new share.FrameAssembler()
    let done: string | null = null
    for (const f of share.toFrames(code, 40).reverse()) {
      const r = asm.add(f)
      if (r.status === 'complete') done = r.code
    }
    expect(done).toBe(code)

    const payload = share.decodeShare(code)
    expect(payload.game).toBe(FAKE)
    const view = await share.resolveShare(payload)
    expect(view).toEqual([
      { rootId: HERO, displayId: HERO, name: 'Aria the Bold', qty: 1, trade: 0, mine: 1 },
      { rootId: UNIT, displayId: UNIT, name: 'Stone Golem', qty: 3, trade: 1, mine: 3 },
    ])
  })

  it('YGO reste en v1', async () => {
    await collection.addCard({ game: 'ygo', cardId: DM })
    expect(await share.shareCode('ygo', { owner: 'x' })).toMatch(/^CMSHARE1:/)
  })

  it('un partage d’un jeu inconnu de cette version s’affiche quand même (ids bruts)', async () => {
    const code = share.encodeShare({
      game: 'future-game',
      owner: 'x',
      createdAt: Date.now(),
      cards: [{ id: 'abc', qty: 2, trade: 0 }],
    })
    expect(await share.resolveShare(share.decodeShare(code))).toMatchObject([
      { rootId: 'abc', name: '#abc', qty: 2, mine: 0 },
    ])
  })
})

describe('sauvegarde et synchro', () => {
  it('CSV : noms lus dans la base de cartes de chaque jeu', async () => {
    await collection.addCard({ game: FAKE, cardId: UNIT_ALT })
    await collection.addCard({ game: 'ygo', cardId: DM })
    const csv = await backup.exportCollectionCsv()
    expect(csv).toContain(`${FAKE},${UNIT_ALT},Stone Golem,`)
    expect(csv).toContain(`ygo,${DM},Dark Magician,`)
  })

  it('les données du faux jeu voyagent avec la synchro entre appareils', async () => {
    await collection.addCard({ game: FAKE, cardId: UNIT, quantity: 2 })
    const deck = await decks.createDeck(FAKE, 'Golems')
    await decks.addCardToDeck(deck, FAKE, UNIT, 'Unit')
    const cloud = new MemoryTransport()
    await syncNow(cloud)

    // second appareil : bases neuves, même transport
    const pc = dbs
    const phone = createTestDatabases({ ygo: pc.ygo })
    phone.games.set(FAKE, pc.cards(FAKE))
    h.dbs = phone
    await syncNow(cloud)
    expect(await collection.listCollectionCards(FAKE)).toMatchObject([
      { rootId: UNIT, totalQty: 2 },
    ])
    expect((await decks.getDeckContents(deck)).main).toMatchObject([
      { cardId: UNIT, quantity: 1, owned: 2 },
    ])
    phone.user.close()
    h.dbs = pc
  })
})

// ============================================================
// GARDE : les couches génériques ne nomment jamais YGO. Seuls les
// fichiers propres à YGO (et le registre qui l'enregistre) le peuvent.
// ============================================================

const APP = fileURLToPath(new URL('../../app', import.meta.url))
const YGO_FILES = new Set([
  'services/game/ygo.ts', // définition du jeu
  'services/game/index.ts', // registre (jeu de base)
  'services/game/modules/ygo.ts', // module YGO
  'services/deck/ygo.ts',
  'services/search/ygo.ts',
  'services/search/types.ts', // YgoFilters (filtres propres à YGO)
  'services/search/index.ts', // ré-export des options de filtres YGO
  'services/card/ygo.ts',
  'services/card/detail.ts', // type YgoCardDetail
  'services/scan/ygo.ts',
  'services/scan/text.ts', // codes d'impression YGO (OCR)
  'services/sync.ts', // source de données YGOPRODeck
  'components/searchFilters.vue', // filtres YGO
  'utils/gameUi.ts', // panneau de filtres par jeu
  'plugins/test-reset.client.ts', // helpers E2E (fixture YGO)
])
const MTG_FILES = new Set([
  'services/game/mtg.ts',
  'services/game/index.ts',
  'services/game/modules/mtg.ts',
  'services/deck/mtg.ts',
  'services/search/mtg.ts',
  'services/card/mtg.ts',
  'services/scan/mtg.ts',
  'services/mtgData/import.ts',
  'services/mtgData/sync.ts',
  'components/MtgSearchFilters.vue',
  'utils/gameUi.ts',
  'plugins/test-reset.client.ts', // helpers E2E (import d'un échantillon)
])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|vue)$/.test(name) ? [path] : []
  })
}

describe('garde anti « ygo » / « mtg » en dur', () => {
  it('aucune couche générique ne nomme un jeu ni ses tables', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(APP)) {
      const rel = relative(APP, file).replace(/\\/g, '/')
      const code = readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l)) // commentaires
        .map((l) => l.replace(/\s\/\/.*$/, '')) // commentaire en fin de ligne
        .join('\n')
      if (!YGO_FILES.has(rel) && /['"`]ygo['"`]|ygo_details|ygoprodeck/i.test(code))
        offenders.push(rel)
      if (!MTG_FILES.has(rel) && /['"`]mtg['"`]|mtg_(oracle|prints)|scryfall/i.test(code))
        offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})
