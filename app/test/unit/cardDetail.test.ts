import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabases, type TestDatabases } from './helpers/testDb'
import { printing, rarities, ygoCard } from './helpers/ygoCards'

// ============================================================
// fiche carte — stats, impressions (avec toutes leurs raretés),
// artworks regroupés par alias.
// ============================================================

const h = vi.hoisted(() => ({ dbs: null as unknown as TestDatabases }))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))

const { getCardDetail, printingRarities } = await import('~/services/card/detail')

const DM = '46986414'
const DM_ALT = '36996508'
const DECODE = '1861629'

let dbs: TestDatabases

beforeEach(() => {
  dbs = createTestDatabases()
  h.dbs = dbs
  ygoCard(dbs, {
    id: DM,
    name: 'Dark Magician',
    text: 'The ultimate wizard.',
    type: 'Normal Monster',
    attribute: 'DARK',
    race: 'Spellcaster',
    atk: 2500,
    def: 2100,
    level: 7,
    archetype: 'Dark Magician',
  })
  ygoCard(dbs, { id: DM_ALT, name: 'Dark Magician', alias: DM, type: 'Normal Monster' })
  ygoCard(dbs, {
    id: DECODE,
    name: 'Decode Talker',
    type: 'Link Monster',
    link: 3,
    markers: ['Top', 'Bottom-Left', 'Bottom-Right'],
    banlist: 'Limited',
  })
  printing(dbs, 'SDY-006', DM, 'Starter Deck: Yugi', 'Ultra Rare')
  printing(dbs, 'LOB-EN005', DM, 'Legend of Blue Eyes', 'Ultra Rare')
  printing(dbs, 'RA01-EN051', DM, 'Rarity Collection', 'Platinum Secret Rare')
  rarities(dbs, 'RA01-EN051', 'Super Rare', 'Ultra Rare', 'Platinum Secret Rare')
})

describe('fiche', () => {
  it('carte inconnue → null', async () => {
    expect(await getCardDetail('ygo', '999')).toBeNull()
  })

  it('stats et texte', async () => {
    expect(await getCardDetail('ygo', DM)).toMatchObject({
      game: 'ygo',
      id: DM,
      name: 'Dark Magician',
      legalText: 'The ultimate wizard.',
      type: 'Normal Monster',
      attribute: 'DARK',
      race: 'Spellcaster',
      atk: 2500,
      def: 2100,
      level: 7,
      archetype: 'Dark Magician',
      linkMarkers: null,
    })
  })

  it('Link : flèches décodées, banlist', async () => {
    expect(await getCardDetail('ygo', DECODE)).toMatchObject({
      linkValue: 3,
      linkMarkers: ['Top', 'Bottom-Left', 'Bottom-Right'],
      banlistTcg: 'Limited',
    })
  })

  it('impressions triées par extension, avec toutes leurs raretés', async () => {
    const d = (await getCardDetail('ygo', DM))!
    expect(d.printings.map((p) => p.setName)).toEqual([
      'Legend of Blue Eyes',
      'Rarity Collection',
      'Starter Deck: Yugi',
    ])
    const ra = d.printings.find((p) => p.id === 'RA01-EN051')!
    expect(ra.rarities).toEqual(['Platinum Secret Rare', 'Super Rare', 'Ultra Rare'])
    // sans ligne dans printing_rarities : la rareté unique de printings
    expect(d.printings.find((p) => p.id === 'LOB-EN005')!.rarities).toEqual(['Ultra Rare'])
  })

  it('artworks : les mêmes depuis l’artwork principal ou alternatif', async () => {
    const fromMain = (await getCardDetail('ygo', DM))!.artworks.map((a) => a.id)
    const fromAlt = (await getCardDetail('ygo', DM_ALT))!.artworks.map((a) => a.id)
    expect(fromMain).toEqual([DM_ALT, DM].sort())
    expect(fromAlt).toEqual(fromMain)
  })

  it('jeu sans fournisseur → erreur explicite', () => {
    expect(() => getCardDetail('mtg', 'x')).toThrow(/mtg/)
  })
})

describe('raretés d’une impression', () => {
  it('toutes celles connues, sinon celle de printings, sinon aucune', async () => {
    expect(await printingRarities('ygo', 'RA01-EN051')).toHaveLength(3)
    expect(await printingRarities('ygo', 'SDY-006')).toEqual(['Ultra Rare'])
    expect(await printingRarities('ygo', 'ZZZ-000')).toEqual([])
    expect(await printingRarities('mtg', 'RA01-EN051')).toEqual([])
  })
})
