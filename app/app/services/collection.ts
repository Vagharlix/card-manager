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

// copies of an entry currently placed in a (non-deleted) container
async function assignedQuantity(id: string): Promise<number> {
  const { user } = await useDatabase()
  const rows = await user.select<{ n: number }[]>(
    `SELECT COALESCE(SUM(qty), 0) AS n FROM (
        SELECT dc.quantity AS qty FROM deckbox_cards dc
          JOIN containers ct ON ct.id = dc.deckbox_id AND ct.deleted_at IS NULL
          WHERE dc.collection_id = ?
        UNION ALL
        SELECT 1 FROM binder_slots bs
          JOIN containers ct ON ct.id = bs.container_id AND ct.deleted_at IS NULL
          WHERE bs.collection_id = ?
        UNION ALL
        SELECT bb.quantity FROM bulk_box_contents bb
          JOIN containers ct ON ct.id = bb.container_id AND ct.deleted_at IS NULL
          WHERE bb.collection_id = ?
     )`,
    [id, id, id]
  )
  return rows[0]?.n ?? 0
}

// ── update an entry ───────────────────────────────────────
// Lowering the quantity below the copies placed in containers would
// leave containers holding cards the user no longer owns: refused with
// QUANTITY_BELOW_ASSIGNED (the user unassigns first, choosing which).
export async function updateCard(id: string, patch: Partial<AddCardInput>): Promise<void> {
  const { user } = await useDatabase()

  if (patch.quantity !== undefined && patch.quantity < (await assignedQuantity(id))) {
    throw new Error('QUANTITY_BELOW_ASSIGNED')
  }

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
// The copies leave the collection, so they leave their containers too:
// assignment rows are deleted (the collection row itself is only
// soft-deleted, for sync).
export async function removeCard(id: string): Promise<void> {
  const { user } = await useDatabase()
  await user.execute(`DELETE FROM deckbox_cards WHERE collection_id = ?`, [id])
  await user.execute(`DELETE FROM binder_slots WHERE collection_id = ?`, [id])
  await user.execute(`DELETE FROM bulk_box_contents WHERE collection_id = ?`, [id])
  await user.execute(`UPDATE collection SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
    new Date().toISOString(),
    new Date().toISOString(),
    id,
  ])
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
