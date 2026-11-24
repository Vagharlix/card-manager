import { gameModuleOrNull, type CardDataReport } from '~/services/game/modules'

// ============================================================
// Mise à jour de la base de cartes d'un jeu (routeur vers la source du
// module). La progression est commune : services/cardDataProgress.
// ============================================================

import { cardDataInstalled, syncFirstInstall, syncingGame } from './cardDataProgress'

export {
  syncProgress,
  syncStatus,
  syncError,
  isSyncing,
  syncingGame,
  syncFirstInstall,
  cardDataInstalled,
} from './cardDataProgress'

export function hasCardData(game: string): boolean {
  return !!gameModuleOrNull(game)?.cardData
}

// une mise à jour à la fois : les demandes suivantes attendent leur tour
// (ex. changer de jeu pendant la mise à jour d'un autre en arrière-plan :
// la base du nouveau jeu doit quand même être téléchargée ensuite)
let queue: Promise<unknown> = Promise.resolve()

export function syncCardData(
  game: string,
  options: { force?: boolean; auto?: boolean } = {}
): Promise<CardDataReport | null> {
  const run = async () => {
    const source = gameModuleOrNull(game)?.cardData
    if (!source) return null
    const first = (await source.localVersion()) === null
    syncingGame.value = game
    syncFirstInstall.value = first
    try {
      const report = await source.sync(options)
      if (first && (await source.localVersion()) !== null) cardDataInstalled.value++
      return report
    } finally {
      syncingGame.value = null
      syncFirstInstall.value = false
    }
  }
  const next = queue.then(run, run)
  queue = next.catch(() => {})
  return next
}

export async function localCardDataVersion(game: string): Promise<string | null> {
  return (await gameModuleOrNull(game)?.cardData?.localVersion()) ?? null
}
