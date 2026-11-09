import { gameModuleOrNull } from '~/services/game/modules'

// ============================================================
// Mise à jour de la base de cartes d'un jeu (routeur vers la source du
// module). La progression est commune : services/cardDataProgress.
// ============================================================

export { syncProgress, syncStatus, syncError, isSyncing } from './cardDataProgress'

export function hasCardData(game: string): boolean {
  return !!gameModuleOrNull(game)?.cardData
}

export async function syncCardData(
  game: string,
  options: { force?: boolean; auto?: boolean } = {}
): Promise<void> {
  await gameModuleOrNull(game)?.cardData?.sync(options)
}

export async function localCardDataVersion(game: string): Promise<string | null> {
  return (await gameModuleOrNull(game)?.cardData?.localVersion()) ?? null
}
