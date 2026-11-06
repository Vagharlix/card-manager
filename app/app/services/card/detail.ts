import { useDatabase } from '~/composables/useDatabase'

// ============================================================
// getCardDetail(game, id)
// Returns the full detail of a card: stats, printings, and all
// alternate artworks (grouped via the alias relationship).
//
// Multi-game ready: dispatches per game like the search router.
// Only YGO implemented for now.
// ============================================================

export interface CardPrinting {
  id: string // set_code e.g. 'LOB-EN005'
  setName: string
  setCode: string
  rarity: string | null
  // toutes les raretés connues pour ce code (un même code peut exister en
  // Super, Ultra, Secret…) ; à défaut, la rareté unique de `printings`
  rarities: string[]
}

export interface CardArtwork {
  id: string // passcode of this specific artwork
  name: string
}

export interface YgoCardDetail {
  game: 'ygo'
  id: string
  name: string
  legalText: string | null
  type: string | null
  attribute: string | null
  race: string | null
  atk: number | null
  def: number | null
  level: number | null
  rank: number | null
  linkValue: number | null
  linkMarkers: string[] | null
  scale: number | null
  archetype: string | null
  banlistTcg: string | null
  banlistOcg: string | null
  printings: CardPrinting[]
  artworks: CardArtwork[] // all arts of this card (incl. itself)
}

interface DetailRow {
  id: string
  name: string
  legal_text: string | null
  type: string | null
  attribute: string | null
  race: string | null
  atk: number | null
  def: number | null
  level: number | null
  rank: number | null
  link_value: number | null
  link_markers: string | null
  pendulum_scale: number | null
  archetype: string | null
  alias: string | null
  banlist_tcg: string | null
  banlist_ocg: string | null
}

async function getYgoDetail(id: string): Promise<YgoCardDetail | null> {
  const { ygo } = await useDatabase()

  // ── 1. main card row ──────────────────────────────────────
  const rows = await ygo.select<DetailRow[]>(
    `SELECT c.id, c.name, c.legal_text,
            d.type, d.attribute, d.race, d.atk, d.def,
            d.level, d.rank, d.link_value, d.link_markers,
            d.pendulum_scale, d.archetype, d.alias,
            d.banlist_tcg, d.banlist_ocg
     FROM cards c
     JOIN ygo_details d ON d.card_id = c.id
     WHERE c.id = ?`,
    [id]
  )
  const r = rows[0]
  if (!r) return null

  // ── 2. printings ──────────────────────────────────────────
  const printings = await ygo.select<
    {
      id: string
      set_name: string
      set_code: string
      rarity: string | null
    }[]
  >(
    `SELECT id, set_name, set_code, rarity
     FROM printings WHERE card_id = ?
     ORDER BY set_name`,
    [id]
  )

  const rarities = await ygoRarities(printings.map((p) => p.id))

  // ── 3. alternate artworks via alias ───────────────────────
  // "root" id = the alias if this card has one, else its own id.
  // All arts share: id == root OR alias == root.
  const root = r.alias ?? r.id
  const artworks = await ygo.select<CardArtwork[]>(
    `SELECT c.id, c.name
     FROM cards c
     JOIN ygo_details d ON d.card_id = c.id
     WHERE c.id = ? OR d.alias = ?
     ORDER BY c.id`,
    [root, root]
  )

  return {
    game: 'ygo',
    id: r.id,
    name: r.name,
    legalText: r.legal_text,
    type: r.type,
    attribute: r.attribute,
    race: r.race,
    atk: r.atk,
    def: r.def,
    level: r.level,
    rank: r.rank,
    linkValue: r.link_value,
    linkMarkers: r.link_markers ? JSON.parse(r.link_markers) : null,
    scale: r.pendulum_scale,
    archetype: r.archetype,
    banlistTcg: r.banlist_tcg,
    banlistOcg: r.banlist_ocg,
    printings: printings.map((p) => ({
      id: p.id,
      setName: p.set_name,
      setCode: p.set_code,
      rarity: p.rarity,
      rarities: rarities.get(p.id) ?? (p.rarity ? [p.rarity] : []),
    })),
    artworks,
  }
}

// raretés par code d'impression (table remplie par la synchro, cf. ygo 002)
async function ygoRarities(codes: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!codes.length) return out
  const { ygo } = await useDatabase()
  const ph = codes.map(() => '?').join(', ')
  const rows = await ygo.select<{ set_code: string; rarity: string }[]>(
    `SELECT set_code, rarity FROM printing_rarities
     WHERE set_code IN (${ph}) ORDER BY rarity`,
    codes
  )
  for (const r of rows) out.set(r.set_code, [...(out.get(r.set_code) ?? []), r.rarity])
  return out
}

// raretés possibles d'une impression (choix après un scan, fiche carte)
export async function printingRarities(game: string, printingId: string): Promise<string[]> {
  if (game !== 'ygo') return []
  const found = (await ygoRarities([printingId])).get(printingId)
  if (found?.length) return found
  const { ygo } = await useDatabase()
  const rows = await ygo.select<{ rarity: string | null }[]>(
    `SELECT rarity FROM printings WHERE id = ?`,
    [printingId]
  )
  return rows[0]?.rarity ? [rows[0].rarity] : []
}

export function getCardDetail(game: string, id: string): Promise<YgoCardDetail | null> {
  if (game === 'ygo') return getYgoDetail(id)
  throw new Error(`No detail provider for game: ${game}`)
}
