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
  deckboxName: string | null // deckbox the deck is ranged in (badge)
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

  // deckbox each deck is ranged in (for the badge)
  const boxes = await user.select<{ deck_id: string; name: string }[]>(
    `SELECT dd.deck_id, c.name
     FROM deckbox_decks dd
     JOIN containers c ON c.id = dd.deckbox_id AND c.deleted_at IS NULL
     WHERE dd.deck_id IN (${decks.map(() => '?').join(', ')})`,
    decks.map((d) => d.id)
  )
  const boxMap = new Map(boxes.map((b) => [b.deck_id, b.name]))

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
      deckboxName: boxMap.get(d.id) ?? null,
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

// result of an add attempt — lets the UI show a precise message
export interface AddResult {
  ok: boolean
  reason?: 'forbidden' | 'limited' | 'semi' | 'max' // why it was rejected
  limit?: number // allowed copies
}

// add one copy of a card to a deck. The board is decided by the
// engine (auto-placement) unless `board` is given explicitly (e.g.
// moving to side). Respects the per-card copy limit across boards.
export async function addCardToDeck(
  deckId: string,
  game: string,
  cardId: string,
  cardType: string | null,
  board?: Board
): Promise<AddResult> {
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

  // deck format + card banlist → format-aware copy limit
  const format = await deckFormat(deckId, engine.rules.defaultFormat)
  const banlist = await cardBanlist(cardId)
  const max = engine.maxCopiesForCard({ cardId, type: cardType, banlist }, format)

  if (current >= max) {
    // precise reason based on the limit / banlist status
    const status = format === 'casual' ? null : banlist[format]
    let reason: AddResult['reason'] = 'max'
    if (status === 'Forbidden') reason = 'forbidden'
    else if (status === 'Limited') reason = 'limited'
    else if (status === 'Semi-Limited') reason = 'semi'
    return { ok: false, reason, limit: max }
  }

  // existing row for THIS exact artwork on this board?
  const existing = await user.select<{ id: string; quantity: number }[]>(
    `SELECT id, quantity FROM deck_cards WHERE deck_id = ? AND card_id = ? AND board = ?`,
    [deckId, cardId, targetBoard]
  )

  if (existing[0]) {
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
  return { ok: true }
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

// current format of a deck (falls back to engine default)
async function deckFormat(deckId: string, fallback: string): Promise<string> {
  const { user } = await useDatabase()
  const rows = await user.select<{ format: string | null }[]>(
    `SELECT format FROM decks WHERE id = ?`,
    [deckId]
  )
  return rows[0]?.format ?? fallback
}

// banlist status of a card per format, from cards-ygo.db.
// Uses the alias root so all artworks share the same banlist.
async function cardBanlist(cardId: string): Promise<Record<string, string | null>> {
  const { ygo } = await useDatabase()
  const rows = await ygo.select<{ banlist_tcg: string | null; banlist_ocg: string | null }[]>(
    `SELECT banlist_tcg, banlist_ocg
     FROM ygo_details
     WHERE card_id = COALESCE((SELECT alias FROM ygo_details WHERE card_id = ?), ?)`,
    [cardId, cardId]
  )
  const r = rows[0]
  return { tcg: r?.banlist_tcg ?? null, ocg: r?.banlist_ocg ?? null }
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
  const row = existing[0]
  if (!row) return
  if (row.quantity <= 1) {
    await user.execute(`DELETE FROM deck_cards WHERE id = ?`, [row.id])
  } else {
    await user.execute(`UPDATE deck_cards SET quantity = quantity - 1 WHERE id = ?`, [row.id])
  }
  await touchDeck(deckId)
}

// move one copy of a card between boards (e.g. main → side).
// A move never changes the logical total, so it must NOT be blocked
// by the copy limit — we write the board change directly instead of
// going through addCardToDeck (which enforces the limit).
export async function moveCardBoard(
  deckId: string,
  game: string,
  cardId: string,
  cardType: string | null,
  from: Board,
  to: Board
): Promise<void> {
  const { user } = await useDatabase()

  // remove one copy from the source board
  await removeCardFromDeck(deckId, cardId, from)

  // add one copy to the target board directly (no limit check)
  const existing = await user.select<{ id: string; quantity: number }[]>(
    `SELECT id, quantity FROM deck_cards WHERE deck_id = ? AND card_id = ? AND board = ?`,
    [deckId, cardId, to]
  )
  if (existing[0]) {
    await user.execute(`UPDATE deck_cards SET quantity = quantity + 1 WHERE id = ?`, [
      existing[0].id,
    ])
  } else {
    await user.execute(
      `INSERT INTO deck_cards (id, deck_id, game, card_id, quantity, board) VALUES (?, ?, ?, ?, 1, ?)`,
      [uuid(), deckId, game, cardId, to]
    )
  }
  await touchDeck(deckId)
}

async function touchDeck(deckId: string): Promise<void> {
  const { user } = await useDatabase()
  await user.execute(`UPDATE decks SET updated_at = ? WHERE id = ?`, [now(), deckId])
}

// ============================================================
// VALIDATION — checks the deck against the current format.
// Copy limits apply to the LOGICAL card across all boards
// (main + extra + side combined), per official YGO rules.
// Reports violations without modifying the deck.
// ============================================================

export interface CardViolation {
  rootId: string // alias root (logical card)
  name: string
  quantity: number // total copies across all boards
  limit: number // allowed in this format
  status: string // 'Forbidden' | 'Limited' | 'Semi-Limited' | 'Over'
}

export interface DeckValidation {
  valid: boolean
  violations: CardViolation[]
  // passcodes (any artwork) that are in violation, for quick UI lookup
  flagged: Set<string>
}

export async function validateDeck(deckId: string, game = 'ygo'): Promise<DeckValidation> {
  const { user, ygo } = await useDatabase()
  const engine = deckEngine(game)
  const format = await deckFormat(deckId, engine.rules.defaultFormat)

  // all deck rows
  const rows = await user.select<{ card_id: string; quantity: number }[]>(
    `SELECT card_id, quantity FROM deck_cards WHERE deck_id = ?`,
    [deckId]
  )
  if (!rows.length) return { valid: true, violations: [], flagged: new Set() }

  // resolve each passcode to its alias root + name + banlist
  const ids = [...new Set(rows.map((r) => r.card_id))]
  const ph = ids.map(() => '?').join(', ')
  const meta = await ygo.select<
    {
      id: string
      root: string
      name: string
      banlist_tcg: string | null
      banlist_ocg: string | null
    }[]
  >(
    `SELECT c.id,
            COALESCE(d.alias, c.id) AS root,
            c.name,
            rd.banlist_tcg, rd.banlist_ocg
     FROM cards c
     JOIN ygo_details d  ON d.card_id = c.id
     JOIN ygo_details rd ON rd.card_id = COALESCE(d.alias, c.id)
     WHERE c.id IN (${ph})`,
    ids
  )
  const metaById = new Map(meta.map((m) => [m.id, m]))

  // sum quantities per logical root
  interface Agg {
    root: string
    name: string
    qty: number
    banlist: Record<string, string | null>
    passcodes: string[]
  }
  const byRoot = new Map<string, Agg>()
  for (const r of rows) {
    const m = metaById.get(r.card_id)
    if (!m) continue
    const agg = byRoot.get(m.root) ?? {
      root: m.root,
      name: m.name,
      qty: 0,
      banlist: { tcg: m.banlist_tcg, ocg: m.banlist_ocg },
      passcodes: [],
    }
    agg.qty += r.quantity
    agg.passcodes.push(r.card_id)
    byRoot.set(m.root, agg)
  }

  const violations: CardViolation[] = []
  const flagged = new Set<string>()

  for (const agg of byRoot.values()) {
    const limit = engine.maxCopiesForCard({ cardId: agg.root, banlist: agg.banlist }, format)
    if (agg.qty > limit) {
      const status =
        limit === 0 ? 'Forbidden' : limit === 1 ? 'Limited' : limit === 2 ? 'Semi-Limited' : 'Over'
      violations.push({ rootId: agg.root, name: agg.name, quantity: agg.qty, limit, status })
      for (const p of agg.passcodes) flagged.add(p)
    }
  }

  return { valid: violations.length === 0, violations, flagged }
}
