import { gameModuleOrNull, type CardDataReport } from '~/services/game/modules'

// ============================================================
// Mise à jour de la base de cartes d'un jeu (routeur vers la source du
// module). La progression est commune : services/cardDataProgress.
// ============================================================

export { syncProgress, syncStatus, syncError, isSyncing, syncBlocking } from './cardDataProgress'

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
  const run = async () => (await gameModuleOrNull(game)?.cardData?.sync(options)) ?? null
  const next = queue.then(run, run)
  queue = next.catch(() => {})
  return next
}

export async function localCardDataVersion(game: string): Promise<string | null> {
  return (await gameModuleOrNull(game)?.cardData?.localVersion()) ?? null
}
