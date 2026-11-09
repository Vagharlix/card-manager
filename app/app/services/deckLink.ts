import { useDatabase } from '~/composables/useDatabase'
import { cardMetaOf, variantsOfRoots } from '~/services/card/meta'
import { deckGame } from '~/services/decks'

function uuid(): string {
  return crypto.randomUUID()
}

function now(): string {
  return new Date().toISOString()
}

// ============================================================
// DECK ↔ DECKBOX LINKING
// Ranging a deck into a deckbox assigns its OWNED copies to that
// box, matching physical reality: the cards that make up the deck
// physically live in the box. "Last in wins" — copies already in
// another container are MOVED here.
//
// This module computes a PLAN (read-only) so the UI can show a
// confirmation recap before anything is modified. Application is
// a separate step.
// ============================================================

// per-card breakdown of what ranging would do
export interface MovedSource {
  containerId: string
  name: string
  qty: number
}

export interface DeckLinkLine {
  rootId: string // logical card (alias root)
  displayId: string // passcode for the thumbnail
  name: string
  needed: number // copies the deck wants (across boards)
  owned: number // copies the user owns
  alreadyHere: number // copies already assigned to THIS deckbox
  toAssign: number // owned & unranged copies that will be assigned
  toMove: number // owned copies currently elsewhere that will move here
  movedFrom: MovedSource[] // which containers lose copies, and how many
  missing: number // needed but not owned (cannot be ranged)
}

export interface DeckLinkPlan {
  deckId: string
  deckboxId: string
  deckboxName: string
  lines: DeckLinkLine[]
  totalToPlace: number // assign + move (physical copies entering the box)
  // cards currently in the box that are NOT in the deck → will be unranged
  purge: { name: string; qty: number }[]
  purgeTotal: number
  // capacity
  capacity: number | null // null = unlimited
  currentInBox: number // copies already in the box (any card)
  willExceed: boolean
  neededCapacity: number // capacity required to fit everything
}

interface DeckRow {
  card_id: string
  quantity: number
  board: string
}

// logical-card aggregation of the deck's card list
interface DeckNeed {
  root: string
  displayId: string
  needed: number
}

// resolve card ids to their logical card (root) + name, via the game's
// card database (shared contract). Unknown ids are absent from the maps:
// callers fall back to the id.
async function rootsOf(
  game: string,
  cardIds: string[]
): Promise<{ rootById: Map<string, string>; nameById: Map<string, string> }> {
  const meta = await cardMetaOf(game, cardIds)
  return {
    rootById: new Map([...meta.values()].map((m) => [m.id, m.root])),
    nameById: new Map([...meta.values()].map((m) => [m.id, m.name])),
  }
}

// resolve every deck card to its alias root, sum the quantities per
// logical card (so all artworks + all boards combine into one need).
async function deckNeeds(deckId: string, game: string): Promise<Map<string, DeckNeed>> {
  const { user } = await useDatabase()

  const rows = await user.select<DeckRow[]>(
    `SELECT card_id, quantity, board FROM deck_cards WHERE deck_id = ?`,
    [deckId]
  )
  if (!rows.length) return new Map()

  const { rootById } = await rootsOf(game, rows.map((r) => r.card_id))

  const needs = new Map<string, DeckNeed>()
  for (const r of rows) {
    const root = rootById.get(r.card_id) ?? r.card_id
    const n = needs.get(root) ?? { root, displayId: r.card_id, needed: 0 }
    n.needed += r.quantity
    needs.set(root, n)
  }
  return needs
}

// Soft-deleted collection entries (removeCard) keep their assignment
// rows: every query below that reads assignments joins `collection`
// with `deleted_at IS NULL`, so those ghost copies never count as
// present, never get moved, and don't take capacity.
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

// the deckbox a deck is currently ranged in (null if none).
export interface CurrentDeckbox {
  id: string
  name: string
}

