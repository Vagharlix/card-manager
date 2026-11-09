import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabases, type TestDatabases } from './helpers/testDb'
import { ygoCard } from './helpers/ygoCards'

// ============================================================
// recherche YGO — texte (FTS5), filtres, pagination ; search() et
// count() partagent la même requête : on vérifie qu'ils concordent.
// ============================================================

const h = vi.hoisted(() => ({ dbs: null as unknown as TestDatabases }))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))

const { searchCards, countCards, getYgoFilterOptions } = await import('~/services/search')

let dbs: TestDatabases

beforeEach(() => {
  dbs = createTestDatabases()
  h.dbs = dbs
  ygoCard(dbs, {
    id: '46986414',
    name: 'Dark Magician',
    text: 'The ultimate wizard in terms of attack and defense.',
    type: 'Normal Monster',
    attribute: 'DARK',
    race: 'Spellcaster',
    atk: 2500,
    def: 2100,
    level: 7,
    archetype: 'Dark Magician',
  })
  ygoCard(dbs, {
    id: '38033121',
    name: 'Dark Magician Girl',
    text: 'Gains 300 ATK for every "Dark Magician" in the GYs.',
    type: 'Effect Monster',
    attribute: 'DARK',
    race: 'Spellcaster',
    atk: 2000,
    def: 1700,
    level: 6,
    archetype: 'Dark Magician',
  })
  ygoCard(dbs, {
    id: '89631139',
    name: 'Blue-Eyes White Dragon',
    text: 'This legendary dragon is a powerful engine of destruction.',
    type: 'Normal Monster',
    attribute: 'LIGHT',
    race: 'Dragon',
    atk: 3000,
    def: 2500,
    level: 8,
    archetype: 'Blue-Eyes',
  })
  ygoCard(dbs, {
    id: '84013237',
    name: 'Number 39: Utopia',
    text: 'When a monster declares an attack: You can detach 1 material.',
    type: 'XYZ Monster',
    attribute: 'LIGHT',
    race: 'Warrior',
    atk: 2500,
    def: 2000,
    rank: 4,
  })
  ygoCard(dbs, {
    id: '1861629',
    name: 'Decode Talker',
    type: 'Link Monster',
    attribute: 'DARK',
    race: 'Cyberse',
    atk: 2300,
    link: 3,
    markers: ['Top', 'Bottom-Left', 'Bottom-Right'],
  })
  ygoCard(dbs, {
    id: '55144522',
    name: 'Pot of Greed',
    text: 'Draw 2 cards.',
    type: 'Spell Card',
    race: 'Normal',
    banlist: 'Forbidden',
  })
  ygoCard(dbs, {
    id: '5318639',
    name: 'Mystical Space Typhoon',
    text: 'Target 1 Spell/Trap on the field; destroy that target.',
    type: 'Spell Card',
    race: 'Quick-Play',
  })
  ygoCard(dbs, {
    id: '44095762',
    name: 'Mirror Force',
    text: 'When an opponent’s monster declares an attack: Destroy all your opponent’s Attack Position monsters.',
    type: 'Trap Card',
    race: 'Normal',
    banlist: 'Limited',
  })
})

const names = async (params: Parameters<typeof searchCards>[1]) =>
  (await searchCards('ygo', params)).map((c) => c.name)

describe('texte', () => {
  it('par nom, en début de mot, avec le compte correspondant', async () => {
    const found = await names({ query: 'dark' })
    expect(found.sort()).toEqual(['Dark Magician', 'Dark Magician Girl'])
    expect(await countCards('ygo', { query: 'dark' })).toBe(2)
    expect(await names({ query: 'magi' })).toHaveLength(2) // préfixe
  })

  it('dans le texte d’effet seulement si demandé', async () => {
    expect(await names({ query: 'draw' })).toEqual([])
    expect(await names({ query: 'draw', field: 'effect' })).toEqual(['Pot of Greed'])
  })

  it('résultat : jeu, id, nom, petite image', async () => {
    const [r] = await searchCards('ygo', { query: 'pot' })
    expect(r).toEqual({
      game: 'ygo',
      id: '55144522',
      name: 'Pot of Greed',
      imageUrl: 'https://img/55144522.jpg',
    })
  })
})

