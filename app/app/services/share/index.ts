import { useDatabase } from '~/composables/useDatabase'
import { decodeShare, encodeShare, type SharePayload } from './codec'
import { cardMetaOf, variantsOfRoots, type CardMeta } from '~/services/card/meta'
import { gameDefOrNull } from '~/services/game'

// ============================================================
// SHARE SERVICE — partage de collection entre joueurs.
//   - buildMyShare : ce que j'envoie (cartes possédées, quantités,
//     quantités à l'échange), encodé par le codec.
//   - resolveShare : ce que je reçois, enrichi (noms, artworks
//     regroupés) et croisé avec ma propre collection.
//   - collections reçues enregistrées (table shared_collections).
// ============================================================

export { decodeShare, encodeShare, ShareCodeError, SHARE_PREFIX, SHARE_PREFIX_V2 } from './codec'
export type { SharePayload, ShareCard } from './codec'
export { toFrames, FrameAssembler, type AssembleResult } from './frames'

export interface ShareOptions {
  owner: string
  onlyTrade?: boolean
}

export async function buildMyShare(game: string, opts: ShareOptions): Promise<SharePayload> {
  const { user } = await useDatabase()
  const rows = await user.select<{ card_id: string; qty: number; trade: number }[]>(
    `SELECT card_id, SUM(quantity) AS qty, SUM(trade_qty) AS trade
     FROM collection
     WHERE deleted_at IS NULL AND game = ?
     GROUP BY card_id`,
    [game]
  )
  return {
    game,
    owner: opts.owner.trim(),
    createdAt: Date.now(),
    cards: rows
      .filter((r) => !opts.onlyTrade || r.trade > 0)
      .map((r) => ({ id: r.card_id, qty: r.qty, trade: r.trade })),
  }
}

export async function shareCode(game: string, opts: ShareOptions): Promise<string> {
  return encodeShare(await buildMyShare(game, opts))
}

// ── vue d'une collection reçue ──

export interface SharedCardView {
  rootId: string // carte logique
  displayId: string // passcode à afficher (le plus présent)
  name: string
  qty: number // chez l'autre joueur
  trade: number // proposées à l'échange par l'autre joueur
  mine: number // combien j'en possède (tous artworks)
}

export async function resolveShare(payload: SharePayload): Promise<SharedCardView[]> {
  const { user } = await useDatabase()
  if (!payload.cards.length) return []

  // noms + carte logique — base de cartes du jeu (un jeu absent de cette
  // version de l'appli : ids bruts, pas de regroupement)
  const known = gameDefOrNull(payload.game) !== null
  const metaById = known
    ? await cardMetaOf(
        payload.game,
        payload.cards.map((c) => c.id)
      )
    : new Map<string, CardMeta>()

  // ma collection, par carte logique
  const roots = [...new Set(payload.cards.map((c) => metaById.get(c.id)?.root ?? c.id))]
  const variants = known
    ? await variantsOfRoots(payload.game, roots)
    : new Map(roots.map((r) => [r, [r]]))
  const rootOf = new Map<string, string>()
  for (const [root, ids] of variants) for (const id of ids) rootOf.set(id, root)
  const variantIds = [...rootOf.keys()]
  const mineByRoot = new Map<string, number>()
  if (variantIds.length) {
    const vph = variantIds.map(() => '?').join(', ')
    const owned = await user.select<{ card_id: string; n: number }[]>(
      `SELECT card_id, SUM(quantity) AS n FROM collection
       WHERE deleted_at IS NULL AND game = ? AND card_id IN (${vph})
       GROUP BY card_id`,
      [payload.game, ...variantIds]
    )
    for (const o of owned) {
      const root = rootOf.get(o.card_id) ?? o.card_id
      mineByRoot.set(root, (mineByRoot.get(root) ?? 0) + o.n)
    }
  }

  // regroupement des artworks chez l'émetteur
  const groups = new Map<string, SharedCardView & { best: number }>()
  for (const c of payload.cards) {
    const m = metaById.get(c.id)
    const root = m?.root ?? c.id
    const g = groups.get(root) ?? {
      rootId: root,
      displayId: c.id,
      name: m?.name ?? `#${c.id}`,
      qty: 0,
      trade: 0,
      mine: mineByRoot.get(root) ?? 0,
      best: 0,
    }
    g.qty += c.qty
    g.trade += c.trade
    if (c.qty > g.best) {
      g.best = c.qty
      g.displayId = c.id
    }
    groups.set(root, g)
  }
  return [...groups.values()]
    .map(({ best: _best, ...v }) => v)
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ── collections reçues enregistrées ──

export interface SavedShare {
  id: string
  game: string
  owner: string
  cardCount: number
  tradeCount: number
  sharedAt: string
  receivedAt: string
}

// enregistre (ou remplace, pour le même joueur et le même jeu) une collection reçue
export async function saveShare(code: string): Promise<SavedShare> {
  const payload = decodeShare(code)
  const { user } = await useDatabase()
  const saved: SavedShare = {
    id: crypto.randomUUID(),
    game: payload.game,
    owner: payload.owner || 'No name',
    cardCount: payload.cards.reduce((s, c) => s + c.qty, 0),
    tradeCount: payload.cards.reduce((s, c) => s + c.trade, 0),
    sharedAt: new Date(payload.createdAt).toISOString(),
    receivedAt: new Date().toISOString(),
  }
  await user.execute(
    `INSERT INTO shared_collections
       (id, game, owner, code, card_count, trade_count, shared_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(game, owner) DO UPDATE SET
       code = excluded.code, card_count = excluded.card_count,
       trade_count = excluded.trade_count, shared_at = excluded.shared_at,
       received_at = excluded.received_at`,
    [
      saved.id,
      saved.game,
      saved.owner,
      code.trim(),
      saved.cardCount,
      saved.tradeCount,
      saved.sharedAt,
      saved.receivedAt,
    ]
  )
  const rows = await user.select<{ id: string }[]>(
    `SELECT id FROM shared_collections WHERE game = ? AND owner = ?`,
    [saved.game, saved.owner]
  )
  return { ...saved, id: rows[0]?.id ?? saved.id }
}

export async function listSavedShares(): Promise<SavedShare[]> {
  const { user } = await useDatabase()
  const rows = await user.select<
    {
      id: string
      game: string
      owner: string
      card_count: number
      trade_count: number
      shared_at: string
      received_at: string
    }[]
  >(
    `SELECT id, game, owner, card_count, trade_count, shared_at, received_at
     FROM shared_collections ORDER BY received_at DESC`
  )
  return rows.map((r) => ({
    id: r.id,
    game: r.game,
    owner: r.owner,
    cardCount: r.card_count,
    tradeCount: r.trade_count,
    sharedAt: r.shared_at,
    receivedAt: r.received_at,
  }))
}

export async function loadSavedShare(id: string): Promise<SharePayload | null> {
  const { user } = await useDatabase()
  const rows = await user.select<{ code: string }[]>(
    `SELECT code FROM shared_collections WHERE id = ?`,
    [id]
  )
  return rows[0] ? decodeShare(rows[0].code) : null
}

export async function deleteSavedShare(id: string): Promise<void> {
  const { user } = await useDatabase()
  await user.execute(`DELETE FROM shared_collections WHERE id = ?`, [id])
}
