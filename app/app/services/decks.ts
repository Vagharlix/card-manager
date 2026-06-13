import { useDatabase } from '~/composables/useDatabase'
import type { DeckEngine, Board } from './deck/types'
import { ygoDeckEngine } from './deck/ygo'

// ============================================================
// DECKS SERVICE
// CRUD over decks + deck_cards. Deck rules (boards, placement,
// limits) are delegated to a per-game DeckEngine — the service
// stays game-agnostic.
//
// Decks are theoretical: deck_cards reference native card_ids,
// not collection entries, so a deck can include cards the user
// doesn't own.
// ============================================================

// ── engine router ──
const ENGINES: Record<string, DeckEngine> = {
  ygo: ygoDeckEngine,
}

export function deckEngine(game: string): DeckEngine {
  const engine = ENGINES[game]
  if (!engine) throw new Error(`No deck engine for game "${game}"`)
  return engine
}

// ── types ──
export interface Deck {
  id: string
  game: string
  format: string | null
  name: string
  description: string | null
}

export interface DeckListItem extends Deck {
  coverCardId: string | null // first main-deck card (default cover)
  mainCount: number
  extraCount: number
  sideCount: number
}

function uuid(): string {
  return crypto.randomUUID()
}

function now(): string {
  return new Date().toISOString()
}

// ============================================================
// CREATE / UPDATE / DELETE
// ============================================================

export async function createDeck(
  game: string,
  name: string,
  format: string | null = null,
  description: string | null = null
): Promise<string> {
  if (!name.trim()) throw new Error('EMPTY_NAME')
  const { user } = await useDatabase()
  const id = uuid()
  const ts = now()
  await user.execute(
    `INSERT INTO decks (id, game, format, name, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, game, format, name.trim(), description, ts, ts]
  )
  return id
}

export async function renameDeck(id: string, name: string): Promise<void> {
  if (!name.trim()) throw new Error('EMPTY_NAME')
  const { user } = await useDatabase()
  await user.execute(`UPDATE decks SET name = ?, updated_at = ? WHERE id = ?`, [
    name.trim(),
    now(),
    id,
  ])
}

export async function updateDeckMeta(
  id: string,
  fields: { name?: string; format?: string | null; description?: string | null }
): Promise<void> {
  const sets: string[] = []
  const params: unknown[] = []
  if (fields.name !== undefined) {
    if (!fields.name.trim()) throw new Error('EMPTY_NAME')
    sets.push('name = ?')
    params.push(fields.name.trim())
  }
  if (fields.format !== undefined) {
    sets.push('format = ?')
    params.push(fields.format)
  }
  if (fields.description !== undefined) {
    sets.push('description = ?')
    params.push(fields.description)
  }
  if (!sets.length) return
  sets.push('updated_at = ?')
  params.push(now())
  params.push(id)
  const { user } = await useDatabase()
  await user.execute(`UPDATE decks SET ${sets.join(', ')} WHERE id = ?`, params)
}

export async function deleteDeck(id: string): Promise<void> {
  const { user } = await useDatabase()
  await user.execute(`UPDATE decks SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
    now(),
    now(),
    id,
  ])
}

// ============================================================
// READ — deck list with counts + default cover
// ============================================================

