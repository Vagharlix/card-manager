import { useDatabase } from '~/composables/useDatabase'
import type { CardBadge, CardDetail, CardFact, CardPrinting } from './detail'

// ============================================================
// Fiche d'une carte Magic : l'impression affichée + toutes les impressions
// de la même carte logique (chacune est une carte : CardPrinting.cardId),
// les règles (oracle) et les restrictions des principaux formats.
// ============================================================

interface Row {
  card_id: string
  oracle_id: string
  name: string
  set_code: string
  set_name: string
  collector_number: string
  rarity: string | null
  released_at: string | null
  artist: string | null
  mana_cost: string | null
  type_line: string | null
  oracle_text: string | null
  power: string | null
  toughness: string | null
  loyalty: string | null
  defense: string | null
  reserved: number
}

const FORMAT_LABELS: Record<string, string> = {
  standard: 'Standard',
  pioneer: 'Pioneer',
  modern: 'Modern',
  legacy: 'Legacy',
  vintage: 'Vintage',
  pauper: 'Pauper',
  commander: 'Commander',
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function mtgPrintCode(set: string, number: string): string {
  return `${set.toUpperCase()} #${number}`
}

export async function getMtgDetail(id: string): Promise<CardDetail | null> {
  const db = (await useDatabase()).cards('mtg')
  const rows = await db.select<Row[]>(
    `SELECT p.card_id, p.oracle_id, o.name, p.set_code, p.set_name, p.collector_number,
            p.rarity, p.released_at, p.artist, o.mana_cost, o.type_line, o.oracle_text,
            o.power, o.toughness, o.loyalty, o.defense, o.reserved
     FROM mtg_prints p JOIN mtg_oracle o ON o.oracle_id = p.oracle_id
     WHERE p.card_id = ?`,
    [id]
  )
  const r = rows[0]
  if (!r) return null

  const prints = await db.select<
    {
      card_id: string
      set_code: string
      set_name: string
      collector_number: string
      rarity: string | null
    }[]
  >(
    `SELECT card_id, set_code, set_name, collector_number, rarity FROM mtg_prints
     WHERE oracle_id = ? ORDER BY released_at DESC, set_code, collector_number`,
    [r.oracle_id]
  )
  const printings: CardPrinting[] = prints.map((p) => ({
    id: p.card_id,
    cardId: p.card_id,
    setName: p.set_name,
    setCode: mtgPrintCode(p.set_code, p.collector_number),
    rarity: p.rarity,
    rarities: p.rarity ? [p.rarity] : [],
  }))

  const restrictions = await db.select<{ format: string; status: string }[]>(
    `SELECT format, status FROM card_legality WHERE card_id = ? AND format != 'deck_limit'`,
    [r.oracle_id]
  )

  return {
    game: 'mtg',
    id: r.card_id,
    name: r.name,
    legalText: r.oracle_text,
    facts: mtgFacts(r),
    badges: mtgBadges(r, restrictions),
    printings,
    artworks: [],
  }
}

function mtgFacts(r: Row): CardFact[] {
  const pt =
    r.power !== null || r.toughness !== null ? `${r.power ?? '?'}/${r.toughness ?? '?'}` : null
  const facts: [string, string | null][] = [
    ['Mana cost', r.mana_cost || null],
    ['Type', r.type_line],
    ['Power/Toughness', pt],
    ['Loyalty', r.loyalty],
    ['Defense', r.defense],
    ['Set', `${r.set_name} (${mtgPrintCode(r.set_code, r.collector_number)})`],
    ['Rarity', r.rarity ? cap(r.rarity) : null],
    ['Released', r.released_at],
    ['Artist', r.artist],
  ]
  return facts.filter(([, v]) => v).map(([label, value]) => ({ label, value: value! }))
}

function mtgBadges(r: Row, restrictions: { format: string; status: string }[]): CardBadge[] {
  const out: CardBadge[] = []
  for (const { format, status } of restrictions) {
    const label = FORMAT_LABELS[format]
    if (!label) continue
    if (status === 'banned') out.push({ label: `Banned in ${label}`, color: 'error' })
    if (status === 'restricted') out.push({ label: `Restricted in ${label}`, color: 'warning' })
  }
  if (r.reserved) out.push({ label: 'Reserved List', color: 'neutral' })
  return out
}
