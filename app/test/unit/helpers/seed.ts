import type { TestDatabases } from './testDb'

// ============================================================
// Petits builders pour poser un état précis en base de test.
// Ids lisibles (déterministes) et horodatages croissants, pour
// que les ORDER BY created_at du code soient reproductibles.
// ============================================================

export function createSeeder(dbs: TestDatabases) {
  const { user, ygo } = dbs
  let seq = 0
  const nextId = (prefix: string) => `${prefix}-${++seq}`
  const ts = () => new Date(Date.UTC(2026, 0, 1, 0, 0, seq++)).toISOString()

  function run(db: 'user' | 'ygo', sql: string, ...params: (string | number | null)[]) {
    dbs[db].raw.prepare(sql).run(...params)
  }

  return {
    // ── référence (cards-ygo.db) ──
    /** Une carte YGO ; `alias` = passcode principal si c'est un artwork alternatif. */
    card(
      id: string,
      name: string,
      alias: string | null = null,
      details: { type?: string; tcg?: string; ocg?: string } = {}
    ) {
      if (details.type) run('ygo', `INSERT OR IGNORE INTO card_types VALUES (?)`, details.type)
      run('ygo', `INSERT INTO cards (id, name) VALUES (?, ?)`, id, name)
      run(
        'ygo',
        `INSERT INTO ygo_details (card_id, alias, type, banlist_tcg, banlist_ocg)
         VALUES (?, ?, ?, ?, ?)`,
        id,
        alias,
        details.type ?? null,
        details.tcg ?? null,
        details.ocg ?? null
      )
      return id
    },

    // ── collection ──
    owned(cardId: string, quantity: number, game = 'ygo') {
      const id = nextId('col')
      const t = ts()
      run(
        'user',
        `INSERT INTO collection (id, game, card_id, quantity, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        game,
        cardId,
        quantity,
        t,
        t
      )
      return id
    },
    softDeleteCollection(collectionId: string) {
      run('user', `UPDATE collection SET deleted_at = ? WHERE id = ?`, ts(), collectionId)
    },

    // ── decks ──
    deck(name = 'Deck', game = 'ygo', format: string | null = null) {
      const id = nextId('deck')
      const t = ts()
      run(
        'user',
        `INSERT INTO decks (id, game, format, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        game,
        format,
        name,
        t,
        t
      )
      return id
    },
    deckCard(deckId: string, cardId: string, quantity: number, board = 'main', game = 'ygo') {
      run(
        'user',
        `INSERT INTO deck_cards (id, deck_id, game, card_id, quantity, board)
         VALUES (?, ?, ?, ?, ?, ?)`,
        nextId('dc'),
        deckId,
        game,
        cardId,
        quantity,
        board
      )
    },

    // ── conteneurs ──
    container(type: 'deckbox' | 'binder' | 'bulk_box', name: string) {
      const id = nextId(type)
      const t = ts()
      run(
        'user',
        `INSERT INTO containers (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        id,
        type,
        name,
        t,
        t
      )
      return id
    },
    deckbox(name: string, maxCapacity: number | null = null) {
      const id = this.container('deckbox', name)
      run(
        'user',
        `INSERT INTO deckbox_details (container_id, max_capacity) VALUES (?, ?)`,
        id,
        maxCapacity
      )
      return id
    },
    binder(name: string, pages = 1, rows = 3, cols = 3) {
      const id = this.container('binder', name)
      run(
        'user',
        `INSERT INTO binder_details (container_id, page_count, rows_per_page, cols_per_page)
         VALUES (?, ?, ?, ?)`,
        id,
        pages,
        rows,
        cols
      )
      return id
    },
    bulkBox(name: string) {
      const id = this.container('bulk_box', name)
      run('user', `INSERT INTO bulk_box_details (container_id) VALUES (?)`, id)
      return id
    },
    softDeleteContainer(containerId: string) {
      run('user', `UPDATE containers SET deleted_at = ? WHERE id = ?`, ts(), containerId)
    },

    // ── assignations ──
    inDeckbox(deckboxId: string, collectionId: string, quantity: number) {
      run(
        'user',
        `INSERT INTO deckbox_cards (id, deckbox_id, collection_id, quantity) VALUES (?, ?, ?, ?)`,
        nextId('dbc'),
        deckboxId,
        collectionId,
        quantity
      )
    },
    inBinder(binderId: string, collectionId: string, page: number, row: number, col: number) {
      run(
        'user',
        `INSERT INTO binder_slots (id, container_id, collection_id, page, row, col)
         VALUES (?, ?, ?, ?, ?, ?)`,
        nextId('slot'),
        binderId,
        collectionId,
        page,
        row,
        col
      )
    },
    inBulk(bulkId: string, collectionId: string, quantity: number) {
      run(
        'user',
        `INSERT INTO bulk_box_contents (id, container_id, collection_id, quantity)
         VALUES (?, ?, ?, ?)`,
        nextId('bulk'),
        bulkId,
        collectionId,
        quantity
      )
    },
    linkDeck(deckboxId: string, deckId: string) {
      run(
        'user',
        `INSERT INTO deckbox_decks (deckbox_id, deck_id) VALUES (?, ?)`,
        deckboxId,
        deckId
      )
    },
  }
}

// ── lectures d'état, pour les assertions après apply ──

/** Quantité par card_id présente dans un conteneur (tous types confondus). */
export function contentsOf(dbs: TestDatabases, containerId: string): Record<string, number> {
  const rows = dbs.user.raw
    .prepare(
      `SELECT c.card_id, SUM(a.qty) AS qty FROM (
         SELECT collection_id, deckbox_id AS cid, quantity AS qty FROM deckbox_cards
         UNION ALL SELECT collection_id, container_id, 1 FROM binder_slots
         UNION ALL SELECT collection_id, container_id, quantity FROM bulk_box_contents
       ) a JOIN collection c ON c.id = a.collection_id
       WHERE a.cid = ?
       GROUP BY c.card_id`
    )
    .all(containerId) as { card_id: string; qty: number }[]
  return Object.fromEntries(rows.map((r) => [r.card_id, Number(r.qty)]))
}

export function deckboxesOfDeck(dbs: TestDatabases, deckId: string): string[] {
  const rows = dbs.user.raw
    .prepare(`SELECT deckbox_id FROM deckbox_decks WHERE deck_id = ?`)
    .all(deckId) as { deckbox_id: string }[]
  return rows.map((r) => r.deckbox_id)
}

export function capacityOf(dbs: TestDatabases, deckboxId: string): number | null {
  const row = dbs.user.raw
    .prepare(`SELECT max_capacity FROM deckbox_details WHERE container_id = ?`)
    .get(deckboxId) as { max_capacity: number | null }
  return row.max_capacity
}
