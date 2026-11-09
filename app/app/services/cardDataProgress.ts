import { ref } from 'vue'

// ============================================================
// Progression de la mise à jour d'une base de cartes (overlay d'app.vue,
// réglages). Partagée par toutes les sources de données de jeu : une
// seule mise à jour à la fois, quel que soit le jeu.
// ============================================================

export const syncProgress = ref(0)
export const syncStatus = ref('')
export const syncError = ref<string | null>(null)
export const isSyncing = ref(false)
