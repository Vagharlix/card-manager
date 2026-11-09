import { useDatabase } from '~/composables/useDatabase'
import { raritiesOf } from './meta'
import type { CardArtwork, CardBadge, CardFact, YgoCardDetail } from './detail'

// ============================================================
// Fiche d'une carte YGO : stats, impressions, artworks (alias).
// ============================================================

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

export async function getYgoDetail(id: string): Promise<YgoCardDetail | null> {
  const ygo = (await useDatabase()).cards('ygo')

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

  const rarities = await raritiesOf(
    'ygo',
    printings.map((p) => p.id)
  )

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
    facts: ygoFacts(r),
    badges: ygoBadges(r),
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


// caractéristiques affichées par la fiche, dans l'ordre
function ygoFacts(r: DetailRow): CardFact[] {
  const facts: [string, string | number | null][] = [
    ['Type', r.type],
    ['Attribute', r.attribute],
    ['Monster type', r.race],
    ['Level', r.level],
    ['Rank', r.rank],
    ['Link', r.link_value],
    ['Pendulum scale', r.pendulum_scale],
    ['ATK', r.atk],
    ['DEF', r.def],
    ['Archetype', r.archetype],
  ]
  return facts
    .filter(([, v]) => v !== null && v !== '')
    .map(([label, v]) => ({ label, value: String(v) }))
}

function ygoBadges(r: DetailRow): CardBadge[] {
  const out: CardBadge[] = []
  if (r.banlist_tcg) out.push({ label: `${r.banlist_tcg} (TCG)`, color: 'error' })
  return out
}
