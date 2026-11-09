import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabases, type TestDatabases } from './helpers/testDb'

// ============================================================
// Magic de bout en bout sur l'échantillon Scryfall réel
// (fixtures/scryfall-sample.jsonl) importé par le vrai importeur :
// recherche, fiche, règles de deck par format, collection, partage, scan.
// ============================================================

const h = vi.hoisted(() => ({ dbs: null as unknown as TestDatabases }))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))

const { importMtg } = await import('~/services/mtgData/sync')
const { searchCards, countCards } = await import('~/services/search')
const { getCardDetail } = await import('~/services/card/detail')
const decks = await import('~/services/decks')
const collection = await import('~/services/collection')
const share = await import('~/services/share')
const { identifyCard, canScan } = await import('~/services/scan')
const { extractCollectorRefs, collectorNumbers } = await import('~/services/scan/mtg')
const { ftsQuery } = await import('~/services/search/mtg')

const SAMPLE = readFileSync(new URL('./fixtures/scryfall-sample.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
const ids = (name: string): string[] => SAMPLE.filter((c) => c.name === name).map((c) => c.id)
const id = (name: string) => ids(name)[0]!

let dbs: TestDatabases
beforeEach(async () => {
  dbs = createTestDatabases()
  h.dbs = dbs
  let done = false
  await importMtg(
    dbs.mtg as never,
    async () => {
      done = true
      return { items: SAMPLE, read: 1, total: 1, done }
    },
    'test'
  )
})
afterEach(() => {
  for (const db of [dbs.user, dbs.ygo, dbs.mtg]) db.close()
})

const names = (r: { name: string }[]) => r.map((x) => x.name)

describe('recherche', () => {
  it('une ligne par carte logique, nom exact en premier', async () => {
    expect(names(await searchCards('mtg', { query: 'bolt' }))).toEqual(['Lightning Bolt'])
    const counter = await searchCards('mtg', { query: 'counter', field: 'effect' })
    expect(names(counter)).toContain('Counterspell')
    // l'id renvoyé est une impression réelle de la carte
    expect(ids('Lightning Bolt')).toContain(
      (await searchCards('mtg', { query: 'Lightning Bolt' }))[0]!.id
    )
    // ponctuation tolérée
    expect(names(await searchCards('mtg', { query: "atraxa, praetors' voice" }))).toEqual([
      "Atraxa, Praetors' Voice",
    ])
  })

  it('filtres : couleurs, types, valeur de mana, légalité', async () => {
    const greenCreatures = await searchCards('mtg', {
      filters: { colors: ['G'], types: ['Creature'] },
    })
    // « a toutes ces couleurs » : les multicolores vertes en font partie
    expect(names(greenCreatures)).toEqual([
      "Atraxa, Praetors' Voice",
      'Llanowar Elves',
      'Tarmogoyf',
    ])
    expect(names(await searchCards('mtg', { filters: { colors: ['U', 'R'] } }))).toEqual([
      'Fire // Ice',
    ])
    expect(names(await searchCards('mtg', { filters: { cmc: { op: '>=', value: 4 } } }))).toEqual([
      "Atraxa, Praetors' Voice",
      'Fire // Ice', // carte coupée : valeur de mana = somme des deux moitiés
      'Jace, the Mind Sculptor',
    ])
    const legacy = names(await searchCards('mtg', { filters: { format: 'legacy' }, limit: 100 }))
    expect(legacy).not.toContain('Black Lotus') // bannie
    expect(legacy).not.toContain('Goblin') // jeton : pas légal
    expect(legacy).toContain('Brainstorm')
    expect(await countCards('mtg', { filters: { colorless: true, types: ['Land'] } })).toBe(2) // Forest, Snow-Covered Island
  })

  it('requête plein texte sûre', () => {
    expect(ftsQuery('light BOL', 'name')).toBe('name : "light"* AND name : "bol"*')
    expect(ftsQuery('  ,,  ', 'name')).toBeNull()
  })
})

describe('fiche', () => {
  it('toutes les impressions, chacune est une carte ; restrictions', async () => {
    const d = (await getCardDetail('mtg', id('Black Lotus')))!
    expect(d.name).toBe('Black Lotus')
    expect(d.printings).toHaveLength(2)
    expect(d.printings.every((p) => p.cardId === p.id && p.rarities.length === 1)).toBe(true)
    expect(d.facts.find((f) => f.label === 'Mana cost')?.value).toBe('{0}')
    expect(d.badges.map((b) => b.label)).toEqual(
      expect.arrayContaining(['Banned in Legacy', 'Restricted in Vintage', 'Reserved List'])
    )
    const delver = (await getCardDetail('mtg', id('Delver of Secrets // Insectile Aberration')))!
    expect(delver.facts.find((f) => f.label === 'Power/Toughness')?.value).toBe('1/1')
    expect(await getCardDetail('mtg', 'nope')).toBeNull()
  })
})

describe('decks : règles par format', () => {
  const add = (deck: string, name: string, n = 1, card = id(name)) =>
    (async () => {
      let last = { ok: true } as Awaited<ReturnType<typeof decks.addCardToDeck>>
      for (let i = 0; i < n; i++) last = await decks.addCardToDeck(deck, 'mtg', card, null)
      return last
    })()

  it('casual : 4 copies toutes impressions confondues ; terrains de base, Seven Dwarves', async () => {
    const deck = await decks.createDeck('mtg', 'Burn')
    const [a, b] = ids('Lightning Bolt')
    for (let i = 0; i < 2; i++) await decks.addCardToDeck(deck, 'mtg', a!, null)
    for (let i = 0; i < 2; i++) await decks.addCardToDeck(deck, 'mtg', b!, null)
    expect(await add(deck, 'Lightning Bolt')).toMatchObject({ ok: false, limit: 4 })
    expect((await add(deck, 'Forest', 20)).ok).toBe(true)
    expect((await add(deck, 'Seven Dwarves', 7)).ok).toBe(true)
    expect(await add(deck, 'Seven Dwarves')).toMatchObject({ ok: false, limit: 7 })
    expect((await add(deck, 'Relentless Rats', 12)).ok).toBe(true)
    const c = await decks.getDeckContents(deck)
    expect(c.main.reduce((s, x) => s + x.quantity, 0)).toBe(4 + 20 + 7 + 12)
  })

  it('vintage / legacy / commander', async () => {
    const vintage = await decks.createDeck('mtg', 'V', 'vintage')
    expect((await add(vintage, 'Black Lotus')).ok).toBe(true)
    expect(await add(vintage, 'Black Lotus')).toMatchObject({
      ok: false,
      limit: 1,
      formatStatus: 'restricted',
    })
    const legacy = await decks.createDeck('mtg', 'L', 'legacy')
    expect(await add(legacy, 'Sol Ring')).toMatchObject({
      ok: false,
      limit: 0,
      formatStatus: 'banned',
    })
    expect(await add(legacy, 'Goblin')).toMatchObject({ ok: false, formatStatus: 'not_legal' })
    const edh = await decks.createDeck('mtg', 'C', 'commander')
    expect((await add(edh, 'Counterspell')).ok).toBe(true)
    expect(await add(edh, 'Counterspell')).toMatchObject({ ok: false, limit: 1 })
    expect((await add(edh, 'Forest', 30)).ok).toBe(true)
    // le commandant se place à la main
    await decks.addCardToDeck(edh, 'mtg', id("Atraxa, Praetors' Voice"), null)
    await decks.moveCardBoard(edh, 'mtg', id("Atraxa, Praetors' Voice"), null, 'main', 'commander')
    expect((await decks.getDeckContents(edh)).commander).toMatchObject([{ quantity: 1 }])
  })

  it('validation : un deck casual passé en legacy signale les cartes bannies', async () => {
    const deck = await decks.createDeck('mtg', 'Old')
    await add(deck, 'Sol Ring', 2)
    await add(deck, 'Brainstorm', 4)
    expect((await decks.validateDeck(deck)).valid).toBe(true)
    await decks.updateDeckMeta(deck, { format: 'legacy' })
    const v = await decks.validateDeck(deck)
    expect(v.violations).toMatchObject([
      { name: 'Sol Ring', quantity: 2, limit: 0, formatStatus: 'banned' },
    ])
    expect(decks.deckEngine('mtg').limitLabel(0, 'banned')).toBe('banned')
  })
})

describe('collection et partage', () => {
  it('impressions regroupées par carte logique ; partage v2 croisé', async () => {
    const [a, b] = ids('Lightning Bolt')
    await collection.addCard({ game: 'mtg', cardId: a!, printingId: a!, quantity: 1 })
    await collection.addCard({ game: 'mtg', cardId: b!, printingId: b!, quantity: 3, tradeQty: 2 })
    const cards = await collection.listCollectionCards('mtg')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      name: 'Lightning Bolt',
      totalQty: 4,
      tradeQty: 2,
      displayId: b, // l'impression la plus possédée
    })

    const code = await share.shareCode('mtg', { owner: 'Félix' })
    expect(code).toMatch(/^CMSHARE2:/)
    expect(await share.resolveShare(share.decodeShare(code))).toMatchObject([
      { name: 'Lightning Bolt', qty: 4, trade: 2, mine: 4 },
    ])
  })
})

