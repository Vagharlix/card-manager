import { useDatabase } from '~/composables/useDatabase'

// ============================================================
// CONTAINERS SERVICE
// CRUD over containers (CTI: containers + *_details tables) plus
// card assignment across deckbox / binder / bulk_box.
//
// Multi-TCG: containers themselves are game-agnostic (a physical
// box can hold any game). The game lives on the cards inside,
// via collection.game.
// ============================================================

export type ContainerType = 'deckbox' | 'binder' | 'bulk_box'

export interface Container {
  id: string
  type: ContainerType
  name: string
  maxCapacity?: number | null
  pageCount?: number
  rowsPerPage?: number
  colsPerPage?: number
}

export interface ContainerListItem extends Container {
  cardCount: number
}

function uuid(): string {
  return crypto.randomUUID()
}

function now(): string {
  return new Date().toISOString()
}

// Assigned quantity per collection entry, counting ONLY active
// (non-deleted) containers. Used everywhere we compute "unranged".
// Each assignment table is joined to containers to skip soft-deleted ones.
const ASSIGNED_SUBQUERY = `
  SELECT collection_id, SUM(qty) AS qty FROM (
      SELECT dc.collection_id, dc.quantity AS qty
        FROM deckbox_cards dc
        JOIN containers ct ON ct.id = dc.deckbox_id AND ct.deleted_at IS NULL
      UNION ALL
      SELECT bs.collection_id, 1 AS qty
        FROM binder_slots bs
        JOIN containers ct ON ct.id = bs.container_id AND ct.deleted_at IS NULL
      UNION ALL
      SELECT bb.collection_id, bb.quantity AS qty
        FROM bulk_box_contents bb
        JOIN containers ct ON ct.id = bb.container_id AND ct.deleted_at IS NULL
  )
  GROUP BY collection_id
`

// ============================================================
// VALIDATION
// ============================================================

// true if an active container already uses this name (case-insensitive).
// excludeId lets rename skip the container being renamed.
async function nameExists(name: string, excludeId?: string): Promise<boolean> {
  const { user } = await useDatabase()
  const params: unknown[] = [name.trim()]
  let sql = `SELECT COUNT(*) AS n FROM containers
             WHERE deleted_at IS NULL AND LOWER(name) = LOWER(?)`
  if (excludeId) {
    sql += ` AND id != ?`
    params.push(excludeId)
  }
  const rows = await user.select<{ n: number }[]>(sql, params)
  return (rows[0]?.n ?? 0) > 0
}

// thrown errors (caught by the UI to show a clear message):
//   DUPLICATE_NAME | INVALID_CAPACITY | INVALID_LAYOUT | EMPTY_NAME

function assertName(name: string) {
  if (!name.trim()) throw new Error('EMPTY_NAME')
}

function assertCapacity(maxCapacity: number | null) {
  if (maxCapacity !== null && maxCapacity < 1) throw new Error('INVALID_CAPACITY')
}

// ============================================================
// CREATE
// ============================================================

export async function createDeckbox(
  name: string,
  maxCapacity: number | null = null
): Promise<string> {
  assertName(name)
  assertCapacity(maxCapacity)
  if (await nameExists(name)) throw new Error('DUPLICATE_NAME')

  const { user } = await useDatabase()
  const id = uuid()
  const ts = now()
  await user.execute(
    `INSERT INTO containers (id, type, name, created_at, updated_at) VALUES (?, 'deckbox', ?, ?, ?)`,
    [id, name.trim(), ts, ts]
  )
  await user.execute(`INSERT INTO deckbox_details (container_id, max_capacity) VALUES (?, ?)`, [
    id,
    maxCapacity,
  ])
  return id
}

