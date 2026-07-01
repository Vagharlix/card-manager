import { useDatabase } from '~/composables/useDatabase'
import { getDefaultCondition, getDefaultLanguage } from '~/services/settings'

// ============================================================
// COLLECTION SERVICE
// CRUD over the `collection` table in user.db.
// A row = a quantity of one card in a given condition/language/
// finish, optionally tied to a specific printing.
// ============================================================

export type CardCondition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG'

export interface CollectionEntry {
  id: string
  game: string
  cardId: string
  printingId: string | null
  quantity: number
  condition: CardCondition
  language: string
  foil: boolean
  altered: boolean
  signed: boolean
  notes: string | null
}

// what you pass to add a card; missing fields fall back to settings/defaults
export interface AddCardInput {
  game: string
  cardId: string
  printingId?: string | null
  quantity?: number
  condition?: CardCondition
  language?: string
  foil?: boolean
  altered?: boolean
  signed?: boolean
  notes?: string | null
}

function uuid(): string {
  return crypto.randomUUID()
}

// ── add a card ────────────────────────────────────────────
// Unspecified condition/language come from settings (quick add).
export async function addCard(input: AddCardInput): Promise<string> {
  const { user } = await useDatabase()
  const condition = input.condition ?? ((await getDefaultCondition(input.game)) as CardCondition)
  const language = input.language ?? (await getDefaultLanguage(input.game))
  const id = uuid()
  const now = new Date().toISOString()

  await user.execute(
    `INSERT INTO collection
       (id, game, card_id, printing_id, quantity, condition, language,
        foil, altered, signed, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.game,
      input.cardId,
      input.printingId ?? null,
      input.quantity ?? 1,
      condition,
      language,
      input.foil ? 1 : 0,
      input.altered ? 1 : 0,
      input.signed ? 1 : 0,
      input.notes ?? null,
      now,
      now,
    ]
  )
  return id
}

// ── update an entry ───────────────────────────────────────
export async function updateCard(id: string, patch: Partial<AddCardInput>): Promise<void> {
  const { user } = await useDatabase()

  const fields: string[] = []
  const params: unknown[] = []

  const map: Record<string, unknown> = {
    quantity: patch.quantity,
    condition: patch.condition,
    language: patch.language,
    printing_id: patch.printingId,
    foil: patch.foil === undefined ? undefined : patch.foil ? 1 : 0,
    altered: patch.altered === undefined ? undefined : patch.altered ? 1 : 0,
    signed: patch.signed === undefined ? undefined : patch.signed ? 1 : 0,
    notes: patch.notes,
  }
  for (const [col, val] of Object.entries(map)) {
    if (val !== undefined) {
      fields.push(`${col} = ?`)
      params.push(val)
    }
  }
  if (!fields.length) return

  fields.push(`updated_at = ?`)
  params.push(new Date().toISOString())
  params.push(id)

  await user.execute(`UPDATE collection SET ${fields.join(', ')} WHERE id = ?`, params)
}

// ── soft delete ───────────────────────────────────────────
export async function removeCard(id: string): Promise<void> {
  const { user } = await useDatabase()
  await user.execute(`UPDATE collection SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
    new Date().toISOString(),
    new Date().toISOString(),
    id,
  ])
}

// ── list owned cards (optionally for one game) ────────────
export async function listCollection(game?: string): Promise<CollectionEntry[]> {
  const { user } = await useDatabase()
  const where = game ? `AND game = ?` : ''
  const params = game ? [game] : []

  const rows = await user.select<any[]>(
    `SELECT id, game, card_id, printing_id, quantity, condition, language,
            foil, altered, signed, notes
     FROM collection
     WHERE deleted_at IS NULL ${where}
     ORDER BY created_at DESC`,
    params
  )

  return rows.map(rowToEntry)
}