export async function deckCurrentDeckbox(deckId: string): Promise<CurrentDeckbox | null> {
  const { user } = await useDatabase()
  const rows = await user.select<{ id: string; name: string }[]>(
    `SELECT c.id, c.name
     FROM deckbox_decks dd
     JOIN containers c ON c.id = dd.deckbox_id AND c.deleted_at IS NULL
     WHERE dd.deck_id = ?
     LIMIT 1`,
    [deckId]
  )
  return rows[0] ?? null
}

// build a plan WITHOUT modifying anything
export async function planDeckToDeckbox(
  deckId: string,
  deckboxId: string,
  game?: string
): Promise<DeckLinkPlan> {
  const { user } = await useDatabase()
  game ??= await deckGame(deckId)

  // deckbox name + capacity
  const boxRows = await user.select<{ name: string; max_capacity: number | null }[]>(
    `SELECT c.name, dd.max_capacity
     FROM containers c JOIN deckbox_details dd ON dd.container_id = c.id
     WHERE c.id = ? AND c.deleted_at IS NULL`,
    [deckboxId]
  )
  const deckboxName = boxRows[0]?.name ?? 'Deckbox'
  const capacity = boxRows[0]?.max_capacity ?? null

  // copies already in this box (any card) — for capacity math
  const inBoxRows = await user.select<{ n: number }[]>(
    `SELECT COALESCE(SUM(dc.quantity), 0) AS n
     FROM deckbox_cards dc
     JOIN collection c ON c.id = dc.collection_id AND c.deleted_at IS NULL
     WHERE dc.deckbox_id = ?`,
    [deckboxId]
  )
  const currentInBox = inBoxRows[0]?.n ?? 0

  const needs = await deckNeeds(deckId, game)
  const lines: DeckLinkLine[] = []
  let totalToPlace = 0

  // Tout ce qu'il faut savoir des cartes du deck, en 4 requêtes quel que
  // soit le nombre de cartes (chaque requête coûte un aller-retour vers
  // Rust dans l'appli) : artworks, exemplaires possédés, copies déjà dans
  // la deckbox, provenance des copies rangées ailleurs.
  const variants = await variantsOfRoots(game, [...needs.keys()])
  const rootOf = new Map<string, string>()
  for (const [root, ids] of variants) for (const id of ids) rootOf.set(id, root)
  const allIds = [...rootOf.keys()]
  const aph = allIds.map(() => '?').join(', ')

  const entriesByRoot = new Map<string, { quantity: number; assigned: number }[]>()
  const hereByRoot = new Map<string, number>()
  const sourcesByRoot = new Map<string, { container_id: string; name: string; qty: number }[]>()
  if (allIds.length) {
    const entries = await user.select<{ card_id: string; quantity: number; assigned: number }[]>(
      `SELECT c.card_id, c.quantity, COALESCE(a.qty, 0) AS assigned
       FROM collection c
       LEFT JOIN (${ASSIGNED_SUBQUERY}) a ON a.collection_id = c.id
       WHERE c.deleted_at IS NULL AND c.game = ? AND c.card_id IN (${aph})`,
      [game, ...allIds]
    )
    for (const e of entries) {
      const root = rootOf.get(e.card_id)!
      entriesByRoot.set(root, [...(entriesByRoot.get(root) ?? []), e])
    }

    // copies already assigned to THIS deckbox (count toward "alreadyHere")
    const here = await user.select<{ card_id: string; n: number }[]>(
      `SELECT c.card_id, SUM(dc.quantity) AS n
       FROM deckbox_cards dc
       JOIN collection c ON c.id = dc.collection_id AND c.deleted_at IS NULL
       WHERE dc.deckbox_id = ? AND c.game = ? AND c.card_id IN (${aph})
       GROUP BY c.card_id`,
      [deckboxId, game, ...allIds]
    )
    for (const r of here) {
      const root = rootOf.get(r.card_id)!
      hereByRoot.set(root, (hereByRoot.get(root) ?? 0) + r.n)
    }

    // copies rangées dans d'autres conteneurs, par conteneur (ordre des noms)
    const sources = await user.select<
      { card_id: string; container_id: string; name: string; qty: number }[]
    >(
      `SELECT c.card_id, asg.cid AS container_id, ct.name, SUM(asg.qty) AS qty
       FROM (
          SELECT dc.collection_id, dc.deckbox_id AS cid, dc.quantity AS qty FROM deckbox_cards dc
          UNION ALL SELECT bs.collection_id, bs.container_id, 1 AS qty FROM binder_slots bs
          UNION ALL SELECT bb.collection_id, bb.container_id, bb.quantity AS qty FROM bulk_box_contents bb
       ) asg
       JOIN collection c ON c.id = asg.collection_id AND c.deleted_at IS NULL
       JOIN containers ct ON ct.id = asg.cid AND ct.deleted_at IS NULL
       WHERE c.game = ? AND c.card_id IN (${aph}) AND ct.id != ?
       GROUP BY c.card_id, asg.cid, ct.name
       ORDER BY ct.name`,
      [game, ...allIds, deckboxId]
    )
    for (const r of sources) {
      const root = rootOf.get(r.card_id)!
      const list = sourcesByRoot.get(root) ?? []
      const same = list.find((x) => x.container_id === r.container_id)
      if (same) same.qty += r.qty
      else list.push({ container_id: r.container_id, name: r.name, qty: r.qty })
      sourcesByRoot.set(root, list)
    }
  }

  for (const need of needs.values()) {
    const entries = entriesByRoot.get(need.root) ?? []
    const owned = entries.reduce((s, e) => s + e.quantity, 0)
    const alreadyHere = hereByRoot.get(need.root) ?? 0

    // unranged copies available to assign directly
    const unranged = entries.reduce((s, e) => s + Math.max(0, e.quantity - e.assigned), 0)

    // how many copies still need to enter the box to reach `needed`
    // (cap by owned: we can only place copies we actually have)
    const target = Math.min(need.needed, owned)
    const stillToPlace = Math.max(0, target - alreadyHere)

    const toAssign = Math.min(stillToPlace, unranged)
    const toMove = stillToPlace - toAssign // must come from other containers
    const missing = Math.max(0, need.needed - owned)

    // provenance of the to-move copies (which containers lose how many).
    // We pick from other containers in a stable order until `toMove` is met.
    const movedFrom: MovedSource[] = []
    if (toMove > 0) {
      let left = toMove
      for (const src of sourcesByRoot.get(need.root) ?? []) {
        if (left <= 0) break
        const take = Math.min(src.qty, left)
        movedFrom.push({ containerId: src.container_id, name: src.name, qty: take })
        left -= take
      }
    }

    if (toAssign > 0 || toMove > 0 || missing > 0) {
      lines.push({
        rootId: need.root,
        displayId: need.displayId,
        name: '', // filled below
        needed: need.needed,
        owned,
        alreadyHere,
        toAssign,
        toMove,
        movedFrom,
        missing,
      })
      totalToPlace += toAssign + toMove
    }
  }

  // fill names
  if (lines.length) {
    const { nameById } = await rootsOf(game, lines.map((l) => l.displayId))
    for (const l of lines) l.name = nameById.get(l.displayId) ?? l.displayId
    lines.sort((a, b) => a.name.localeCompare(b.name))
  }

  // ── cartes étrangères au deck présentes dans la deckbox (à purger) ──
  // On résout chaque carte de la deckbox en root logique ; si ce root
  // n'est pas dans les besoins du deck, la carte sera remise en non rangées.
  const boxCards = await user.select<{ card_id: string; qty: number }[]>(
    `SELECT c.card_id, SUM(dc.quantity) AS qty
     FROM deckbox_cards dc
     JOIN collection c ON c.id = dc.collection_id AND c.deleted_at IS NULL
     WHERE dc.deckbox_id = ? AND c.game = ?
     GROUP BY c.card_id`,
    [deckboxId, game]
  )

  const purge: { name: string; qty: number }[] = []
  let purgeTotal = 0
  if (boxCards.length) {
    const { rootById, nameById } = await rootsOf(game, boxCards.map((b) => b.card_id))
    for (const b of boxCards) {
      const root = rootById.get(b.card_id) ?? b.card_id
      if (!needs.has(root)) {
        // carte étrangère au deck → sera purgée
        purge.push({ name: nameById.get(b.card_id) ?? b.card_id, qty: b.qty })
        purgeTotal += b.qty
      }
    }
  }

  // capacity check: after purge, the box keeps (currentInBox - purgeTotal),
  // then totalToPlace copies enter.
  const neededCapacity = currentInBox - purgeTotal + totalToPlace
  const willExceed = capacity !== null && neededCapacity > capacity

  return {
    deckId,
    deckboxId,
    deckboxName,
    lines,
    totalToPlace,
    purge,
    purgeTotal,
    capacity,
    currentInBox,
    willExceed,
    neededCapacity,
  }
}

