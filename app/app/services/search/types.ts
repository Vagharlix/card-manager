// ============================================================
// SEARCH TYPES
// Common types shared across all game search engines.
// New games implement CardSearchEngine and return CardSearchResult.
// ============================================================

// What every search returns, regardless of game.
// The UI only ever deals with this shape.
export interface CardSearchResult {
  game: string // 'ygo' | 'mtg' | ...
  id: string // passcode (ygo), scryfall uuid (mtg)...
  name: string
  imageUrl: string // small image URL (for the cache / display)
}

// Where the text query searches. Exclusive for now.
// 'both' can be added later without breaking callers.
export type SearchField = 'name' | 'effect'

// Numeric filter with an operator, EDOPro-style (>=2500 etc.)
export interface NumericFilter {
  op: '=' | '<' | '>' | '<=' | '>='
  value: number
}

// Game-agnostic search params passed to the router.
// `filters` is loosely typed here; each engine casts to its own shape.
export interface SearchParams {
  query?: string
  field?: SearchField // default 'name'
  filters?: Record<string, unknown>
  limit?: number // default 48
  offset?: number // default 0
}

// ── YGO-specific filters ──────────────────────────────────────
export interface YgoFilters {
  category?: 'Monster' | 'Spell' | 'Trap'
  monsterTypes?: string[] // ['Synchro', 'Tuner'...] → combined as LIKE
  spellTrapTypes?: string[] // ['Quick-Play', 'Continuous'...]
  attribute?: string
  race?: string
  archetype?: string
  level?: NumericFilter
  atk?: NumericFilter
  def?: NumericFilter
  scale?: NumericFilter
  linkRating?: NumericFilter
  linkMarkers?: string[]
  banlist?: string // 'Forbidden' | 'Limited' | 'Semi-Limited'
}

// The contract every game engine implements.
export interface CardSearchEngine {
  search(params: SearchParams): Promise<CardSearchResult[]>
  count(params: SearchParams): Promise<number>
}