// ── total quantity owned of a given card (across all entries) ──
export async function ownedQuantity(game: string, cardId: string): Promise<number> {
  const { user } = await useDatabase()
  const rows = await user.select<{ total: number }[]>(
    `SELECT COALESCE(SUM(quantity), 0) AS total
     FROM collection
     WHERE deleted_at IS NULL AND game = ? AND card_id = ?`,
    [game, cardId]
  )
  return rows[0]?.total ?? 0
}

// ── all entries for a given card (for the detail panel) ───
export async function entriesForCard(game: string, cardId: string): Promise<CollectionEntry[]> {
  const { user } = await useDatabase()
  const rows = await user.select<any[]>(
    `SELECT id, game, card_id, printing_id, quantity, condition, language,
            foil, altered, signed, notes
     FROM collection
     WHERE deleted_at IS NULL AND game = ? AND card_id = ?
     ORDER BY created_at DESC`,
    [game, cardId]
  )
  return rows.map(rowToEntry)
}

// ── all owned passcodes for a game (for grid "owned" pills) ──
// Returns a Set for O(1) lookup when rendering search results.
export async function ownedCardIds(game = 'ygo'): Promise<Set<string>> {
  const { user } = await useDatabase()
  const rows = await user.select<{ card_id: string }[]>(
    `SELECT DISTINCT card_id FROM collection
     WHERE deleted_at IS NULL AND game = ?`,
    [game]
  )
  return new Set(rows.map((r) => r.card_id))
}

function rowToEntry(r: any): CollectionEntry {
  return {
    id: r.id,
    game: r.game,
    cardId: r.card_id,
    printingId: r.printing_id,
    quantity: r.quantity,
    condition: r.condition,
    language: r.language,
    foil: !!r.foil,
    altered: !!r.altered,
    signed: !!r.signed,
    notes: r.notes,
  }
}

// ============================================================
// GROUPED VIEW
// Collapses all owned entries into one row per logical card
// (all artworks/versions grouped via alias), with total quantity
// and a default display artwork (the most-owned passcode).
// ============================================================

export interface CollectionCard {
  game: string
  rootId: string // alias root = the logical card
  displayId: string // passcode used for the thumbnail
  name: string
  totalQty: number
  artworkIds: string[] // all owned passcodes for this card
}

export async function listCollectionGrouped(game = 'ygo'): Promise<CollectionCard[]> {
  const { user, ygo } = await useDatabase()

  // 1. owned entries with their quantities, grouped by passcode
  const owned = await user.select<{ card_id: string; qty: number }[]>(
    `SELECT card_id, SUM(quantity) AS qty
     FROM collection
     WHERE deleted_at IS NULL AND game = ?
     GROUP BY card_id`,
    [game]
  )
  if (!owned.length) return []

  // 2. resolve alias root + name for each owned passcode
  const ids = owned.map((o) => o.card_id)
  const placeholders = ids.map(() => '?').join(', ')
  const meta = await ygo.select<{ id: string; name: string; alias: string | null }[]>(
    `SELECT c.id, c.name, d.alias
     FROM cards c JOIN ygo_details d ON d.card_id = c.id
     WHERE c.id IN (${placeholders})`,
    ids
  )
  const metaById = new Map(meta.map((m) => [m.id, m]))

  // 3. group by alias root
  const groups = new Map<string, CollectionCard>()
  for (const o of owned) {
    const m = metaById.get(o.card_id)
    const root = m?.alias ?? o.card_id
    let g = groups.get(root)
    if (!g) {
      g = {
        game,
        rootId: root,
        displayId: o.card_id,
        name: m?.name ?? o.card_id,
        totalQty: 0,
        artworkIds: [],
      }
      groups.set(root, g)
    }
    g.totalQty += o.qty
    g.artworkIds.push(o.card_id)
    // default display = the most-owned passcode so far
    const currentMax = owned.find((x) => x.card_id === g!.displayId)?.qty ?? 0
    if (o.qty > currentMax) g.displayId = o.card_id
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
}
