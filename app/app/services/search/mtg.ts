import { useDatabase } from '~/composables/useDatabase'
import type { CardSearchEngine, CardSearchResult, NumericFilter, SearchParams } from './types'

// ============================================================
// RECHERCHE MAGIC — une ligne par carte logique (mtg_oracle), montrée
// avec son impression par défaut. Texte via FTS5 (nom ou texte de règles),
// filtres sur couleurs, types, valeur de mana, légalité dans un format.
// ============================================================

export interface MtgFilters {
  colors?: string[] // lettres WUBRG : la carte a toutes ces couleurs
  colorless?: boolean
  types?: string[] // 'Creature', 'Instant'… (OU)
  cmc?: NumericFilter
  format?: string // légale dans ce format
}

export const MTG_TYPES = [
  'Creature',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Planeswalker',
  'Land',
  'Battle',
  'Legendary',
]

const NUMERIC_OPS = new Set(['=', '<', '>', '<=', '>='])

// texte libre → requête FTS5 sûre : chaque mot entre guillemets, en préfixe
// (« light bol » trouve Lightning Bolt ; apostrophes, virgules ignorées)
export function ftsQuery(text: string, column: 'name' | 'oracle_text'): string | null {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu)
  if (!words?.length) return null
  return words.map((w) => `${column} : "${w}"*`).join(' AND ')
}

function buildQuery(p: SearchParams) {
  const f = (p.filters ?? {}) as MtgFilters
  const conditions: string[] = []
  const params: unknown[] = []
  let ftsJoin = ''

  const match = p.query ? ftsQuery(p.query, p.field === 'effect' ? 'oracle_text' : 'name') : null
  if (match) {
    ftsJoin = `JOIN mtg_oracle_fts ON mtg_oracle_fts.rowid = o.rowid AND mtg_oracle_fts MATCH ?`
    params.push(match)
  }
  for (const c of f.colors ?? []) {
    if (!/^[WUBRG]$/.test(c)) continue
    conditions.push(`o.colors LIKE ?`)
    params.push(`%${c}%`)
  }
  if (f.colorless) conditions.push(`o.colors = ''`)
  if (f.types?.length) {
    conditions.push(`(${f.types.map(() => `o.type_line LIKE ?`).join(' OR ')})`)
    params.push(...f.types.map((t) => `%${t}%`))
  }
  if (f.cmc && NUMERIC_OPS.has(f.cmc.op) && Number.isFinite(f.cmc.value)) {
    conditions.push(`o.cmc ${f.cmc.op} ?`)
    params.push(f.cmc.value)
  }
  if (f.format) {
    conditions.push(`NOT EXISTS (SELECT 1 FROM card_legality l
      WHERE l.card_id = o.oracle_id AND l.format = ? AND l.status IN ('banned', 'not_legal'))`)
    params.push(f.format)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return { ftsJoin, where, params, ranked: !!match, exact: (p.query ?? '').trim() }
}

async function search(p: SearchParams): Promise<CardSearchResult[]> {
  const db = (await useDatabase()).cards('mtg')
  const { ftsJoin, where, params, ranked, exact } = buildQuery(p)
  // nom exact d'abord (« Lightning Bolt » avant « Lightning Bolt // … »)
  const order = ranked
    ? `(o.name = ? COLLATE NOCASE) DESC, mtg_oracle_fts.rank, o.name COLLATE NOCASE`
    : `o.name COLLATE NOCASE`
  const rows = await db.select<{ id: string; name: string }[]>(
    `SELECT o.default_print AS id, o.name FROM mtg_oracle o ${ftsJoin} ${where}
     ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, ...(ranked ? [exact] : []), p.limit ?? 48, p.offset ?? 0]
  )
  return rows.map((r) => ({ game: 'mtg', id: r.id, name: r.name, imageUrl: '' }))
}

async function count(p: SearchParams): Promise<number> {
  const db = (await useDatabase()).cards('mtg')
  const { ftsJoin, where, params } = buildQuery(p)
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM mtg_oracle o ${ftsJoin} ${where}`,
    params
  )
  return rows[0]?.n ?? 0
}

export const mtgSearchEngine: CardSearchEngine = { search, count }
