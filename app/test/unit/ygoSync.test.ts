import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabases, type TestDatabases } from './helpers/testDb'

// ============================================================
// Mise à jour incrémentale de la base Yu-Gi-Oh! : le fichier YGOPRODeck
// complet est comparé carte par carte (empreintes, migration ygo 004) ;
// seules les cartes nouvelles / modifiées sont écrites, les disparues
// supprimées. Vraies migrations, vrai FTS.
// ============================================================

const h = vi.hoisted(() => ({ dbs: null as unknown as TestDatabases }))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))

const { writeYgoUpdate, syncYgo, cardHash } = await import('~/services/sync')
type YgoApiCard = import('~/services/sync').YgoApiCard

function card(
  id: number,
  name: string,
  opts: Partial<YgoApiCard> & { konami?: number; sets?: [string, string][]; price?: string } = {}
): YgoApiCard {
  const { konami, sets, price, ...rest } = opts
  return {
    id,
    name,
    type: 'Normal Monster',
    desc: `${name} text`,
    race: 'Spellcaster',
    atk: 2500,
    def: 2100,
    level: 7,
    attribute: 'DARK',
    card_images: [
      {
        id,
        image_url: `https://images.ygoprodeck.com/images/cards/${id}.jpg`,
        image_url_small: `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`,
        image_url_cropped: `https://images.ygoprodeck.com/images/cards_cropped/${id}.jpg`,
      },
    ],
    card_sets: (sets ?? [[`SET-EN${id % 1000}`, 'Common']]).map(([code, rarity]) => ({
      set_name: 'Some Set',
      set_code: code,
      set_rarity: rarity,
      set_rarity_code: `(${rarity[0]})`,
      set_price: price ?? '1.00',
    })),
    misc_info: konami ? [{ konami_id: konami }] : [],
    ...rest,
  }
}

const DM = card(46986414, 'Dark Magician', {
  konami: 4041,
  sets: [
    ['LOB-EN005', 'Ultra Rare'],
    ['SDY-006', 'Common'],
  ],
})
const DM_ALT = card(36996508, 'Dark Magician', {
  konami: 4041,
  sets: [['DUPO-EN101', 'Ultra Rare']],
})
const POT = card(55144522, 'Pot of Greed', {
  type: 'Spell Card',
  banlist_info: { ban_tcg: 'Forbidden' },
  sets: [['LOB-EN119', 'Rare']],
})

let dbs: TestDatabases
beforeEach(() => {
  dbs = createTestDatabases()
  h.dbs = dbs
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const db of [dbs.user, dbs.ygo, dbs.mtg]) db.close()
})

const q = <T>(sql: string, ...p: (string | number)[]) => dbs.ygo.raw.prepare(sql).all(...p) as T[]
const count = (table: string) => q<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)[0]!.n
const fts = (term: string) =>
  q<{ id: string }>(
    `SELECT c.id FROM cards_fts f JOIN cards c ON c.rowid = f.rowid WHERE cards_fts MATCH ?`,
    term
  ).map((r) => r.id)

