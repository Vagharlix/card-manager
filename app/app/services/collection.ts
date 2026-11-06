import { useDatabase } from '~/composables/useDatabase'
import { getDefaultCondition, getDefaultLanguage } from '~/services/settings'
import { ASSIGNED_SUBQUERY } from '~/services/containers'

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
  tradeQty: number // copies proposées à l'échange (0..quantity)
  rarity: string | null // « Ultra Rare »… ; null = non précisée
  firstEdition: boolean
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
  tradeQty?: number
  rarity?: string | null
  firstEdition?: boolean
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

  const quantity = input.quantity ?? 1
  await user.execute(
    `INSERT INTO collection
       (id, game, card_id, printing_id, quantity, condition, language,
        foil, altered, signed, notes, trade_qty, rarity, first_edition,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.game,
      input.cardId,
      input.printingId ?? null,
      quantity,
      condition,
      language,
      input.foil ? 1 : 0,
      input.altered ? 1 : 0,
      input.signed ? 1 : 0,
      input.notes ?? null,
      Math.max(0, Math.min(input.tradeQty ?? 0, quantity)),
      input.rarity ?? null,
      input.firstEdition ? 1 : 0,
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
    trade_qty: patch.tradeQty === undefined ? undefined : Math.max(0, patch.tradeQty),
    rarity: patch.rarity,
    first_edition: patch.firstEdition === undefined ? undefined : patch.firstEdition ? 1 : 0,
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
  // on ne peut pas proposer à l'échange plus que ce qu'on possède
  await user.execute(`UPDATE collection SET trade_qty = MIN(trade_qty, quantity) WHERE id = ?`, [
    id,
  ])
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
            foil, altered, signed, notes, trade_qty, rarity, first_edition
     FROM collection
     WHERE deleted_at IS NULL AND game = ? AND card_id = ?
     ORDER BY created_at DESC`,
    [game, cardId]
  )
  return rows.map(rowToEntry)
}

// ── total copies owned for a game (sidebar « toute ma collection ») ──
export async function collectionTotal(game: string): Promise<number> {
  const { user } = await useDatabase()
  const rows = await user.select<{ n: number }[]>(
    `SELECT COALESCE(SUM(quantity), 0) AS n FROM collection WHERE deleted_at IS NULL AND game = ?`,
    [game]
  )
  return rows[0]?.n ?? 0
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
    tradeQty: r.trade_qty ?? 0,
    rarity: r.rarity ?? null,
    firstEdition: !!r.first_edition,
  }
}

// ============================================================
// TOUTE LA COLLECTION — une ligne par carte logique (artworks
// regroupés via alias), avec quantités possédée / à l'échange /
// non rangée. Recherche par nom, filtre « à l'échange », tri.
// ============================================================

export interface CollectionCard {
  game: string
  rootId: string // alias root = carte logique
  displayId: string // passcode le plus possédé, pour la vignette
  name: string
  type: string | null
  totalQty: number
  tradeQty: number
  unrangedQty: number
  addedAt: string // ajout le plus récent (ISO)
}

export type CollectionSort = 'name' | 'quantity' | 'recent'

export interface CollectionQuery {
  search?: string
  onlyTrade?: boolean
  sort?: CollectionSort
}

export async function listCollectionCards(
  game = 'ygo',
  q: CollectionQuery = {}
): Promise<CollectionCard[]> {
  const { user, ygo } = await useDatabase()

  const entries = await user.select<
    { card_id: string; quantity: number; trade_qty: number; assigned: number; created_at: string }[]
  >(
    `SELECT c.card_id, c.quantity, c.trade_qty, COALESCE(a.qty, 0) AS assigned, c.created_at
     FROM collection c
     LEFT JOIN (${ASSIGNED_SUBQUERY}) a ON a.collection_id = c.id
     WHERE c.deleted_at IS NULL AND c.game = ?`,
    [game]
  )
  if (!entries.length) return []

  const ids = [...new Set(entries.map((e) => e.card_id))]
  const ph = ids.map(() => '?').join(', ')
  const meta = await ygo.select<{ id: string; root: string; name: string; type: string | null }[]>(
    `SELECT c.id, COALESCE(d.alias, c.id) AS root, c.name, d.type
     FROM cards c JOIN ygo_details d ON d.card_id = c.id
     WHERE c.id IN (${ph})`,
    ids
  )
  const metaById = new Map(meta.map((m) => [m.id, m]))

  // regroupement par carte logique ; qtyByPasscode sert à choisir la vignette
  const groups = new Map<string, CollectionCard & { qtyByPasscode: Map<string, number> }>()
  for (const e of entries) {
    const m = metaById.get(e.card_id)
    const root = m?.root ?? e.card_id
    let g = groups.get(root)
    if (!g) {
      g = {
        game,
        rootId: root,
        displayId: e.card_id,
        name: m?.name ?? e.card_id,
        type: m?.type ?? null,
        totalQty: 0,
        tradeQty: 0,
        unrangedQty: 0,
        addedAt: e.created_at,
        qtyByPasscode: new Map(),
      }
      groups.set(root, g)
    }
    g.totalQty += e.quantity
    g.tradeQty += e.trade_qty
    g.unrangedQty += Math.max(0, e.quantity - e.assigned)
    if (e.created_at > g.addedAt) g.addedAt = e.created_at
    g.qtyByPasscode.set(e.card_id, (g.qtyByPasscode.get(e.card_id) ?? 0) + e.quantity)
  }

  const search = q.search?.trim().toLowerCase()
  const cards: CollectionCard[] = []
  for (const { qtyByPasscode, ...card } of groups.values()) {
    if (search && !card.name.toLowerCase().includes(search)) continue
    if (q.onlyTrade && card.tradeQty === 0) continue
    let best = 0
    for (const [passcode, qty] of qtyByPasscode) {
      if (qty > best) {
        best = qty
        card.displayId = passcode
      }
    }
    cards.push(card)
  }

  const byName = (a: CollectionCard, b: CollectionCard) => a.name.localeCompare(b.name)
  if (q.sort === 'quantity') cards.sort((a, b) => b.totalQty - a.totalQty || byName(a, b))
  else if (q.sort === 'recent')
    cards.sort((a, b) => b.addedAt.localeCompare(a.addedAt) || byName(a, b))
  else cards.sort(byName)
  return cards
}