describe('filtres', () => {
  it('catégorie', async () => {
    expect(await countCards('ygo', { filters: { category: 'Spell' } })).toBe(2)
    expect(await names({ filters: { category: 'Trap' } })).toEqual(['Mirror Force'])
    expect(await countCards('ygo', { filters: { category: 'Monster' } })).toBe(5)
  })

  it('sous-types de monstre en OU, insensibles à la casse (« XYZ Monster »)', async () => {
    expect(await names({ filters: { monsterTypes: ['Xyz'] } })).toEqual(['Number 39: Utopia'])
    const both = await names({ filters: { monsterTypes: ['Xyz', 'Link'] } })
    expect(both.sort()).toEqual(['Decode Talker', 'Number 39: Utopia'])
  })

  it('attribut, type, archétype, banlist : égalité exacte', async () => {
    expect(await countCards('ygo', { filters: { attribute: 'LIGHT' } })).toBe(2)
    expect(await names({ filters: { race: 'Dragon' } })).toEqual(['Blue-Eyes White Dragon'])
    expect(await countCards('ygo', { filters: { archetype: 'Dark Magician' } })).toBe(2)
    expect(await names({ filters: { banlist: 'Forbidden' } })).toEqual(['Pot of Greed'])
  })

  it('numériques avec opérateur ; opérateur inconnu ignoré', async () => {
    expect(await countCards('ygo', { filters: { atk: { op: '>=', value: 2500 } } })).toBe(3)
    expect(await names({ filters: { level: { op: '=', value: 7 } } })).toEqual(['Dark Magician'])
    expect(await names({ filters: { def: { op: '<', value: 2000 } } })).toEqual([
      'Dark Magician Girl',
    ])
    expect(await countCards('ygo', { filters: { atk: { op: '; DROP' as any, value: 1 } } })).toBe(8)
  })

  it('flèches Link : toutes celles demandées', async () => {
    expect(await countCards('ygo', { filters: { linkMarkers: ['Top', 'Bottom-Left'] } })).toBe(1)
    expect(await countCards('ygo', { filters: { linkMarkers: ['Top', 'Left'] } })).toBe(0)
  })

  it('texte et filtres se combinent', async () => {
    expect(await names({ query: 'dark', filters: { atk: { op: '>', value: 2200 } } })).toEqual([
      'Dark Magician',
    ])
  })
})

describe('pagination', () => {
  it('sans texte : ordre alphabétique, limit / offset', async () => {
    const all = await names({ limit: 100 })
    expect(all).toEqual([...all].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })))
    expect(await names({ limit: 3, offset: 0 })).toEqual(all.slice(0, 3))
    expect(await names({ limit: 3, offset: 3 })).toEqual(all.slice(3, 6))
    expect(await countCards('ygo', {})).toBe(all.length)
  })
})

it('jeu sans moteur de recherche → erreur explicite', () => {
  expect(() => searchCards('pkm', {})).toThrow(/pkm/)
})

describe('options de filtres', () => {
  it('tirées des données synchronisées', async () => {
    const o = await getYgoFilterOptions()
    expect(o.attributes).toEqual(['DARK', 'LIGHT'])
    expect(o.archetypes).toEqual(['Blue-Eyes', 'Dark Magician'])
    expect(o.monsterTypes).toEqual(expect.arrayContaining(['Normal', 'Effect', 'Xyz', 'Link']))
    expect(o.monsterTypes).not.toContain('Synchro') // absent des données
    expect(o.spellTrapTypes).toContain('Normal')
  })
})
