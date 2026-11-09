// ============================================================
// IMPORT MAGIC — objets Scryfall (fichier « default_cards ») → lignes de
// cards-mtg.db (cf. migrations/mtg/001). Pur : aucune base, aucun réseau.
//
// Une impression papier = une carte (cards.id = uuid Scryfall). Les règles
// (coût, texte, légalités) sont celles de la carte logique (oracle_id) :
// prises sur la première impression vue, identiques pour toutes.
// ============================================================

// clés gardées par le téléchargement (card_data.rs ne renvoie que celles-ci)
export const SCRYFALL_KEYS = [
  'id',
  'oracle_id',
  'name',
  'lang',
  'released_at',
  'layout',
  'mana_cost',
  'cmc',
  'type_line',
  'oracle_text',
  'power',
  'toughness',
  'loyalty',
  'defense',
  'colors',
  'color_identity',
  'keywords',
  'legalities',
  'games',
  'digital',
  'set',
  'set_name',
  'set_type',
  'collector_number',
  'rarity',
  'finishes',
  'artist',
  'illustration_id',
  'card_faces',
  'reserved',
  'promo',
  'variation',
]

interface ScryfallFace {
  name?: string
  mana_cost?: string
  type_line?: string
  oracle_text?: string
  power?: string
  toughness?: string
  loyalty?: string
  defense?: string
  colors?: string[]
  oracle_id?: string
  illustration_id?: string
}

export interface ScryfallCard extends ScryfallFace {
  id: string
  name: string
  lang?: string
  released_at?: string
  layout?: string
  cmc?: number
  color_identity?: string[]
  keywords?: string[]
  legalities?: Record<string, string>
  games?: string[]
  digital?: boolean
  set: string
  set_name: string
  set_type?: string
  collector_number: string
  rarity?: string
  finishes?: string[]
  artist?: string
  card_faces?: ScryfallFace[]
  reserved?: boolean
  promo?: boolean
  variation?: boolean
}

export interface PrintRow {
  id: string
  oracleId: string
  name: string
  setCode: string
  setName: string
  setType: string | null
  collectorNumber: string
  rarity: string | null
  releasedAt: string | null
  lang: string | null
  layout: string | null
  finishes: string
  artist: string | null
  illustrationId: string | null
  typeLine: string | null
  promo: boolean
  variation: boolean
}

export interface OracleRow {
  oracleId: string
  name: string
  manaCost: string | null
  cmc: number | null
  typeLine: string | null
  oracleText: string | null
  power: string | null
  toughness: string | null
  loyalty: string | null
  defense: string | null
  colors: string
  colorIdentity: string
  keywords: string
  reserved: boolean
  deckLimit: number | null
  // formats suivis par le moteur de deck → statut, seulement s'il restreint
  restrictions: Record<string, string>
}

// formats proposés par le moteur de deck (services/deck/mtg.ts)
export const MTG_FORMATS = [
  'standard',
  'pioneer',
  'modern',
  'legacy',
  'vintage',
  'pauper',
  'commander',
] as const

const COLOR_ORDER = 'WUBRG'

function colorLetters(list: string[] | undefined): string {
  const set = new Set(list ?? [])
  return [...COLOR_ORDER].filter((c) => set.has(c)).join('')
}

// texte des faces séparé par « // » (cartes double face, split, aventure)
function joined(c: ScryfallCard, key: 'mana_cost' | 'oracle_text', sep: string): string | null {
  const top = c[key]
  if (top) return top
  const parts = (c.card_faces ?? []).map((f) => f[key]).filter((v): v is string => !!v)
  return parts.length ? parts.join(sep) : top === '' ? '' : null
}

function firstFace(
  c: ScryfallCard,
  key: 'power' | 'toughness' | 'loyalty' | 'defense'
): string | null {
  if (c[key] !== undefined) return c[key] ?? null
  for (const f of c.card_faces ?? []) if (f[key] !== undefined) return f[key] ?? null
  return null
}

const NUMBER_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

// copies max indépendamment du format : terrains de base et cartes qui le
// disent (« A deck can have any number of cards named … », « up to seven »)
export function deckLimitOf(typeLine: string | null, text: string | null): number | null {
  if (typeLine && /\bBasic\b/.test(typeLine.split('—')[0] ?? '')) return -1
  if (!text) return null
  if (/A deck can have any number of cards named/i.test(text)) return -1
  const m = /A deck can have up to (\w+) cards named/i.exec(text)
  if (m) {
    const word = m[1]!.toLowerCase()
    return NUMBER_WORDS[word] ?? (Number(word) || null)
  }
  return null
}

// mises en page écartées : les « Art Series » (illustrations seules, pas des
// cartes jouables) doublonnent chaque nom dans la recherche
const SKIPPED_LAYOUTS = new Set(['art_series'])

