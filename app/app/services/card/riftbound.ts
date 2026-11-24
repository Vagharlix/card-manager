import { useDatabase } from '~/composables/useDatabase'
import type { CardBadge, CardDetail, CardFact, CardPrinting } from './detail'

// ============================================================
// Fiche d'une carte Riftbound : l'impression affichée + toutes les
// impressions de la même carte logique (chacune est une carte :
// CardPrinting.cardId), les caractéristiques et les bannissements.
// Le texte garde les symboles de RiftHunt (« :rb_energy_1: »), rendus
// lisibles ici (« [1] », « [Fury] »…).
// ============================================================

interface Row {
  card_id: string
  oracle_id: string
  name: string
  printed_name: string
  set_code: string
  set_name: string
  collector_number: string
  rarity: string | null
  variant: string | null
  released_at: string | null
  artist: string | null
  flavour: string | null
  type: string
  orientation: string | null
  supertype: string | null
  domains: string
  energy: number | null
  power: number | null
  might: number | null
  tags: string
  keywords: string
  text: string | null
}

const FORMAT_LABELS: Record<string, string> = { standard: 'Standard', '2v2': '2v2' }

const VARIANT_LABELS: Record<string, string> = {
  alternate: 'Alternate Art',
  overnumbered: 'Overnumbered',
  signature: 'Signature',
  showcase: 'Showcase',
}

export function rbPrintCode(set: string, number: string): string {
  return number ? `${set.toUpperCase()} #${number}` : set.toUpperCase()
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// « :rb_energy_2: » → « [2] », « :rb_rune_fury: » → « [Fury] », « :rb_might: » → « [Might] »
export function readableText(text: string | null): string | null {
  if (!text) return text
  return text.replace(/:rb_([a-z0-9_]+):/g, (_, code: string) => {
    const energy = /^energy_(\d+)$/.exec(code)
    if (energy) return `[${energy[1]}]`
    const rune = /^rune_([a-z]+)$/.exec(code)
    if (rune) return `[${rune[1] === 'rainbow' ? 'Any rune' : cap(rune[1]!)}]`
    return `[${code.split('_').map(cap).join(' ')}]`
  })
}

// libellé d'une impression dans le choix d'impression : extension + variante
function setLabel(p: { set_name: string; variant: string | null; printed_name: string; name: string }) {
  const variant = p.variant && VARIANT_LABELS[p.variant]
  // « (Metal) », « (K/DA Special Art Card) »… : suffixe du nom imprimé
  const suffix =
    !variant && p.printed_name !== p.name ? /\(([^)]+)\)\s*$/.exec(p.printed_name)?.[1] : null
  const extra = variant ?? suffix
  return extra ? `${p.set_name} · ${extra}` : p.set_name
}

export async function getRiftboundDetail(id: string): Promise<CardDetail | null> {
  const db = (await useDatabase()).cards('riftbound')
  const rows = await db.select<Row[]>(
    `SELECT p.card_id, p.oracle_id, o.name, p.printed_name, p.set_code, p.set_name,
            p.collector_number, p.rarity, p.variant, p.released_at, p.artist, p.flavour, p.orientation,
            o.type, o.supertype, o.domains, o.energy, o.power, o.might, o.tags, o.keywords, o.text
     FROM rb_prints p JOIN rb_cards o ON o.oracle_id = p.oracle_id
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
      variant: string | null
      printed_name: string
    }[]
  >(
    `SELECT card_id, set_code, set_name, collector_number, rarity, variant, printed_name
     FROM rb_prints WHERE oracle_id = ?
     ORDER BY released_at, set_code, collector_number, card_id`,
    [r.oracle_id]
  )
  const printings: CardPrinting[] = prints.map((p) => ({
    id: p.card_id,
    cardId: p.card_id,
    setName: setLabel({ ...p, name: r.name }),
    setCode: rbPrintCode(p.set_code, p.collector_number),
    rarity: p.rarity,
    rarities: p.rarity ? [p.rarity] : [],
  }))

  const restrictions = await db.select<{ format: string; status: string }[]>(
    `SELECT format, status FROM card_legality WHERE card_id = ? AND format != 'deck_limit'`,
    [r.oracle_id]
  )
  const upcoming = await db.select<{ format: string; since: string }[]>(
    `SELECT format, since FROM rb_legality
     WHERE oracle_id = ? AND status = 'legal' AND since > date('now')`,
    [r.oracle_id]
  )

  return {
    game: 'riftbound',
    id: r.card_id,
    name: r.printed_name || r.name,
    legalText: readableText(r.text),
    facts: riftboundFacts(r),
    badges: riftboundBadges(restrictions, upcoming),
    printings,
    artworks: [],
    landscape: r.orientation === 'landscape' || r.type === 'Battlefield',
  }
}

function riftboundFacts(r: Row): CardFact[] {
  const facts: [string, string | null][] = [
    ['Type', [r.supertype, r.type].filter(Boolean).join(' ')],
    ['Domains', r.domains ? r.domains.split(',').join(', ') : 'Colorless'],
    ['Energy', r.energy === null ? null : String(r.energy)],
    ['Power', r.power === null ? null : String(r.power)],
    ['Might', r.might === null ? null : String(r.might)],
    ['Tags', r.tags || null],
    ['Keywords', r.keywords ? r.keywords.split(', ').map(cap).join(', ') : null],
    ['Set', `${r.set_name} (${rbPrintCode(r.set_code, r.collector_number)})`],
    ['Rarity', r.rarity],
    ['Variant', r.variant && r.variant !== 'base' ? (VARIANT_LABELS[r.variant] ?? cap(r.variant)) : null],
    ['Released', r.released_at],
    ['Artist', r.artist],
  ]
  return facts.filter(([, v]) => v).map(([label, value]) => ({ label, value: value! }))
}

function riftboundBadges(
  restrictions: { format: string; status: string }[],
  upcoming: { format: string; since: string }[]
): CardBadge[] {
  const out: CardBadge[] = []
  for (const { format, status } of restrictions) {
    const label = FORMAT_LABELS[format] ?? format
    if (status === 'banned') out.push({ label: `Banned in ${label}`, color: 'error' })
  }
  if (restrictions.some((x) => x.status === 'not_legal'))
    out.push({ label: 'Token (not a deck card)', color: 'neutral' })
  for (const { format, since } of upcoming)
    out.push({ label: `Banned in ${FORMAT_LABELS[format] ?? format} from ${since}`, color: 'warning' })
  return out
}
