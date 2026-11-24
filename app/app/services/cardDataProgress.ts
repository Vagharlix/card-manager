import { ref } from 'vue'

// ============================================================
// Progression de la mise à jour d'une base de cartes (pastille d'app.vue,
// réglages, recherche). Partagée par toutes les sources de données de jeu :
// une seule mise à jour à la fois, quel que soit le jeu. Toujours en
// arrière-plan, même la 1re installation (même comportement pour tous les
// jeux) : l'appli reste utilisable, la page est rechargée à la fin.
// ============================================================

export const syncProgress = ref(0)
export const syncStatus = ref('')
export const syncError = ref<string | null>(null)
export const isSyncing = ref(false)
// jeu dont la base est en cours de mise à jour (null = aucune)
export const syncingGame = ref<string | null>(null)
// cette mise à jour est la 1re installation de la base (rien à afficher
// pour ce jeu tant qu'elle n'est pas finie)
export const syncFirstInstall = ref(false)
// incrémenté à la fin d'une 1re installation réussie : la page affichée
// est remontée (clé de page d'app.vue) et relit ses cartes
export const cardDataInstalled = ref(0)
