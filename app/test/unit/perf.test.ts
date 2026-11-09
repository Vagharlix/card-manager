import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDatabases, type TestDatabases } from './helpers/testDb'

// ============================================================
// Grosse collection (5 000 cartes) : durée ET nombre de requêtes de
// chaque opération. Dans l'appli, chaque requête est un aller-retour
// WebView → Rust → SQLite : une boucle « une requête par carte » se voit
// à peine ici (SQLite en mémoire) mais rame sur téléphone. Les seuils sont
// larges : ils attrapent les régressions grossières, pas des millisecondes.
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
const { syncNow, MemoryTransport } = await import('~/services/userSync')
const { searchCards } = await import('~/services/search')

const CARDS = 5000
let dbs: TestDatabases
let deckboxId = ''
let binderId = ''
let deckId = ''

function seed() {
  const ygo = dbs.ygo.raw
  const user = dbs.user.raw
  ygo.exec('BEGIN')
  ygo.prepare(`INSERT INTO card_types VALUES ('Effect Monster')`).run()
  const card = ygo.prepare(`INSERT INTO cards (id, name, legal_text) VALUES (?, ?, ?)`)
  const det = ygo.prepare(
    `INSERT INTO ygo_details (card_id, type, atk, def, level, alias) VALUES (?, 'Effect Monster', ?, ?, ?, ?)`
  )
  const pr = ygo.prepare(
    `INSERT INTO printings (id, card_id, set_name, set_code, rarity) VALUES (?, ?, 'Set', ?, 'Common')`
  )
  for (let i = 0; i < CARDS; i++) {
    const id = String(10000000 + i)
    card.run(
      id,
      `Card ${i} ${['Dragon', 'Magician', 'Warrior', 'Fiend'][i % 4]}`,
      `Effect text ${i}`
    )
    // 1 carte sur 10 est un artwork alternatif de la précédente
    det.run(
      id,
      (i * 37) % 4000,
      (i * 53) % 4000,
      (i % 12) + 1,
      i % 10 === 9 ? String(10000000 + i - 1) : null
    )
    pr.run(`SET-EN${String(i).padStart(4, '0')}`, id, `SET-EN${String(i).padStart(4, '0')}`)
  }
  ygo.exec('COMMIT')

  user.exec('BEGIN')
  const t = '2026-01-01T00:00:00.000Z'
  const col = user.prepare(
    `INSERT INTO collection (id, game, card_id, quantity, trade_qty, created_at, updated_at)
     VALUES (?, 'ygo', ?, ?, ?, ?, ?)`
  )
  for (let i = 0; i < CARDS; i++)
    col.run(`c${i}`, String(10000000 + i), (i % 3) + 1, i % 7 === 0 ? 1 : 0, t, t)
  // rangements : 1 deckbox (300 copies), 1 classeur (1000 cases), 1 boîte (2000 copies)
  user
    .prepare(
      `INSERT INTO containers (id, type, name, created_at, updated_at) VALUES ('box', 'deckbox', 'Box', ?, ?)`
    )
    .run(t, t)
  user.prepare(`INSERT INTO deckbox_details (container_id) VALUES ('box')`).run()
  user
    .prepare(
      `INSERT INTO containers (id, type, name, created_at, updated_at) VALUES ('bind', 'binder', 'Binder', ?, ?)`
    )
    .run(t, t)
  user
    .prepare(
      `INSERT INTO binder_details (container_id, page_count, rows_per_page, cols_per_page) VALUES ('bind', 112, 3, 3)`
    )
    .run()
  user
    .prepare(
      `INSERT INTO containers (id, type, name, created_at, updated_at) VALUES ('bulk', 'bulk_box', 'Bulk', ?, ?)`
    )
    .run(t, t)
  user.prepare(`INSERT INTO bulk_box_details (container_id) VALUES ('bulk')`).run()
  const dc = user.prepare(
    `INSERT INTO deckbox_cards (id, deckbox_id, collection_id, quantity) VALUES (?, 'box', ?, 1)`
  )
  for (let i = 0; i < 300; i++) dc.run(`dc${i}`, `c${i}`)
  const bs = user.prepare(
    `INSERT INTO binder_slots (id, container_id, collection_id, page, row, col) VALUES (?, 'bind', ?, ?, ?, ?)`
  )
  for (let i = 0; i < 1000; i++)
    bs.run(`bs${i}`, `c${300 + i}`, Math.floor(i / 9), Math.floor((i % 9) / 3), i % 3)
  const bb = user.prepare(
    `INSERT INTO bulk_box_contents (id, container_id, collection_id, quantity) VALUES (?, 'bulk', ?, 1)`
  )
  for (let i = 0; i < 2000; i++) bb.run(`bb${i}`, `c${1300 + i}`)
  // un deck de 60 cartes (20 × 3)
  user
    .prepare(
      `INSERT INTO decks (id, game, name, created_at, updated_at) VALUES ('deck', 'ygo', 'Deck', ?, ?)`
    )
    .run(t, t)
  const dk = user.prepare(
    `INSERT INTO deck_cards (id, deck_id, game, card_id, quantity, board) VALUES (?, 'deck', 'ygo', ?, 3, 'main')`
  )
  for (let i = 0; i < 20; i++) dk.run(`dk${i}`, String(10000000 + 4000 + i * 3))
  user.exec('COMMIT')
  deckboxId = 'box'
  binderId = 'bind'
  deckId = 'deck'
}