export async function createBinder(
  name: string,
  pageCount = 0,
  rowsPerPage = 3,
  colsPerPage = 3
): Promise<string> {
  assertName(name)
  if (rowsPerPage < 1 || colsPerPage < 1 || pageCount < 0) throw new Error('INVALID_LAYOUT')
  if (await nameExists(name)) throw new Error('DUPLICATE_NAME')

  const { user } = await useDatabase()
  const id = uuid()
  const ts = now()
  await user.execute(
    `INSERT INTO containers (id, type, name, created_at, updated_at) VALUES (?, 'binder', ?, ?, ?)`,
    [id, name.trim(), ts, ts]
  )
  await user.execute(
    `INSERT INTO binder_details (container_id, page_count, rows_per_page, cols_per_page)
     VALUES (?, ?, ?, ?)`,
    [id, pageCount, rowsPerPage, colsPerPage]
  )
  return id
}

export async function createBulkBox(
  name: string,
  maxCapacity: number | null = null
): Promise<string> {
  assertName(name)
  assertCapacity(maxCapacity)
  if (await nameExists(name)) throw new Error('DUPLICATE_NAME')

  const { user } = await useDatabase()
  const id = uuid()
  const ts = now()
  await user.execute(
    `INSERT INTO containers (id, type, name, created_at, updated_at) VALUES (?, 'bulk_box', ?, ?, ?)`,
    [id, name.trim(), ts, ts]
  )
  await user.execute(`INSERT INTO bulk_box_details (container_id, max_capacity) VALUES (?, ?)`, [
    id,
    maxCapacity,
  ])
  return id
}

// ============================================================
// UPDATE / DELETE
// ============================================================

export async function renameContainer(id: string, name: string): Promise<void> {
  assertName(name)
  if (await nameExists(name, id)) throw new Error('DUPLICATE_NAME')
  const { user } = await useDatabase()
  await user.execute(`UPDATE containers SET name = ?, updated_at = ? WHERE id = ?`, [
    name.trim(),
    now(),
    id,
  ])
}