export async function listDecks(game = 'ygo'): Promise<DeckListItem[]> {
  const { user } = await useDatabase()

  const decks = await user.select<any[]>(
    `SELECT id, game, format, name, description
     FROM decks
     WHERE deleted_at IS NULL AND game = ?
     ORDER BY updated_at DESC`,
    [game]
  )
  if (!decks.length) return []

  // counts per board for all decks at once
  const counts = await user.select<{ deck_id: string; board: Board; n: number }[]>(
    `SELECT deck_id, board, SUM(quantity) AS n
     FROM deck_cards
     WHERE deck_id IN (${decks.map(() => '?').join(', ')})
     GROUP BY deck_id, board`,
    decks.map((d) => d.id)
  )
  const countMap = new Map<string, { main: number; extra: number; side: number }>()
  for (const c of counts) {
    const e = countMap.get(c.deck_id) ?? { main: 0, extra: 0, side: 0 }
    if (c.board === 'main') e.main += c.n
    else if (c.board === 'extra') e.extra += c.n
    else if (c.board === 'side') e.side += c.n
    countMap.set(c.deck_id, e)
  }

  // default cover = first main-deck card added, per deck
  const covers = await user.select<{ deck_id: string; card_id: string }[]>(
    `SELECT deck_id, card_id FROM deck_cards
     WHERE deck_id IN (${decks.map(() => '?').join(', ')}) AND board = 'main'
     GROUP BY deck_id
     HAVING MIN(rowid)`,
    decks.map((d) => d.id)
  )
  const coverMap = new Map(covers.map((c) => [c.deck_id, c.card_id]))

  return decks.map((d) => {
    const c = countMap.get(d.id) ?? { main: 0, extra: 0, side: 0 }
    return {
      id: d.id,
      game: d.game,
      format: d.format,
      name: d.name,
      description: d.description,
      coverCardId: coverMap.get(d.id) ?? null,
      mainCount: c.main,
      extraCount: c.extra,
      sideCount: c.side,
    }
  })
}

export async function getDeck(id: string): Promise<Deck | null> {
  const { user } = await useDatabase()
  const rows = await user.select<any[]>(
    `SELECT id, game, format, name, description FROM decks WHERE id = ? AND deleted_at IS NULL`,
    [id]
  )
  if (!rows.length) return null
  const d = rows[0]
  return { id: d.id, game: d.game, format: d.format, name: d.name, description: d.description }
}

// ============================================================
// DECK CARDS — add / remove / move, grouped by board
// ============================================================

export interface DeckCard {
  cardId: string
  name: string
  type: string | null
  quantity: number
  owned: number // how many copies the user owns (0 = not owned)
}

export interface DeckContents {
  main: DeckCard[]
  extra: DeckCard[]
  side: DeckCard[]
}

// full contents of a deck, grouped by board, enriched with name/type
// (from cards-ygo.db) and owned quantity (from collection in user.db).
export async function getDeckContents(deckId: string, game = 'ygo'): Promise<DeckContents> {
  const { user, ygo } = await useDatabase()

  const rows = await user.select<{ card_id: string; quantity: number; board: Board }[]>(
    `SELECT card_id, quantity, board FROM deck_cards WHERE deck_id = ?`,
    [deckId]
  )

  const empty: DeckContents = { main: [], extra: [], side: [] }
  if (!rows.length) return empty

  // names + types
  const ids = [...new Set(rows.map((r) => r.card_id))]
  const ph = ids.map(() => '?').join(', ')
  const meta = await ygo.select<{ id: string; name: string; type: string | null }[]>(
    `SELECT c.id, c.name, d.type
     FROM cards c JOIN ygo_details d ON d.card_id = c.id
     WHERE c.id IN (${ph})`,
    ids
  )
  const metaById = new Map(meta.map((m) => [m.id, m]))

  // owned quantity per card (sum across collection entries)
  const owned = await user.select<{ card_id: string; n: number }[]>(
    `SELECT card_id, SUM(quantity) AS n FROM collection
     WHERE deleted_at IS NULL AND game = ? AND card_id IN (${ph})
     GROUP BY card_id`,
    [game, ...ids]
  )
  const ownedById = new Map(owned.map((o) => [o.card_id, o.n]))

  const result: DeckContents = { main: [], extra: [], side: [] }
  for (const r of rows) {
    const m = metaById.get(r.card_id)
    const card: DeckCard = {
      cardId: r.card_id,
      name: m?.name ?? r.card_id,
      type: m?.type ?? null,
      quantity: r.quantity,
      owned: ownedById.get(r.card_id) ?? 0,
    }
    if (r.board === 'main') result.main.push(card)
    else if (r.board === 'extra') result.extra.push(card)
    else if (r.board === 'side') result.side.push(card)
  }

  // stable display order: by name
  result.main.sort((a, b) => a.name.localeCompare(b.name))
  result.extra.sort((a, b) => a.name.localeCompare(b.name))
  result.side.sort((a, b) => a.name.localeCompare(b.name))

  return result
}