describe('scan', () => {
  it('lecture du bas de carte : extension, langue, numéro', () => {
    expect(extractCollectorRefs([{ text: 'BLB • EN' }, { text: 'MOM * FR  ARTIST NAME' }])).toEqual(
      [
        { set: 'blb', language: 'en' },
        { set: 'mom', language: 'fr' },
      ]
    )
    expect(extractCollectorRefs([{ text: '2021 • EN' }])).toEqual([]) // une année, pas une extension
    expect(
      collectorNumbers([{ text: '0280 L' }, { text: '031/145 M' }, { text: 'M10 • EN' }]).sort()
    ).toEqual(['280', '31'])
  })

  it('identifie l’impression exacte, sinon la carte par son nom', async () => {
    expect(canScan('mtg')).toBe(true)
    const jace = await identifyCard('mtg', [
      { text: 'Jace, the Mind Sculptor', y: 5 },
      { text: '031/145 M', y: 900 },
      { text: 'WWK • DE', y: 920 },
    ])
    expect(jace).toMatchObject({
      cardId: id('Jace, the Mind Sculptor'),
      printingLabel: 'WWK #31',
      via: 'setcode',
      language: 'de',
      firstEdition: false,
    })
    // nom mal lu, face avant d'une carte transformable
    const delver = await identifyCard('mtg', [{ text: 'Delver of Secrcts', y: 5 }])
    expect(delver).toMatchObject({ name: 'Delver of Secrets // Insectile Aberration', via: 'name' })
    expect(ids('Delver of Secrets // Insectile Aberration')).toContain(delver!.cardId)
    expect(await identifyCard('mtg', [{ text: 'Totally Unknown Card', y: 5 }])).toBeNull()
  })
})