// une impression papier → ses lignes ; null = ignorée (numérique seulement,
// Art Series, sans carte logique)
export function mapCard(c: ScryfallCard): { print: PrintRow; oracle: OracleRow } | null {
  if (c.digital || !(c.games ?? []).includes('paper')) return null
  if (SKIPPED_LAYOUTS.has(c.layout ?? '')) return null
  const oracleId = c.oracle_id ?? c.card_faces?.[0]?.oracle_id
  if (!oracleId || !c.id) return null

  const typeLine =
    c.type_line ?? ((c.card_faces ?? []).map((f) => f.type_line).join(' // ') || null)
  const oracleText = joined(c, 'oracle_text', '\n//\n')
  const restrictions: Record<string, string> = {}
  for (const f of MTG_FORMATS) {
    const status = c.legalities?.[f]
    if (status && status !== 'legal') restrictions[f] = status
  }
  const colors = c.colors ?? (c.card_faces ?? []).flatMap((f) => f.colors ?? [])

  return {
    print: {
      id: c.id,
      oracleId,
      name: c.name,
      setCode: c.set,
      setName: c.set_name,
      setType: c.set_type ?? null,
      collectorNumber: c.collector_number,
      rarity: c.rarity ?? null,
      releasedAt: c.released_at ?? null,
      lang: c.lang ?? null,
      layout: c.layout ?? null,
      finishes: (c.finishes ?? []).join(','),
      artist: c.artist ?? null,
      illustrationId: c.illustration_id ?? c.card_faces?.[0]?.illustration_id ?? null,
      typeLine,
      promo: !!c.promo,
      variation: !!c.variation,
    },
    oracle: {
      oracleId,
      name: c.name,
      manaCost: joined(c, 'mana_cost', ' // '),
      cmc: c.cmc ?? null,
      typeLine,
      oracleText,
      power: firstFace(c, 'power'),
      toughness: firstFace(c, 'toughness'),
      loyalty: firstFace(c, 'loyalty'),
      defense: firstFace(c, 'defense'),
      colors: colorLetters(colors),
      colorIdentity: colorLetters(c.color_identity),
      keywords: (c.keywords ?? []).join(', '),
      reserved: !!c.reserved,
      deckLimit: deckLimitOf(typeLine, oracleText),
      restrictions,
    },
  }
}

// extensions « normales » : l'impression montrée par la recherche en vient
const REGULAR_SETS = new Set([
  'expansion',
  'core',
  'masters',
  'draft_innovation',
  'commander',
  'starter',
  'duel_deck',
  'eternal',
])

// clé de tri : la plus grande gagne (extension normale, numéro de collection
// simple — écarte The List « CLB-187 », les promos « 12p » —, pas promo, pas
// variante, en anglais, puis la plus récente)
function printKey(p: PrintRow): string {
  return [
    REGULAR_SETS.has(p.setType ?? '') ? 1 : 0,
    /^\d+$/.test(p.collectorNumber) ? 1 : 0,
    p.promo ? 0 : 1,
    p.variation ? 0 : 1,
    p.lang === 'en' ? 1 : 0,
    p.releasedAt ?? '0000-00-00',
  ].join('|')
}

export function betterPrint(a: PrintRow, b: PrintRow): boolean {
  return printKey(a) > printKey(b)
}

// lignes SQL (ordre des colonnes = celui de sync.ts)
export function printColumns(p: PrintRow): {
  card: unknown[]
  print: unknown[]
  meta: unknown[]
} {
  return {
    card: [p.id, p.name, null, null, null, null],
    print: [
      p.id,
      p.oracleId,
      p.setCode,
      p.setName,
      p.setType,
      p.collectorNumber,
      p.rarity,
      p.releasedAt,
      p.lang,
      p.layout,
      p.finishes,
      p.artist,
      p.illustrationId,
    ],
    meta: [p.id, p.oracleId, p.typeLine],
  }
}

export function oracleColumns(o: OracleRow, defaultPrint: string): unknown[] {
  return [
    o.oracleId,
    o.name,
    defaultPrint,
    o.manaCost,
    o.cmc,
    o.typeLine,
    o.oracleText,
    o.power,
    o.toughness,
    o.loyalty,
    o.defense,
    o.colors,
    o.colorIdentity,
    o.keywords,
    o.reserved ? 1 : 0,
    o.deckLimit,
  ]
}

export function legalityRows(o: OracleRow): unknown[][] {
  const rows: unknown[][] = Object.entries(o.restrictions).map(([f, s]) => [o.oracleId, f, s])
  if (o.deckLimit !== null) rows.push([o.oracleId, 'deck_limit', String(o.deckLimit)])
  return rows
}