// add one copy of a card to a deck. The board is decided by the
// engine (auto-placement) unless `board` is given explicitly (e.g.
// moving to side). Respects the per-card copy limit across boards.
// Returns false if the copy limit is reached.
export async function addCardToDeck(
  deckId: string,
  game: string,
  cardId: string,
  cardType: string | null,
  board?: Board
): Promise<boolean> {
  const { user, ygo } = await useDatabase()
  const engine = deckEngine(game)

  const targetBoard = board ?? engine.boardForCard({ cardId, type: cardType })

  // Resolve every passcode that is the SAME logical card (shared alias
  // root), so the copy limit counts all artworks together — not per
  // passcode. Otherwise 3× art-A + 3× art-B would bypass the limit.
  const variantIds = await logicalVariants(cardId)

  // current total copies of this logical card across all boards
  const ph = variantIds.map(() => '?').join(', ')
  const totals = await user.select<{ n: number }[]>(
    `SELECT COALESCE(SUM(quantity), 0) AS n
     FROM deck_cards
     WHERE deck_id = ? AND card_id IN (${ph})`,
    [deckId, ...variantIds]
  )
  const current = totals[0]?.n ?? 0
  const max = engine.maxCopiesForCard?.({ cardId, type: cardType }) ?? engine.rules.defaultMaxCopies
  if (current >= max) return false

  // existing row for THIS exact artwork on this board?
  const existing = await user.select<{ id: string; quantity: number }[]>(
    `SELECT id, quantity FROM deck_cards WHERE deck_id = ? AND card_id = ? AND board = ?`,
    [deckId, cardId, targetBoard]
  )

  if (existing.length) {
    await user.execute(`UPDATE deck_cards SET quantity = quantity + 1 WHERE id = ?`, [
      existing[0].id,
    ])
  } else {
    await user.execute(
      `INSERT INTO deck_cards (id, deck_id, game, card_id, quantity, board) VALUES (?, ?, ?, ?, 1, ?)`,
      [uuid(), deckId, game, cardId, targetBoard]
    )
  }
  await touchDeck(deckId)
  return true
}

// all passcodes that are the same logical card as `cardId`
// (i.e. share the same alias root). Crosses into cards-ygo.db.
async function logicalVariants(cardId: string): Promise<string[]> {
  const { ygo } = await useDatabase()
  // alias root of the given card
  const rootRows = await ygo.select<{ root: string }[]>(
    `SELECT COALESCE(alias, card_id) AS root FROM ygo_details WHERE card_id = ?`,
    [cardId]
  )
  const root = rootRows[0]?.root ?? cardId
  // every card whose root is the same (id == root OR alias == root)
  const variants = await ygo.select<{ id: string }[]>(
    `SELECT c.id
     FROM cards c JOIN ygo_details d ON d.card_id = c.id
     WHERE c.id = ? OR d.alias = ?`,
    [root, root]
  )
  const ids = variants.map((v) => v.id)
  return ids.length ? ids : [cardId]
}

// remove one copy of a card from a specific board (deletes row at 0)
export async function removeCardFromDeck(
  deckId: string,
  cardId: string,
  board: Board
): Promise<void> {
  const { user } = await useDatabase()
  const existing = await user.select<{ id: string; quantity: number }[]>(
    `SELECT id, quantity FROM deck_cards WHERE deck_id = ? AND card_id = ? AND board = ?`,
    [deckId, cardId, board]
  )
  if (!existing.length) return
  if (existing[0].quantity <= 1) {
    await user.execute(`DELETE FROM deck_cards WHERE id = ?`, [existing[0].id])
  } else {
    await user.execute(`UPDATE deck_cards SET quantity = quantity - 1 WHERE id = ?`, [
      existing[0].id,
    ])
  }
  await touchDeck(deckId)
}

// move one copy of a card between boards (e.g. main → side)
export async function moveCardBoard(
  deckId: string,
  game: string,
  cardId: string,
  cardType: string | null,
  from: Board,
  to: Board
): Promise<void> {
  await removeCardFromDeck(deckId, cardId, from)
  await addCardToDeck(deckId, game, cardId, cardType, to)
}

async function touchDeck(deckId: string): Promise<void> {
  const { user } = await useDatabase()
  await user.execute(`UPDATE decks SET updated_at = ? WHERE id = ?`, [now(), deckId])
}