describe('mise à jour incrémentale YGO', () => {
  it('1re mise à jour : tout est écrit (cartes, détails, alias, impressions, raretés)', async () => {
    const stats = await writeYgoUpdate(dbs.ygo as never, [DM, DM_ALT, POT], '1.0')
    expect(stats).toEqual({ changed: 3, removed: 0, unchanged: 0 })
    expect(count('cards')).toBe(3)
    expect(count('card_hashes')).toBe(3)
    expect(q(`SELECT alias FROM ygo_details WHERE card_id = '36996508'`)).toEqual([
      { alias: '46986414' },
    ])
    expect(count('printings')).toBe(4)
    expect(q(`SELECT value FROM sync_meta WHERE key = 'db_version'`)).toEqual([{ value: '1.0' }])
    expect(fts('Pot')).toEqual(['55144522'])
  })

  it('même contenu : rien n’est réécrit', async () => {
    await writeYgoUpdate(dbs.ygo as never, [DM, DM_ALT, POT], '1.0')
    const before = dbs.ygo.queries
    const stats = await writeYgoUpdate(dbs.ygo as never, [DM, DM_ALT, POT], '1.1')
    expect(stats).toEqual({ changed: 0, removed: 0, unchanged: 3 })
    // lectures + quelques requêtes fixes (transaction, lookups, version), aucune écriture de carte
    expect(dbs.ygo.queries - before).toBeLessThan(20)
    expect(q(`SELECT value FROM sync_meta WHERE key = 'db_version'`)).toEqual([{ value: '1.1' }])
  })

  it('un changement de prix seul ne réécrit rien', () => {
    expect(cardHash(card(1, 'A', { price: '1.00' }), null)).toBe(
      cardHash(card(1, 'A', { price: '9.99' }), null)
    )
    expect(cardHash(card(1, 'A'), null)).not.toBe(cardHash(card(1, 'A', { desc: 'errata' }), null))
  })

  it('carte modifiée (errata, banlist, nouvelle impression) : elle seule est réécrite', async () => {
    await writeYgoUpdate(dbs.ygo as never, [DM, DM_ALT, POT], '1.0')
    const potV2 = { ...POT, desc: 'Draw 2 cards (errata).', banlist_info: { ban_tcg: 'Limited' } }
    const dmV2 = {
      ...DM,
      card_sets: [
        ...DM.card_sets!,
        { ...DM.card_sets![0]!, set_code: 'LOB-EN005', set_rarity: 'Secret Rare' },
      ],
    }
    const stats = await writeYgoUpdate(dbs.ygo as never, [dmV2, DM_ALT, potV2], '1.1')
    expect(stats).toEqual({ changed: 2, removed: 0, unchanged: 1 })
    expect(q(`SELECT legal_text FROM cards WHERE id = '55144522'`)).toEqual([
      { legal_text: 'Draw 2 cards (errata).' },
    ])
    expect(q(`SELECT banlist_tcg FROM ygo_details WHERE card_id = '55144522'`)).toEqual([
      { banlist_tcg: 'Limited' },
    ])
    expect(
      q<{ rarity: string }>(
        `SELECT rarity FROM printing_rarities WHERE set_code = 'LOB-EN005' ORDER BY rarity`
      ).map((r) => r.rarity)
    ).toEqual(['Secret Rare', 'Ultra Rare'])
    expect(fts('errata')).toEqual(['55144522'])
  })

  it('carte retirée de la source : supprimée partout (détails, impressions, raretés, FTS)', async () => {
    await writeYgoUpdate(dbs.ygo as never, [DM, DM_ALT, POT], '1.0')
    const stats = await writeYgoUpdate(dbs.ygo as never, [DM, DM_ALT], '1.1')
    expect(stats).toEqual({ changed: 0, removed: 1, unchanged: 2 })
    expect(q(`SELECT id FROM cards WHERE id = '55144522'`)).toEqual([])
    expect(q(`SELECT card_id FROM ygo_details WHERE card_id = '55144522'`)).toEqual([])
    expect(q(`SELECT id FROM printings WHERE card_id = '55144522'`)).toEqual([])
    expect(q(`SELECT set_code FROM printing_rarities WHERE set_code = 'LOB-EN119'`)).toEqual([])
    expect(fts('Pot')).toEqual([])
  })

  it('force : tout est réécrit', async () => {
    await writeYgoUpdate(dbs.ygo as never, [DM, DM_ALT, POT], '1.0')
    const stats = await writeYgoUpdate(dbs.ygo as never, [DM, DM_ALT, POT], '1.0', { force: true })
    expect(stats.changed).toBe(3)
  })

  it('base d’avant les empreintes : cartes réécrites, cartes absentes de la source retirées', async () => {
    await writeYgoUpdate(dbs.ygo as never, [DM, DM_ALT, POT], '1.0')
    dbs.ygo.raw.exec(`DELETE FROM card_hashes`)
    const stats = await writeYgoUpdate(dbs.ygo as never, [DM, POT], '1.1')
    expect(stats).toEqual({ changed: 2, removed: 1, unchanged: 0 })
    expect(count('cards')).toBe(2)
    expect(count('card_hashes')).toBe(2)
  })
})

describe('syncYgo', () => {
  function fakeApi(version: string, cards: YgoApiCard[]) {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url)
      const body = url.includes('checkDBVer') ? [{ database_version: version }] : { data: cards }
      return { ok: true, status: 200, json: async () => body } as Response
    })
    return urls
  }

  it('version inchangée : une seule petite requête, rien n’est téléchargé', async () => {
    let urls = fakeApi('1.0', [DM, POT])
    expect(await syncYgo()).toEqual({ changed: 2, removed: 0, unchanged: 0 })
    expect(urls.some((u) => u.includes('cardinfo'))).toBe(true)
    urls = fakeApi('1.0', [DM, POT])
    expect(await syncYgo()).toEqual({ changed: 0, removed: 0, unchanged: 0 })
    expect(urls.every((u) => u.includes('checkDBVer'))).toBe(true)
  })

  it('nouvelle version : seules les différences sont écrites', async () => {
    fakeApi('1.0', [DM, POT])
    await syncYgo()
    fakeApi('1.1', [DM, POT, DM_ALT])
    expect(await syncYgo()).toEqual({ changed: 1, removed: 0, unchanged: 2 })
  })
})
