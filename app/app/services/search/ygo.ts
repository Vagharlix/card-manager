import { useDatabase } from '../../composables/useDatabase'
import type {
  CardSearchEngine,
  CardSearchResult,
  SearchParams,
  YgoFilters,
  NumericFilter,
} from './types'

// ============================================================
// YGO SEARCH ENGINE
// Builds a dynamic SQL query against cards-ygo.db:
//   - text query  → FTS5 MATCH on name or legal_text
//   - filters      → conditions on ygo_details
// All conditions are optional and combined with AND.
// ============================================================

// Allowed numeric operators — whitelist to avoid any SQL injection
// via the operator string (values always go through bound params).
const NUMERIC_OPS = new Set(['=', '<', '>', '<=', '>='])

function numericCondition(column: string, filter: NumericFilter, params: unknown[]): string | null {
  if (!NUMERIC_OPS.has(filter.op)) return null
  params.push(filter.value)
  return `d.${column} ${filter.op} ?`
}

async function search(p: SearchParams): Promise<CardSearchResult[]> {
  const { ygo } = await useDatabase()
  const f = (p.filters ?? {}) as YgoFilters
  const field = p.field ?? 'name'
  const limit = p.limit ?? 50

  const conditions: string[] = []
  const params: unknown[] = []

  // ── text query via FTS5 ───────────────────────────────────
  // We use a subquery on cards_fts to get matching rowids,
  // then join. Column targeted depends on the field selector.
  let ftsJoin = ''
  let orderBy = 'c.name COLLATE NOCASE ASC'

  if (p.query && p.query.trim()) {
    const col = field === 'effect' ? 'legal_text' : 'name'
    // FTS5 column filter syntax: {col} : query
    params.push(`${col} : ${p.query.trim()}*`)
    ftsJoin = `JOIN cards_fts ON cards_fts.rowid = c.rowid AND cards_fts MATCH ?`
    orderBy = 'cards_fts.rank'
  }

  // ── category (Monster / Spell / Trap) ─────────────────────
  if (f.category) {
    params.push(`%${f.category}%`)
    conditions.push(`d.type LIKE ?`)
  }

  // ── monster subtypes (Synchro, Tuner...) combined as OR ───
  if (f.monsterTypes?.length) {
    const ors = f.monsterTypes.map((t) => {
      params.push(`%${t}%`)
      return `d.type LIKE ?`
    })
    conditions.push(`(${ors.join(' OR ')})`)
  }

  // ── spell/trap subtypes (Quick-Play, Continuous...) ───────
  if (f.spellTrapTypes?.length) {
    const ors = f.spellTrapTypes.map((t) => {
      params.push(`%${t}%`)
      return `d.type LIKE ?`
    })
    conditions.push(`(${ors.join(' OR ')})`)
  }

  // ── exact-match string filters ────────────────────────────
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

  // ── numeric filters with operators ────────────────────────
  const numerics: [keyof YgoFilters, string][] = [
    ['level', 'level'],
    ['atk', 'atk'],
    ['def', 'def'],
    ['scale', 'pendulum_scale'],
    ['linkRating', 'link_value'],
  ]
  for (const [key, column] of numerics) {
    const nf = f[key] as NumericFilter | undefined
    if (nf) {
      const cond = numericCondition(column, nf, params)
      if (cond) conditions.push(cond)
    }
  }

  // ── link markers (stored as JSON array string) ────────────
  if (f.linkMarkers?.length) {
    const ors = f.linkMarkers.map((m) => {
      params.push(`%"${m}"%`)
      return `d.link_markers LIKE ?`
    })
    conditions.push(`(${ors.join(' AND ')})`) // AND = must have all selected markers
  }

  // ── assemble ──────────────────────────────────────────────
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const offset = (p as any).offset ?? 0

  params.push(limit)
  params.push(offset)

  const sql = `
    SELECT c.id, c.name, c.image_url_small AS imageUrl
    FROM cards c
    JOIN ygo_details d ON d.card_id = c.id
    ${ftsJoin}
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
    `

  const rows = await ygo.select<{ id: string; name: string; imageUrl: string }[]>(sql, params)

  return rows.map((r) => ({
    game: 'ygo',
    id: r.id,
    name: r.name,
    imageUrl: r.imageUrl,
  }))
}

export const ygoSearchEngine: CardSearchEngine = { search }
