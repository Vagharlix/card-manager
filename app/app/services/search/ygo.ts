import { useDatabase } from '~/composables/useDatabase'
import type {
  CardSearchEngine,
  CardSearchResult,
  SearchParams,
  YgoFilters,
  NumericFilter,
} from './types'

// ============================================================
// YGO SEARCH ENGINE
// search() and count() share the same WHERE/JOIN builder so the
// two queries can never diverge. Adding a filter = one place.
// ============================================================

const NUMERIC_OPS = new Set(['=', '<', '>', '<=', '>='])

interface QueryParts {
  ftsJoin: string
  where: string
  params: unknown[]
  hasFts: boolean
}

// Builds the JOIN + WHERE + bound params from the search request.
// Shared by both search() and count().
function buildQuery(p: SearchParams): QueryParts {
  const f = (p.filters ?? {}) as YgoFilters
  const field = p.field ?? 'name'

  const conditions: string[] = []
  const params: unknown[] = []
  let ftsJoin = ''
  let hasFts = false

  // ── text query via FTS5 ───────────────────────────────────
  if (p.query && p.query.trim()) {
    const col = field === 'effect' ? 'legal_text' : 'name'
    params.push(`${col} : ${p.query.trim()}*`)
    ftsJoin = `JOIN cards_fts ON cards_fts.rowid = c.rowid AND cards_fts MATCH ?`
    hasFts = true
  }

  // ── category ──────────────────────────────────────────────
  if (f.category) {
    params.push(`%${f.category}%`)
    conditions.push(`d.type LIKE ?`)
  }

  // ── monster subtypes (OR) ─────────────────────────────────
  if (f.monsterTypes?.length) {
    const ors = f.monsterTypes.map((t) => {
      params.push(`%${t}%`)
      return `d.type LIKE ?`
    })
    conditions.push(`(${ors.join(' OR ')})`)
  }

  // ── spell/trap subtypes (OR) ──────────────────────────────
  if (f.spellTrapTypes?.length) {
    const ors = f.spellTrapTypes.map((t) => {
      params.push(`%${t}%`)
      return `d.type LIKE ?`
    })
    conditions.push(`(${ors.join(' OR ')})`)
  }

  // ── exact-match strings ───────────────────────────────────
  if (f.attribute) {
    params.push(f.attribute)
    conditions.push(`d.attribute = ?`)
  }
  if (f.race) {
    params.push(f.race)
    conditions.push(`d.race = ?`)
  }
  if (f.archetype) {
    params.push(f.archetype)
    conditions.push(`d.archetype = ?`)
  }
  if (f.banlist) {
    params.push(f.banlist)
    conditions.push(`d.banlist_tcg = ?`)
  }

  // ── numeric filters ───────────────────────────────────────
  const numerics: [keyof YgoFilters, string][] = [
    ['level', 'level'],
    ['atk', 'atk'],
    ['def', 'def'],
    ['scale', 'pendulum_scale'],
    ['linkRating', 'link_value'],
  ]
  for (const [key, column] of numerics) {
    const nf = f[key] as NumericFilter | undefined
    if (nf && NUMERIC_OPS.has(nf.op)) {
      params.push(nf.value)
      conditions.push(`d.${column} ${nf.op} ?`)
    }
  }

  // ── link markers (must have all selected) ─────────────────
  if (f.linkMarkers?.length) {
    const ands = f.linkMarkers.map((m) => {
      params.push(`%"${m}"%`)
      return `d.link_markers LIKE ?`
    })
    conditions.push(`(${ands.join(' AND ')})`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return { ftsJoin, where, params, hasFts }
}

// ── search: returns a page of results ───────────────────────
async function search(p: SearchParams): Promise<CardSearchResult[]> {
  const ygo = (await useDatabase()).cards('ygo')
  const { ftsJoin, where, params, hasFts } = buildQuery(p)

  const limit = p.limit ?? 48
  const offset = p.offset ?? 0
  const orderBy = hasFts ? 'cards_fts.rank' : 'c.name COLLATE NOCASE ASC'

  const sql = `
    SELECT c.id, c.name, c.image_url_small AS imageUrl
    FROM cards c
    JOIN ygo_details d ON d.card_id = c.id
    ${ftsJoin}
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `
  const rows = await ygo.select<{ id: string; name: string; imageUrl: string }[]>(sql, [
    ...params,
    limit,
    offset,
  ])

  return rows.map((r) => ({ game: 'ygo', id: r.id, name: r.name, imageUrl: r.imageUrl }))
}

// ── count: total matching cards (for pagination) ────────────
async function count(p: SearchParams): Promise<number> {
  const ygo = (await useDatabase()).cards('ygo')
  const { ftsJoin, where, params } = buildQuery(p)

  const sql = `
    SELECT COUNT(*) AS n
    FROM cards c
    JOIN ygo_details d ON d.card_id = c.id
    ${ftsJoin}
    ${where}
  `
  const rows = await ygo.select<{ n: number }[]>(sql, params)
  return rows[0]?.n ?? 0
}

export const ygoSearchEngine: CardSearchEngine = { search, count }

// ============================================================
// FILTER OPTIONS
// Derives the available filter values from the lookup tables
// (and the type column for atomic subtypes), so the UI is always
// in sync with the actual synced data.
// ============================================================

// Known atomic subtype keywords (stable, rarely changes).
// We only surface the ones that actually appear in the data.
const MONSTER_SUBTYPE_KEYWORDS = [
  'Normal',
  'Effect',
  'Fusion',
  'Synchro',
  'Xyz',
  'Link',
  'Pendulum',
  'Ritual',
  'Tuner',
  'Flip',
  'Toon',
  'Spirit',
  'Union',
  'Gemini',
]
const SPELLTRAP_SUBTYPE_KEYWORDS = [
  'Normal',
  'Continuous',
  'Quick-Play',
  'Field',
  'Equip',
  'Ritual',
  'Counter',
]

export interface YgoFilterOptions {
  attributes: string[]
  races: string[]
  archetypes: string[]
  monsterTypes: string[]
  spellTrapTypes: string[]
}

export async function getYgoFilterOptions(): Promise<YgoFilterOptions> {
  const ygo = (await useDatabase()).cards('ygo')

  // simple lookups
  const attributes = await ygo.select<{ value: string }[]>(
    `SELECT value FROM card_attributes ORDER BY value`
  )
  const races = await ygo.select<{ value: string }[]>(`SELECT value FROM card_races ORDER BY value`)
  const archetypes = await ygo.select<{ archetype: string }[]>(
    `SELECT DISTINCT archetype FROM ygo_details
     WHERE archetype IS NOT NULL ORDER BY archetype`
  )

  // derive which atomic subtypes actually appear in the type column
  const allTypes = await ygo.select<{ value: string }[]>(`SELECT value FROM card_types`)
  // insensible à la casse : la donnée écrit « XYZ Monster » (le filtre SQL
  // LIKE l'est aussi pour l'ASCII)
  const typeBlob = allTypes
    .map((t) => t.value)
    .join(' | ')
    .toLowerCase()
  const present = (kw: string) => typeBlob.includes(kw.toLowerCase())

  const monsterTypes = MONSTER_SUBTYPE_KEYWORDS.filter(present)
  const spellTrapTypes = SPELLTRAP_SUBTYPE_KEYWORDS.filter(present)

  return {
    attributes: attributes.map((r) => r.value),
    races: races.map((r) => r.value),
    archetypes: archetypes.map((r) => r.archetype),
    monsterTypes,
    spellTrapTypes,
  }
}

