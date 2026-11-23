import { hashString } from '~/utils/hash'

// ============================================================
// IMPORT RIFTBOUND (pur, sans base) — données de RiftHunt
// (api.rifthunt.com, gratuit, sans clé, « fan content » autorisé par Riot) :
//  - /bulk/cards : toutes les impressions (1 requête, ~2 Mo), avec ce que
//    seul ce fichier donne : supertype (Champion, Signature, Token, Basic),
//    étiquettes de Riot, dates de sortie des extensions ;
//  - /cards/search?unique=prints (pages de 175) : l'objet « carte » de chaque
//    impression, avec ce que le fichier n'a pas : numéro imprimé (« 299s »,
//    « r01 »), mots-clés, légalités, images (images.rifthunt.com, WebP).
// Les deux se joignent sur l'uuid de l'impression (printing_id).
// Une carte = une impression ; carte logique = oracle_id.
// ============================================================

export interface RiftHuntSet {
  id: string // 'OGN'
  name: string
  count: number
  released: string | null // '2025-10-31'
}

export interface RiftHuntBulkCard {
  printing_id: string
  oracle_id: string
  variant: string | null // base | alternate | overnumbered | signature | showcase | null
  riftboundId: string | null // 'ogn-001-298', 'ogn-299*-298', 'rad-r01', 'tcg:662914'
  name: string // nom imprimé (« … (Alternate Art) »)
  cleanName: string
  energy: number | null
  might: number | null
  power: number | null
  type: string // Unit | Spell | Gear | Legend | Battlefield | Rune
  supertype: string | null // Champion | Signature | Token | Basic | null
  rarity: string | null
  domains: string[] | null // ['Fury', 'Mind'], ['Colorless']
  text: string | null
  flavour: string | null
  set: string // 'OGN'
  setName: string
  tags: string[] | null
  artist: string | null
  orientation?: string | null
  finishes?: string[] | null
}

export interface RiftHuntBulk {
  fetched: string // date d'ingestion du catalogue
  sets: RiftHuntSet[]
  cards: RiftHuntBulkCard[]
}

export interface RiftHuntLegality {
  status: string // legal | banned | not_legal
  banned_from: string | null
}

// objet « carte » de l'API (seuls les champs lus ici)
export interface RiftHuntCard {
  id: string // = printing_id
  oracle_id: string
  collector_number?: string | null
  keywords?: string[] | null
  legalities?: Record<string, RiftHuntLegality> | null
  images?: { small?: string | null; normal?: string | null } | null
}

export const RB_DOMAINS = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'] as const
export const RB_TYPES = ['Unit', 'Spell', 'Gear', 'Legend', 'Battlefield', 'Rune'] as const
export const RB_FORMATS = ['standard', '2v2'] as const

// préfixe commun des images RiftHunt : seul le reste (« indice ») est
// gardé, et Rust refait l'adresse (card_sources.rs, image_source)
const IMAGE_PREFIX = 'https://images.rifthunt.com/cards/small/front/'
const SAFE_HINT = /^[a-z0-9\-_./?=]{1,200}$/

export function imageHint(url: string | null | undefined): string | null {
  if (!url?.startsWith(IMAGE_PREFIX)) return null
  const hint = url.slice(IMAGE_PREFIX.length)
  if (!SAFE_HINT.test(hint) || hint.includes('..') || hint.includes('//')) return null
  return hint
}

// numéro imprimé d'après l'id de Riot quand l'API ne le donne pas
// (« ogn-007a-298 » → « 007a », « ogn-299*-298 » → « 299s », « rad-r01 » → « r01 »)
export function collectorFromRiotId(id: string | null | undefined): string {
  const m = /^[a-z0-9]+-([0-9a-z*]+)(?:-\d+)?$/i.exec(id ?? '')
  return m ? m[1]!.toLowerCase().replace(/\*/g, 's') : ''
}

export interface OracleRow {
  oracle_id: string
  name: string
  type: string
  supertype: string | null
  domains: string // 'Fury,Mind' ; '' = incolore
  energy: number | null
  power: number | null
  might: number | null
  tags: string // 'Jinx, Zaun'
  keywords: string // 'accelerate, deflect'
  text: string | null
}

export interface PrintRow {
  id: string
  oracle_id: string
  name: string // nom de la carte logique
  set_code: string // 'ogn'
  set_name: string
  collector_number: string
  riftbound_id: string | null
  rarity: string | null
  variant: string | null
  printed_name: string
  artist: string | null
  flavour: string | null
  finishes: string | null
  released_at: string | null
  orientation: string | null
  image: string | null // indice d'image (cf. imageHint)
  text: string | null
  meta_type: string // « Champion Unit », « Basic Rune » (card_meta.type)
}

export interface LegalityRow {
  oracle_id: string
  format: string
  status: string
  since: string | null
}

export interface RiftboundData {
  version: string
  oracles: Map<string, OracleRow>
  prints: PrintRow[]
  defaults: Map<string, string> // oracle_id → impression par défaut
  legality: LegalityRow[]
}

const domainsOf = (list: string[] | null | undefined) =>
  (list ?? []).filter((d) => d && d !== 'Colorless').join(',')

// rang d'une impression pour le choix de l'impression par défaut
// (plus petit = meilleur) : la « base » d'abord (RiftHunt en marque une par
// carte), sinon pas une promo, pas une variante, la plus ancienne
function printRank(p: PrintRow): string {
  return [
    p.variant === 'base' ? 0 : 1,
    p.rarity === 'Promo' ? 1 : 0,
    p.variant ? 1 : 0,
    p.released_at ?? '9999',
    p.set_code,
    p.collector_number.padStart(6, '0'),
    p.id,
  ].join('|')
}

