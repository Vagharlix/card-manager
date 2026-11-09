import { gameModule } from '~/services/game/modules'
import type { CardSearchResult, SearchParams } from './types'

// ============================================================
// SEARCH ROUTER
// Maps a game id to its search engine (from the game's module,
// services/game/modules). Adding a new TCG = implement its engine
// + reference it in the game's module. Nothing else changes.
// ============================================================

export function searchCards(game: string, params: SearchParams): Promise<CardSearchResult[]> {
  return gameModule(game).search.search(params)
}

export function countCards(game: string, params: SearchParams): Promise<number> {
  return gameModule(game).search.count(params)
}

// filtres propres à YGO (composant searchFilters)
export { getYgoFilterOptions, type YgoFilterOptions } from './ygo'

export type { CardSearchResult, SearchParams, YgoFilters, NumericFilter } from './types'
