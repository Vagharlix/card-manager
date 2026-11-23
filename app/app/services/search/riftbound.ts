import { useDatabase } from '~/composables/useDatabase'
import type { CardSearchEngine, CardSearchResult, NumericFilter, SearchParams } from './types'

// ============================================================
// RECHERCHE RIFTBOUND — une ligne par carte logique (rb_cards), montrée
// avec son impression par défaut. Texte via FTS5 (nom, ou texte + étiquettes),
// filtres : domaines, types, supertype, coût en énergie, puissance,
// extension, légal dans un format.
// ============================================================

export interface RiftboundFilters {
  domains?: string[] // la carte a tous ces domaines
  colorless?: boolean
  types?: string[] // 'Unit', 'Spell'… (OU)
  supertype?: string // 'Champion' | 'Signature' | 'Token' | 'Basic'
  energy?: NumericFilter
  might?: NumericFilter
  set?: string // 'ogn'
  format?: string // légale dans ce format
}

export const RB_SUPERTYPES = ['Champion', 'Signature', 'Token', 'Basic']

const NUMERIC_OPS = new Set(['=', '<', '>', '<=', '>='])
const DOMAINS = new Set(['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'])

// texte libre → requête FTS5 sûre : chaque mot entre guillemets, en préfixe
// (« kai sa » trouve Kai'Sa ; apostrophes, virgules ignorées)
export function rbFtsQuery(text: string, field: 'name' | 'effect'): string | null {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu)
  if (!words?.length) return null
  const col = field === 'effect' ? '{text tags}' : 'name'
  return words.map((w) => `${col} : "${w}"*`).join(' AND ')
}

function numeric(column: string, f: NumericFilter | undefined, out: string[], params: unknown[]) {
  if (f && NUMERIC_OPS.has(f.op) && Number.isFinite(f.value)) {
    out.push(`${column} ${f.op} ?`)
    params.push(f.value)
  }
}

function buildQuery(p: SearchParams) {
  const f = (p.filters ?? {}) as RiftboundFilters
  const conditions: string[] = []
  const params: unknown[] = []
  let ftsJoin = ''

  const match = p.query ? rbFtsQuery(p.query, p.field === 'effect' ? 'effect' : 'name') : null
  if (match) {
    ftsJoin = `JOIN rb_cards_fts ON rb_cards_fts.rowid = o.rowid AND rb_cards_fts MATCH ?`
    params.push(match)
  }
  for (const d of f.domains ?? []) {
    if (!DOMAINS.has(d)) continue
    conditions.push(`(',' || o.domains || ',') LIKE ?`)
    params.push(`%,${d},%`)
  }
  if (f.colorless) conditions.push(`o.domains = ''`)
  if (f.types?.length) {
    conditions.push(`o.type IN (${f.types.map(() => '?').join(', ')})`)
    params.push(...f.types)
  }
  if (f.supertype) {
    conditions.push(`o.supertype = ?`)
    params.push(f.supertype)
  }
  numeric('o.energy', f.energy, conditions, params)
  numeric('o.might', f.might, conditions, params)
  if (f.set) {
    conditions.push(`EXISTS (SELECT 1 FROM rb_prints p WHERE p.oracle_id = o.oracle_id AND p.set_code = ?)`)
    params.push(f.set.toLowerCase())
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
  const db = (await useDatabase()).cards('riftbound')
  const { ftsJoin, where, params, ranked, exact } = buildQuery(p)
  // nom exact d'abord, puis le nom avant la virgule (« Jinx » → « Jinx, … »)
  const order = ranked
    ? `(o.name = ? COLLATE NOCASE) DESC, (o.name LIKE ? || ',%') DESC, rb_cards_fts.rank, o.name COLLATE NOCASE`
    : `o.name COLLATE NOCASE`
  const rows = await db.select<{ id: string; name: string }[]>(
    `SELECT o.default_print AS id, o.name FROM rb_cards o ${ftsJoin} ${where}
     ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, ...(ranked ? [exact, exact] : []), p.limit ?? 48, p.offset ?? 0]
  )
  return rows.map((r) => ({ game: 'riftbound', id: r.id, name: r.name, imageUrl: '' }))
}

async function count(p: SearchParams): Promise<number> {
  const db = (await useDatabase()).cards('riftbound')
  const { ftsJoin, where, params } = buildQuery(p)
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM rb_cards o ${ftsJoin} ${where}`,
    params
  )
  return rows[0]?.n ?? 0
}

// extensions présentes dans la base (filtre « Set »)
export async function riftboundSets(): Promise<{ code: string; name: string }[]> {
  const db = (await useDatabase()).cards('riftbound')
  return db.select<{ code: string; name: string }[]>(
    `SELECT set_code AS code, set_name AS name FROM rb_prints
     GROUP BY set_code ORDER BY MIN(released_at) DESC, set_code`
  )
}

export const riftboundSearchEngine: CardSearchEngine = { search, count }