// change only the page count of a binder (dimensions stay fixed).
// Removing pages frees the cards on those pages (their slots are
// deleted → they become unranged again). Returns how many slots
// were freed.
export async function setBinderPageCount(id: string, pageCount: number): Promise<number> {
  if (pageCount < 0) throw new Error('INVALID_LAYOUT')
  const { user } = await useDatabase()

  // delete slots that fall on pages being removed (page index >= new count)
  const orphaned = await user.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM binder_slots WHERE container_id = ? AND page >= ?`,
    [id, pageCount]
  )
  const freed = orphaned[0]?.n ?? 0

  await user.execute(`DELETE FROM binder_slots WHERE container_id = ? AND page >= ?`, [
    id,
    pageCount,
  ])
  await user.execute(`UPDATE binder_details SET page_count = ? WHERE container_id = ?`, [
    pageCount,
    id,
  ])
  await user.execute(`UPDATE containers SET updated_at = ? WHERE id = ?`, [now(), id])

  return freed
}

// Set the max capacity of a deckbox / bulk_box.
// If the new capacity is below the current content, the excess is
// removed (cards become unranged again), mirroring binder page removal.
// Returns how many copies were freed.
export async function setContainerCapacity(
  id: string,
  type: ContainerType,
  maxCapacity: number | null
): Promise<number> {
  assertCapacity(maxCapacity)
  const { user } = await useDatabase()
  const table = type === 'deckbox' ? 'deckbox_details' : 'bulk_box_details'
  const contentTable = type === 'deckbox' ? 'deckbox_cards' : 'bulk_box_contents'
  const idCol = type === 'deckbox' ? 'deckbox_id' : 'container_id'

  let freed = 0

  // if a finite capacity is set, trim any excess content
  if (maxCapacity !== null) {
    const usedRows = await user.select<{ n: number }[]>(
      `SELECT COALESCE(SUM(quantity), 0) AS n FROM ${contentTable} WHERE ${idCol} = ?`,
      [id]
    )
    const used = usedRows[0]?.n ?? 0
    let excess = used - maxCapacity

    if (excess > 0) {
      // remove from assignment rows, newest first, until back within limit
      const rows = await user.select<{ id: string; quantity: number }[]>(
        `SELECT id, quantity FROM ${contentTable} WHERE ${idCol} = ? ORDER BY rowid DESC`,
        [id]
      )
      for (const r of rows) {
        if (excess <= 0) break
        const take = Math.min(r.quantity, excess)
        if (take >= r.quantity) {
          await user.execute(`DELETE FROM ${contentTable} WHERE id = ?`, [r.id])
        } else {
          await user.execute(`UPDATE ${contentTable} SET quantity = quantity - ? WHERE id = ?`, [
            take,
            r.id,
          ])
        }
        excess -= take
        freed += take
      }
    }
  }

  await user.execute(`UPDATE ${table} SET max_capacity = ? WHERE container_id = ?`, [
    maxCapacity,
    id,
  ])
  await user.execute(`UPDATE containers SET updated_at = ? WHERE id = ?`, [now(), id])

  return freed
}

// soft delete; assignments effectively detach because all queries
// filter on containers.deleted_at IS NULL → cards become unranged again.
export async function deleteContainer(id: string): Promise<void> {
  const { user } = await useDatabase()
  await user.execute(`UPDATE containers SET deleted_at = ?, updated_at = ? WHERE id = ?`, [
    now(),
    now(),
    id,
  ])
}

// ============================================================
// READ — sidebar list with live card counts
// ============================================================

export async function listContainers(): Promise<ContainerListItem[]> {
  const { user } = await useDatabase()

  const rows = await user.select<any[]>(
    `SELECT
        c.id, c.type, c.name,
        dd.max_capacity      AS deckbox_cap,
        bd.page_count, bd.rows_per_page, bd.cols_per_page,
        bbd.max_capacity     AS bulk_cap
     FROM containers c
     LEFT JOIN deckbox_details  dd  ON dd.container_id  = c.id
     LEFT JOIN binder_details   bd  ON bd.container_id  = c.id
     LEFT JOIN bulk_box_details bbd ON bbd.container_id = c.id
     WHERE c.deleted_at IS NULL
     ORDER BY c.type, c.name COLLATE NOCASE`
  )

  const counts = await containerCounts()

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    maxCapacity: r.type === 'deckbox' ? r.deckbox_cap : r.type === 'bulk_box' ? r.bulk_cap : null,
    pageCount: r.page_count ?? undefined,
    rowsPerPage: r.rows_per_page ?? undefined,
    colsPerPage: r.cols_per_page ?? undefined,
    cardCount: counts.get(r.id) ?? 0,
  }))
}

async function containerCounts(): Promise<Map<string, number>> {
  const { user } = await useDatabase()
  const rows = await user.select<{ container_id: string; n: number }[]>(
    `SELECT container_id, SUM(qty) AS n FROM (
        SELECT deckbox_id AS container_id, quantity AS qty FROM deckbox_cards
        UNION ALL
        SELECT container_id, 1 AS qty FROM binder_slots
        UNION ALL
        SELECT container_id, quantity AS qty FROM bulk_box_contents
     )
     GROUP BY container_id`
  )
  return new Map(rows.map((r) => [r.container_id, r.n]))
}

// container list enriched with remaining free capacity.
// remaining = null means unlimited; remaining = 0 means full.
export interface ContainerWithCapacity extends ContainerListItem {
  remaining: number | null
  isFull: boolean
}

export async function listContainersWithCapacity(): Promise<ContainerWithCapacity[]> {
  const list = await listContainers()

  return Promise.all(
    list.map(async (c) => {
      let remaining: number | null
      if (c.type === 'binder') {
        // total slots minus used
        const total = (c.pageCount ?? 0) * (c.rowsPerPage ?? 0) * (c.colsPerPage ?? 0)
        remaining = total === 0 ? 0 : Math.max(0, total - c.cardCount)
      } else if (c.maxCapacity == null) {
        remaining = null // unlimited
      } else {
        remaining = Math.max(0, c.maxCapacity - c.cardCount)
      }
      return { ...c, remaining, isFull: remaining === 0 }
    })
  )
}

// ============================================================
// UNRANGED — owned quantity not assigned to any container
// COALESCE(assigned.qty, 0) INSIDE the SUM so unassigned entries
// (assigned.qty = NULL) count as full quantity, not NULL.
// ============================================================

export async function unrangedCount(game = 'ygo'): Promise<number> {
  const { user } = await useDatabase()
  const rows = await user.select<{ unranged: number }[]>(
    `SELECT COALESCE(SUM(c.quantity - COALESCE(assigned.qty, 0)), 0) AS unranged
     FROM collection c
     LEFT JOIN (${ASSIGNED_SUBQUERY}) assigned ON assigned.collection_id = c.id
     WHERE c.deleted_at IS NULL AND c.game = ?
       AND (c.quantity - COALESCE(assigned.qty, 0)) > 0`,
    [game]
  )
  return rows[0]?.unranged ?? 0
}

export interface UnrangedEntry {
  collectionId: string
  cardId: string
  unranged: number
}

export async function listUnranged(game = 'ygo'): Promise<UnrangedEntry[]> {
  const { user } = await useDatabase()
  const rows = await user.select<any[]>(
    `SELECT c.id AS collection_id, c.card_id,
            (c.quantity - COALESCE(assigned.qty, 0)) AS unranged
     FROM collection c
     LEFT JOIN (${ASSIGNED_SUBQUERY}) assigned ON assigned.collection_id = c.id
     WHERE c.deleted_at IS NULL AND c.game = ?
       AND (c.quantity - COALESCE(assigned.qty, 0)) > 0`,
    [game]
  )
  return rows.map((r) => ({
    collectionId: r.collection_id,
    cardId: r.card_id,
    unranged: r.unranged,
  }))
}

// unranged cards grouped by logical card (for grid/list display),
// crossing user.db + cards-ygo.db.
export async function listUnrangedCards(game = 'ygo'): Promise<ContainerCard[]> {
  const { ygo } = await useDatabase()
  const entries = await listUnranged(game)
  if (!entries.length) return []

  // qty per passcode
  const qtyByCard = new Map<string, number>()
  for (const e of entries) {
    qtyByCard.set(e.cardId, (qtyByCard.get(e.cardId) ?? 0) + e.unranged)
  }

  const ids = [...qtyByCard.keys()]
  const ph = ids.map(() => '?').join(', ')
  const meta = await ygo.select<{ id: string; name: string; alias: string | null }[]>(
    `SELECT c.id, c.name, d.alias
     FROM cards c JOIN ygo_details d ON d.card_id = c.id
     WHERE c.id IN (${ph})`,
    ids
  )
  const metaById = new Map(meta.map((m) => [m.id, m]))

  const groups = new Map<string, ContainerCard>()
  for (const [cardId, qty] of qtyByCard) {
    const m = metaById.get(cardId)
    const root = m?.alias ?? cardId
    let g = groups.get(root)
    if (!g) {
      g = { game, rootId: root, displayId: cardId, name: m?.name ?? cardId, totalQty: 0 }
      groups.set(root, g)
    }
    g.totalQty += qty
    const currentMax = qtyByCard.get(g.displayId) ?? 0
    if (qty > currentMax) g.displayId = cardId
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ============================================================
// ASSIGNMENT
// ============================================================

export async function assignToDeckbox(
  deckboxId: string,
  collectionId: string,
  quantity = 1
): Promise<void> {
  const { user } = await useDatabase()
  await user.execute(
    `INSERT INTO deckbox_cards (id, deckbox_id, collection_id, quantity) VALUES (?, ?, ?, ?)`,
    [uuid(), deckboxId, collectionId, quantity]
  )
}

export async function assignToBulkBox(
  containerId: string,
  collectionId: string,
  quantity = 1
): Promise<void> {
  const { user } = await useDatabase()
  await user.execute(
    `INSERT INTO bulk_box_contents (id, container_id, collection_id, quantity) VALUES (?, ?, ?, ?)`,
    [uuid(), containerId, collectionId, quantity]
  )
}

export async function assignToBinderSlot(
  containerId: string,
  collectionId: string,
  page: number,
  row: number,
  col: number
): Promise<void> {
  const { user } = await useDatabase()
  await user.execute(
    `INSERT INTO binder_slots (id, container_id, collection_id, page, row, col) VALUES (?, ?, ?, ?, ?, ?)`,
    [uuid(), containerId, collectionId, page, row, col]
  )
}

// ── next free slot in a binder (row-major, page by page) ──────
// Returns null if the binder is full (all pages × rows × cols taken).
export async function nextFreeBinderSlot(
  containerId: string
): Promise<{ page: number; row: number; col: number } | null> {
  const { user } = await useDatabase()

  const details = await user.select<
    { page_count: number; rows_per_page: number; cols_per_page: number }[]
  >(`SELECT page_count, rows_per_page, cols_per_page FROM binder_details WHERE container_id = ?`, [
    containerId,
  ])
  if (!details[0]) return null
  const { page_count, rows_per_page, cols_per_page } = details[0]

  const taken = await user.select<{ page: number; row: number; col: number }[]>(
    `SELECT page, row, col FROM binder_slots WHERE container_id = ?`,
    [containerId]
  )
  const takenSet = new Set(taken.map((t) => `${t.page}:${t.row}:${t.col}`))

  for (let page = 0; page < page_count; page++) {
    for (let row = 0; row < rows_per_page; row++) {
      for (let col = 0; col < cols_per_page; col++) {
        if (!takenSet.has(`${page}:${row}:${col}`)) return { page, row, col }
      }
    }
  }
  return null // binder full
}

// remaining free capacity of a deckbox / bulk_box.
// Returns null if unlimited (max_capacity IS NULL).
export async function remainingCapacity(
  containerId: string,
  type: ContainerType
): Promise<number | null> {
  if (type === 'binder') {
    // binder capacity is positional; use free-slot logic instead
    const slot = await nextFreeBinderSlot(containerId)
    return slot ? 1 : 0 // at least one free, or full
  }

  const { user } = await useDatabase()
  const table = type === 'deckbox' ? 'deckbox_details' : 'bulk_box_details'
  const cap = await user.select<{ max_capacity: number | null }[]>(
    `SELECT max_capacity FROM ${table} WHERE container_id = ?`,
    [containerId]
  )
  const max = cap[0]?.max_capacity
  if (max === null || max === undefined) return null // unlimited

  // current total quantity in this container
  const contentTable = type === 'deckbox' ? 'deckbox_cards' : 'bulk_box_contents'
  const idCol = type === 'deckbox' ? 'deckbox_id' : 'container_id'
  const used = await user.select<{ n: number }[]>(
    `SELECT COALESCE(SUM(quantity), 0) AS n FROM ${contentTable} WHERE ${idCol} = ?`,
    [containerId]
  )
  return Math.max(0, max - (used[0]?.n ?? 0))
}

// ── assign N copies of a CARD (passcode) to a container ──────
// The user thinks in cards; the DB stores entries. This pulls
// `quantity` unranged copies from the card's collection entries
// (in order) and assigns each to the container.
//
// For a binder, each copy takes one slot; stops early if the
// binder fills up (returns how many were actually placed).
// Returns the number of copies actually assigned.
export async function assignCardToContainer(
  game: string,
  cardId: string,
  containerId: string,
  type: ContainerType,
  quantity: number
): Promise<number> {
  const { user } = await useDatabase()

  // cap the request to the container's remaining capacity (deckbox/bulk_box)
  let remaining = quantity
  if (type === 'deckbox' || type === 'bulk_box') {
    const room = await remainingCapacity(containerId, type)
    if (room !== null) remaining = Math.min(remaining, room)
  }
  if (remaining <= 0) return 0

  // unranged quantity per collection entry of this card
  const entries = await user.select<{ id: string; unranged: number }[]>(
    `SELECT c.id, (c.quantity - COALESCE(assigned.qty, 0)) AS unranged
     FROM collection c
     LEFT JOIN (${ASSIGNED_SUBQUERY}) assigned ON assigned.collection_id = c.id
     WHERE c.deleted_at IS NULL AND c.game = ? AND c.card_id = ?
       AND (c.quantity - COALESCE(assigned.qty, 0)) > 0
     ORDER BY c.created_at`,
    [game, cardId]
  )

  let placed = 0

  for (const entry of entries) {
    if (remaining <= 0) break
    const take = Math.min(entry.unranged, remaining)

    if (type === 'binder') {
      for (let i = 0; i < take; i++) {
        const slot = await nextFreeBinderSlot(containerId)
        if (!slot) return placed // binder full, stop
        await assignToBinderSlot(containerId, entry.id, slot.page, slot.row, slot.col)
        placed++
        remaining--
      }
    } else {
      // deckbox / bulk_box — direct insert (capacity already capped above)
      if (type === 'deckbox') await assignToDeckbox(containerId, entry.id, take)
      else await assignToBulkBox(containerId, entry.id, take)
      placed += take
      remaining -= take
    }
  }

  return placed
}

// ============================================================
// CONTAINER CONTENTS
// What's actually inside a container, grouped by logical card
// (via alias), crossing user.db + cards-ygo.db. Binder keeps
// per-slot rows (position matters) — handled by the binder view.
// ============================================================

export interface ContainerCard {
  game: string
  rootId: string // alias root (logical card)
  displayId: string // passcode for the thumbnail
  name: string
  totalQty: number
}

// a single occupied slot in a binder (positional)
export interface BinderSlotCard {
  slotId: string
  collectionId: string
  game: string
  cardId: string // passcode for the thumbnail
  name: string
  page: number
  row: number
  col: number
}

// all occupied slots of a binder, with card name (for the grid view)
export async function listBinderSlots(
  containerId: string,
  game = 'ygo'
): Promise<BinderSlotCard[]> {
  const { user, ygo } = await useDatabase()

  const slots = await user.select<
    { id: string; collection_id: string; card_id: string; page: number; row: number; col: number }[]
  >(
    `SELECT bs.id, bs.collection_id, c.card_id, bs.page, bs.row, bs.col
     FROM binder_slots bs
     JOIN collection c ON c.id = bs.collection_id AND c.deleted_at IS NULL
     WHERE bs.container_id = ? AND c.game = ?
     ORDER BY bs.page, bs.row, bs.col`,
    [containerId, game]
  )
  if (!slots.length) return []

  const ids = [...new Set(slots.map((s) => s.card_id))]
  const ph = ids.map(() => '?').join(', ')
  const names = await ygo.select<{ id: string; name: string }[]>(
    `SELECT id, name FROM cards WHERE id IN (${ph})`,
    ids
  )
  const nameById = new Map(names.map((n) => [n.id, n.name]))

  return slots.map((s) => ({
    slotId: s.id,
    collectionId: s.collection_id,
    game,
    cardId: s.card_id,
    name: nameById.get(s.card_id) ?? s.card_id,
    page: s.page,
    row: s.row,
    col: s.col,
  }))
}

// clear a specific binder slot by its id (for the grid view's remove)
export async function clearBinderSlotById(slotId: string): Promise<void> {
  const { user } = await useDatabase()
  await user.execute(`DELETE FROM binder_slots WHERE id = ?`, [slotId])
}

// place a specific card into a precise binder slot.
// Pulls one unranged entry of this card and assigns it to (page,row,col).
// Throws SLOT_TAKEN if the slot is already occupied, or NO_COPY if no
// unranged copy is available.
export async function assignCardToBinderSlot(
  game: string,
  cardId: string,
  containerId: string,
  page: number,
  row: number,
  col: number
): Promise<void> {
  const { user } = await useDatabase()

  // slot must be free
  const occupied = await user.select<{ id: string }[]>(
    `SELECT id FROM binder_slots WHERE container_id = ? AND page = ? AND row = ? AND col = ?`,
    [containerId, page, row, col]
  )
  if (occupied.length) throw new Error('SLOT_TAKEN')

  // first unranged entry of this card
  const entries = await user.select<{ id: string }[]>(
    `SELECT c.id
     FROM collection c
     LEFT JOIN (${ASSIGNED_SUBQUERY}) assigned ON assigned.collection_id = c.id
     WHERE c.deleted_at IS NULL AND c.game = ? AND c.card_id = ?
       AND (c.quantity - COALESCE(assigned.qty, 0)) > 0
     ORDER BY c.created_at
     LIMIT 1`,
    [game, cardId]
  )
  const entry = entries[0]
  if (!entry) throw new Error('NO_COPY')

  await assignToBinderSlot(containerId, entry.id, page, row, col)
}

// raw assignment rows for a container (collection_id + quantity)
async function containerAssignments(
  containerId: string,
  type: ContainerType
): Promise<{ collection_id: string; qty: number }[]> {
  const { user } = await useDatabase()
  if (type === 'deckbox') {
    return user.select(
      `SELECT collection_id, quantity AS qty FROM deckbox_cards WHERE deckbox_id = ?`,
      [containerId]
    )
  }
  if (type === 'bulk_box') {
    return user.select(
      `SELECT collection_id, quantity AS qty FROM bulk_box_contents WHERE container_id = ?`,
      [containerId]
    )
  }
  // binder: each slot = 1
  return user.select(`SELECT collection_id, 1 AS qty FROM binder_slots WHERE container_id = ?`, [
    containerId,
  ])
}

// container content grouped by logical card (for grid/list display)
export async function listContainerCards(
  containerId: string,
  type: ContainerType,
  game = 'ygo'
): Promise<ContainerCard[]> {
  const { user, ygo } = await useDatabase()

  const assignments = await containerAssignments(containerId, type)
  if (!assignments.length) return []

  // resolve each collection_id → its card_id + quantity in this container
  const collIds = assignments.map((a) => a.collection_id)
  const ph = collIds.map(() => '?').join(', ')
  const collRows = await user.select<{ id: string; card_id: string; game: string }[]>(
    `SELECT id, card_id, game FROM collection WHERE id IN (${ph}) AND deleted_at IS NULL`,
    collIds
  )
  const collById = new Map(collRows.map((c) => [c.id, c]))

  // qty per card_id (passcode)
  const qtyByCard = new Map<string, number>()
  for (const a of assignments) {
    const coll = collById.get(a.collection_id)
    if (!coll || coll.game !== game) continue
    qtyByCard.set(coll.card_id, (qtyByCard.get(coll.card_id) ?? 0) + a.qty)
  }
  if (!qtyByCard.size) return []

  // resolve alias root + name for each passcode
  const ids = [...qtyByCard.keys()]
  const ph2 = ids.map(() => '?').join(', ')
  const meta = await ygo.select<{ id: string; name: string; alias: string | null }[]>(
    `SELECT c.id, c.name, d.alias
     FROM cards c JOIN ygo_details d ON d.card_id = c.id
     WHERE c.id IN (${ph2})`,
    ids
  )
  const metaById = new Map(meta.map((m) => [m.id, m]))

  // group by alias root
  const groups = new Map<string, ContainerCard>()
  for (const [cardId, qty] of qtyByCard) {
    const m = metaById.get(cardId)
    const root = m?.alias ?? cardId
    let g = groups.get(root)
    if (!g) {
      g = { game, rootId: root, displayId: cardId, name: m?.name ?? cardId, totalQty: 0 }
      groups.set(root, g)
    }
    g.totalQty += qty
    // display = most-owned passcode in this container
    const currentMax = qtyByCard.get(g.displayId) ?? 0
    if (qty > currentMax) g.displayId = cardId
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ============================================================
// UNASSIGN
// ============================================================

// ── remove N copies of a CARD (passcode) from a container ──────
// Mirror of assignCardToContainer: the user removes "cards", the DB
// holds assignment rows. Pulls `quantity` copies from this card's
// assignment rows in this container.
//
// For deckbox/bulk_box: a row may hold quantity > 1, so we decrement
// the row's quantity (or delete it if it hits zero).
// For binder: each slot = 1 copy, so we delete slots one by one.
// Returns the number of copies actually removed.
export async function unassignCardFromContainer(
  game: string,
  cardId: string,
  containerId: string,
  type: ContainerType,
  quantity: number
): Promise<number> {
  const { user } = await useDatabase()

  if (type === 'binder') {
    // slots holding this card in this binder
    const slots = await user.select<{ id: string }[]>(
      `SELECT bs.id
       FROM binder_slots bs
       JOIN collection c ON c.id = bs.collection_id
       WHERE bs.container_id = ? AND c.game = ? AND c.card_id = ?
       ORDER BY bs.page, bs.row, bs.col`,
      [containerId, game, cardId]
    )
    let removed = 0
    for (const s of slots) {
      if (removed >= quantity) break
      await user.execute(`DELETE FROM binder_slots WHERE id = ?`, [s.id])
      removed++
    }
    return removed
  }

  // deckbox / bulk_box
  const contentTable = type === 'deckbox' ? 'deckbox_cards' : 'bulk_box_contents'
  const idCol = type === 'deckbox' ? 'deckbox_id' : 'container_id'

  const rows = await user.select<{ id: string; quantity: number }[]>(
    `SELECT a.id, a.quantity
     FROM ${contentTable} a
     JOIN collection c ON c.id = a.collection_id
     WHERE a.${idCol} = ? AND c.game = ? AND c.card_id = ?
     ORDER BY a.quantity`,
    [containerId, game, cardId]
  )

  let remaining = quantity
  let removed = 0
  for (const r of rows) {
    if (remaining <= 0) break
    const take = Math.min(r.quantity, remaining)
    if (take >= r.quantity) {
      await user.execute(`DELETE FROM ${contentTable} WHERE id = ?`, [r.id])
    } else {
      await user.execute(`UPDATE ${contentTable} SET quantity = quantity - ? WHERE id = ?`, [
        take,
        r.id,
      ])
    }
    removed += take
    remaining -= take
  }
  return removed
}

// ============================================================
// CARD LOCATIONS — "where is this card?"
// Queries the card_locations view for one card (all artworks
// of a logical card resolve to their own passcode here, so the
// caller passes the exact passcode shown in the detail).
// ============================================================

export interface CardLocation {
  locationType: 'deck' | 'deckbox' | 'binder' | 'bulk_box'
  locationName: string
  containerId: string | null
  quantity: number
  page: number | null
  row: number | null
  col: number | null
  extraInfo: string | null // board (main/side/...) for decks
}

export async function cardLocations(game: string, cardId: string): Promise<CardLocation[]> {
  const { user } = await useDatabase()
  const rows = await user.select<any[]>(
    `SELECT location_type, location_name, container_id, quantity, page, row, col, extra_info
     FROM card_locations
     WHERE game = ? AND card_id = ?
     ORDER BY location_type, location_name, page, row, col`,
    [game, cardId]
  )
  return rows.map((r) => ({
    locationType: r.location_type,
    locationName: r.location_name,
    containerId: r.container_id,
    quantity: r.quantity,
    page: r.page,
    row: r.row,
    col: r.col,
    extraInfo: r.extra_info,
  }))
}