interface Measure {
  ms: number
  queries: number
}

async function measure(fn: () => Promise<unknown>): Promise<Measure> {
  const q0 = dbs.user.queries + dbs.ygo.queries
  const t0 = performance.now()
  await fn()
  return {
    ms: Math.round(performance.now() - t0),
    queries: dbs.user.queries + dbs.ygo.queries - q0,
  }
}

const report: Record<string, Measure> = {}

beforeAll(() => {
  dbs = createTestDatabases()
  h.dbs = dbs
  seed()
})

describe(`grosse collection (${CARDS} cartes)`, () => {
  // [nom, opération, requêtes max]
  const cases: [string, () => Promise<unknown>, number][] = [
    ['toute la collection', () => collection.listCollectionCards('ygo', { sort: 'name' }), 10],
    [
      'collection filtrée (recherche)',
      () => collection.listCollectionCards('ygo', { search: 'dragon' }),
      10,
    ],
    ['cartes non rangées', () => containers.listUnrangedCards('ygo'), 10],
    ['liste des rangements', () => containers.listContainers(), 10],
    ['rangements avec capacité', () => containers.listContainersWithCapacity(), 20],
    ['contenu de la boîte', () => containers.listContainerCards('bulk', 'bulk_box', 'ygo'), 10],
    ['cases du classeur', () => containers.listBinderSlots(binderId, 'ygo'), 10],
    ['contenu du deck', () => decks.getDeckContents(deckId, 'ygo'), 10],
    ['validation du deck', () => decks.validateDeck(deckId, 'ygo'), 10],
    ['plan deck → deckbox', () => deckLink.planDeckToDeckbox(deckId, deckboxId, 'ygo'), 30],
    ['cartes possédées (ids)', () => collection.ownedCardIds('ygo'), 5],
    ['recherche de cartes', () => searchCards('ygo', { query: 'dragon', limit: 48 }), 5],
    ['code de partage', () => share.shareCode('ygo', { owner: 'Félix' }), 10],
    [
      'lecture d’un partage reçu',
      async () =>
        share.resolveShare(share.decodeShare(await share.shareCode('ygo', { owner: 'x' }))),
      20,
    ],
    ['export sauvegarde', () => backup.exportBackup(), 30],
    ['export CSV', () => backup.exportCollectionCsv(), 30],
  ]

  for (const [name, fn, maxQueries] of cases) {
    it(name, async () => {
      const m = await measure(fn)
      report[name] = m
      expect(m.queries).toBeLessThanOrEqual(maxQueries)
      expect(m.ms).toBeLessThan(3000)
    })
  }

  it('synchro : première publication puis synchro sans changement', async () => {
    const cloud = new MemoryTransport()
    const first = await measure(() => syncNow(cloud))
    const again = await measure(() => syncNow(cloud))
    report['synchro (1re publication)'] = first
    report['synchro (rien de neuf)'] = again
    expect(again.queries).toBeLessThanOrEqual(40)
    expect(first.ms + again.ms).toBeLessThan(6000)
  })

  it('rapport', () => {
    // visible avec `npx vitest run test/unit/perf.test.ts`
    console.table(report)
  })
})
