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
// la mise à jour en cours empêche d'utiliser l'appli (1re installation d'une
// base : overlay plein écran) ; sinon elle se fait en arrière-plan
// (indicateur discret), les cartes restant consultables
export const syncBlocking = ref(false)