export function mapRiftbound(bulk: RiftHuntBulk, objects: Iterable<RiftHuntCard>): RiftboundData {
  const extra = new Map<string, RiftHuntCard>()
  for (const o of objects) extra.set(o.id, o)
  const released = new Map(bulk.sets.map((s) => [s.id.toLowerCase(), s.released ?? null]))

  const oracles = new Map<string, OracleRow>()
  const prints: PrintRow[] = []
  const legality = new Map<string, LegalityRow>()
  for (const c of bulk.cards) {
    if (!c.printing_id || !c.oracle_id || !c.type) continue
    const api = extra.get(c.printing_id)
    const name = c.cleanName || c.name
    if (!oracles.has(c.oracle_id)) {
      oracles.set(c.oracle_id, {
        oracle_id: c.oracle_id,
        name,
        type: c.type,
        supertype: c.supertype ?? null,
        domains: domainsOf(c.domains),
        energy: c.energy ?? null,
        power: c.power ?? null,
        might: c.might ?? null,
        tags: (c.tags ?? []).join(', '),
        keywords: (api?.keywords ?? []).join(', '),
        text: c.text ?? null,
      })
    } else if (api?.keywords?.length && !oracles.get(c.oracle_id)!.keywords) {
      oracles.get(c.oracle_id)!.keywords = api.keywords.join(', ')
    }
    const set = c.set.toLowerCase()
    prints.push({
      id: c.printing_id,
      oracle_id: c.oracle_id,
      name,
      set_code: set,
      set_name: c.setName,
      collector_number: api?.collector_number || collectorFromRiotId(c.riftboundId),
      riftbound_id: c.riftboundId ?? null,
      rarity: c.rarity ?? null,
      variant: c.variant ?? null,
      printed_name: c.name,
      artist: c.artist ?? null,
      flavour: c.flavour ?? null,
      finishes: c.finishes?.length ? c.finishes.join(',') : null,
      released_at: released.get(set) ?? null,
      orientation: c.orientation ?? (c.type === 'Battlefield' ? 'landscape' : 'portrait'),
      image: imageHint(api?.images?.small),
      text: c.text ?? null,
      meta_type: [c.supertype, c.type].filter(Boolean).join(' '),
    })
    for (const [format, l] of Object.entries(api?.legalities ?? {})) {
      if (!l || (l.status === 'legal' && !l.banned_from)) continue
      const key = `${c.oracle_id}|${format}`
      if (!legality.has(key))
        legality.set(key, {
          oracle_id: c.oracle_id,
          format,
          status: l.status,
          since: l.banned_from ?? null,
        })
    }
  }

  const defaults = new Map<string, { id: string; rank: string }>()
  for (const p of prints) {
    const rank = printRank(p)
    const cur = defaults.get(p.oracle_id)
    if (!cur || rank < cur.rank) defaults.set(p.oracle_id, { id: p.id, rank })
  }
  return {
    version: bulk.fetched,
    oracles,
    prints,
    defaults: new Map([...defaults].map(([k, v]) => [k, v.id])),
    legality: [...legality.values()],
  }
}

// statuts de bannissement (recherche « banned:any » / « banned:upcoming ») →
// lignes de rb_legality (sans les « not_legal » des jetons, qui ne bougent pas)
export function banRows(cards: Iterable<RiftHuntCard>): LegalityRow[] {
  const out = new Map<string, LegalityRow>()
  for (const c of cards) {
    for (const [format, l] of Object.entries(c.legalities ?? {})) {
      if (!l || l.status === 'not_legal' || (l.status === 'legal' && !l.banned_from)) continue
      out.set(`${c.oracle_id}|${format}`, {
        oracle_id: c.oracle_id,
        format,
        status: l.status,
        since: l.banned_from ?? null,
      })
    }
  }
  return [...out.values()]
}

// empreinte de tout ce qui est écrit pour une impression (carte logique
// comprise : un errata réécrit ses impressions)
export function printHash(p: PrintRow, o: OracleRow | undefined, isDefault: boolean): string {
  return hashString(JSON.stringify([p, o ?? null, isDefault]))
}

// ── colonnes écrites (sync.ts) ──────────────────────────────

export const CARD_COLS = ['id', 'name', 'image_url', 'image_url_small', 'image_url_cropped', 'legal_text']
export const PRINT_COLS = [
  'card_id',
  'oracle_id',
  'set_code',
  'set_name',
  'collector_number',
  'riftbound_id',
  'rarity',
  'variant',
  'printed_name',
  'artist',
  'flavour',
  'finishes',
  'released_at',
  'orientation',
]
export const ORACLE_COLS = [
  'oracle_id',
  'name',
  'default_print',
  'type',
  'supertype',
  'domains',
  'energy',
  'power',
  'might',
  'tags',
  'keywords',
  'text',
]

export function cardColumns(p: PrintRow): unknown[] {
  return [p.id, p.name, p.image, p.image, null, p.text]
}

export function printColumns(p: PrintRow): unknown[] {
  return [
    p.id,
    p.oracle_id,
    p.set_code,
    p.set_name,
    p.collector_number,
    p.riftbound_id,
    p.rarity,
    p.variant,
    p.printed_name,
    p.artist,
    p.flavour,
    p.finishes,
    p.released_at,
    p.orientation,
  ]
}

export function oracleColumns(o: OracleRow, defaultPrint: string): unknown[] {
  return [
    o.oracle_id,
    o.name,
    defaultPrint,
    o.type,
    o.supertype,
    o.domains,
    o.energy,
    o.power,
    o.might,
    o.tags,
    o.keywords,
    o.text,
  ]
}
