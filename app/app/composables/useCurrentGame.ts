import { allGames, gameDef, gameDefOrNull } from '~/services/game'
import '~/services/game/modules' // enregistre les modules de jeu

// ============================================================
// useCurrentGame — le jeu affiché (collection, recherche, decks, scan,
// partage, réglages par jeu). Choix de la session ; à défaut le jeu
// favori (réglage), à défaut le premier jeu enregistré.
// Changer de jeu remonte la page (clé de page d'app.vue).
// Avec un seul jeu, rien de tout ça n'est visible.
// ============================================================

export const useCurrentGame = createGlobalState(() => {
  const { global } = useSettings()
  const chosen = ref<string | null>(null)

  const game = computed(() => {
    const id = chosen.value ?? global.favoriteGame
    return id && gameDefOrNull(id) ? id : allGames()[0]!.id
  })
  const def = computed(() => gameDef(game.value))
  const games = computed(() => allGames())
  const multiGame = computed(() => games.value.length > 1)

  // plusieurs jeux, sélecteur au lancement activé, pas de favori, rien choisi
  // (jamais en E2E : les parcours démarrent sur le premier jeu et changent de
  // jeu par le sélecteur)
  const askAtLaunch = computed(
    () =>
      import.meta.env.VITE_TEST_MODE !== 'true' &&
      multiGame.value &&
      global.showGamePicker &&
      !global.favoriteGame &&
      chosen.value === null
  )

  function setGame(id: string): void {
    if (gameDefOrNull(id)) chosen.value = id
  }

  return { game, def, games, multiGame, askAtLaunch, setGame }
})