// ============================================================
// APPLY — executes the plan. Modifies the database:
//   - assigns unranged copies to the deckbox
//   - moves copies from other containers into the deckbox
//   - raises the deckbox capacity if needed (caller confirmed)
//   - updates the deckbox_decks link (a deck lives in one box)
// Re-runs the same selection logic as the plan so what happens
// matches what was shown.
// ============================================================

export async function applyDeckToDeckbox(
  deckId: string,
  deckboxId: string,
  game?: string
): Promise<void> {
  const { user } = await useDatabase()
  game ??= await deckGame(deckId)

  // recompute the plan to act on fresh data
  const plan = await planDeckToDeckbox(deckId, deckboxId, game)

  // 0. purge: remove from the deckbox every card NOT in the deck
  //    (they become unranged). Resolve box cards to logical roots and
  //    delete the assignment rows whose root isn't a deck need.
  const needs = await deckNeeds(deckId, game)
  const boxRows = await user.select<{ id: string; card_id: string }[]>(
    `SELECT dc.id, c.card_id
     FROM deckbox_cards dc
     JOIN collection c ON c.id = dc.collection_id AND c.deleted_at IS NULL
     WHERE dc.deckbox_id = ? AND c.game = ?`,
    [deckboxId, game]
  )
  if (boxRows.length) {
    const { rootById } = await rootsOf(game, boxRows.map((r) => r.card_id))
    for (const r of boxRows) {
      const root = rootById.get(r.card_id) ?? r.card_id
      if (!needs.has(root)) {
        // étrangère au deck → désassigner (repasse en non rangées)
        await user.execute(`DELETE FROM deckbox_cards WHERE id = ?`, [r.id])
      }
    }
  }

  // 1. raise capacity if needed
  if (plan.willExceed && plan.capacity !== null) {
    await user.execute(`UPDATE deckbox_details SET max_capacity = ? WHERE container_id = ?`, [
      plan.neededCapacity,
      deckboxId,
    ])
    await user.execute(`UPDATE containers SET updated_at = ? WHERE id = ?`, [now(), deckboxId])
  }

  // 2. per card: assign unranged + move from elsewhere
  for (const line of plan.lines) {
    const variantIds = (await variantsOfRoots(game, [line.rootId])).get(line.rootId) ?? [line.rootId]
    const vph = variantIds.map(() => '?').join(', ')

    // ── assign unranged copies (toAssign) ──
    let toAssign = line.toAssign
    if (toAssign > 0) {
      const unrangedEntries = await user.select<{ id: string; unranged: number }[]>(
        `SELECT c.id, (c.quantity - COALESCE(a.qty, 0)) AS unranged
         FROM collection c
         LEFT JOIN (${ASSIGNED_SUBQUERY}) a ON a.collection_id = c.id
         WHERE c.deleted_at IS NULL AND c.game = ? AND c.card_id IN (${vph})
           AND (c.quantity - COALESCE(a.qty, 0)) > 0
         ORDER BY c.created_at`,
        [game, ...variantIds]
      )
      for (const e of unrangedEntries) {
        if (toAssign <= 0) break
        const take = Math.min(e.unranged, toAssign)
        await user.execute(
          `INSERT INTO deckbox_cards (id, deckbox_id, collection_id, quantity) VALUES (?, ?, ?, ?)`,
          [uuid(), deckboxId, e.id, take]
        )
        toAssign -= take
      }
    }

    // ── move copies from other containers (toMove) ──
    let toMove = line.toMove
    if (toMove > 0) {
      for (const src of line.movedFrom) {
        if (toMove <= 0) break
        let fromThisContainer = src.qty

        // pull assignment rows of this card in the source container,
        // detach them, and re-assign to the target deckbox.
        // deckbox source
        const dbRows = await user.select<{ id: string; collection_id: string; quantity: number }[]>(
          `SELECT dc.id, dc.collection_id, dc.quantity
           FROM deckbox_cards dc
           JOIN collection c ON c.id = dc.collection_id AND c.deleted_at IS NULL
           WHERE dc.deckbox_id = ? AND c.game = ? AND c.card_id IN (${vph})
           ORDER BY dc.quantity`,
          [src.containerId, game, ...variantIds]
        )
        for (const r of dbRows) {
          if (fromThisContainer <= 0 || toMove <= 0) break
          const take = Math.min(r.quantity, fromThisContainer, toMove)
          // detach from source
          if (take >= r.quantity) {
            await user.execute(`DELETE FROM deckbox_cards WHERE id = ?`, [r.id])
          } else {
            await user.execute(`UPDATE deckbox_cards SET quantity = quantity - ? WHERE id = ?`, [
              take,
              r.id,
            ])
          }
          // attach to target
          await user.execute(
            `INSERT INTO deckbox_cards (id, deckbox_id, collection_id, quantity) VALUES (?, ?, ?, ?)`,
            [uuid(), deckboxId, r.collection_id, take]
          )
          fromThisContainer -= take
          toMove -= take
        }

        // binder source (each slot = 1)
        if (fromThisContainer > 0 && toMove > 0) {
          const slots = await user.select<{ id: string; collection_id: string }[]>(
            `SELECT bs.id, bs.collection_id
             FROM binder_slots bs
             JOIN collection c ON c.id = bs.collection_id AND c.deleted_at IS NULL
             WHERE bs.container_id = ? AND c.game = ? AND c.card_id IN (${vph})
             ORDER BY bs.page, bs.row, bs.col`,
            [src.containerId, game, ...variantIds]
          )
          for (const s of slots) {
            if (fromThisContainer <= 0 || toMove <= 0) break
            await user.execute(`DELETE FROM binder_slots WHERE id = ?`, [s.id])
            await user.execute(
              `INSERT INTO deckbox_cards (id, deckbox_id, collection_id, quantity) VALUES (?, ?, ?, 1)`,
              [uuid(), deckboxId, s.collection_id]
            )
            fromThisContainer--
            toMove--
          }
        }

        // bulk_box source
        if (fromThisContainer > 0 && toMove > 0) {
          const bbRows = await user.select<
            { id: string; collection_id: string; quantity: number }[]
          >(
            `SELECT bb.id, bb.collection_id, bb.quantity
             FROM bulk_box_contents bb
             JOIN collection c ON c.id = bb.collection_id AND c.deleted_at IS NULL
             WHERE bb.container_id = ? AND c.game = ? AND c.card_id IN (${vph})
             ORDER BY bb.quantity`,
            [src.containerId, game, ...variantIds]
          )
          for (const r of bbRows) {
            if (fromThisContainer <= 0 || toMove <= 0) break
            const take = Math.min(r.quantity, fromThisContainer, toMove)
            if (take >= r.quantity) {
              await user.execute(`DELETE FROM bulk_box_contents WHERE id = ?`, [r.id])
            } else {
              await user.execute(
                `UPDATE bulk_box_contents SET quantity = quantity - ? WHERE id = ?`,
                [take, r.id]
              )
            }
            await user.execute(
              `INSERT INTO deckbox_cards (id, deckbox_id, collection_id, quantity) VALUES (?, ?, ?, ?)`,
              [uuid(), deckboxId, r.collection_id, take]
            )
            fromThisContainer -= take
            toMove -= take
          }
        }
      }
    }
  }

  // 3. update the link (a deck lives in exactly one deckbox)
  await user.execute(`DELETE FROM deckbox_decks WHERE deck_id = ?`, [deckId])
  await user.execute(`INSERT INTO deckbox_decks (deckbox_id, deck_id) VALUES (?, ?)`, [
    deckboxId,
    deckId,
  ])
}
