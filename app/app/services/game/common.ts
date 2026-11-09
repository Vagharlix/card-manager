// ============================================================
// GAME REGISTRY — common TCG vocabulary
// The de-facto market standard (TCGplayer): the same five
// condition tiers are used across Yu-Gi-Oh!, Magic, Pokémon,
// Lorcana, One Piece, etc. A game inherits these by default and
// may override them in its own definition if it diverges.
//
// `id`s match the values already stored in the collection table
// (CardCondition = 'NM'|'LP'|'MP'|'HP'|'DMG', languages = ISO 639-1).
// Mint / Gem Mint are intentionally excluded — they belong to
// professional grading (PSA/BGS), not raw single condition.
// ============================================================

import type { ConditionDef, LanguageDef } from './types'

export const TCG_CONDITIONS: readonly ConditionDef[] = [
  { id: 'NM', label: 'Near Mint' },
  { id: 'LP', label: 'Lightly Played' },
  { id: 'MP', label: 'Moderately Played' },
  { id: 'HP', label: 'Heavily Played' },
  { id: 'DMG', label: 'Damaged' },
]

export const DEFAULT_CONDITION = 'NM'

export const TCG_LANGUAGES: readonly LanguageDef[] = [
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'it', label: 'Italian' },
  { id: 'es', label: 'Spanish' },
  { id: 'pt', label: 'Portuguese' },
  { id: 'ja', label: 'Japanese' },
  { id: 'ko', label: 'Korean' },
]

export const DEFAULT_LANGUAGE = 'en'
