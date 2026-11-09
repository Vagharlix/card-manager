import type { Component } from 'vue'
import SearchFilters from '~/components/searchFilters.vue'

// ============================================================
// Morceaux d'interface propres à un jeu (le reste de l'interface est
// commun). Un jeu absent d'ici n'a simplement pas le panneau.
// ============================================================

// panneau de filtres de la recherche : v-model = filtres passés au moteur
// de recherche du jeu (SearchParams.filters)
const SEARCH_FILTERS: Record<string, Component> = {
  ygo: SearchFilters,
}

export function searchFilterPanel(game: string): Component | null {
  return SEARCH_FILTERS[game] ?? null
}
