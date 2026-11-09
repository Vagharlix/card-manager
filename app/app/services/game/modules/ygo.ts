import type { GameModule } from './index'
import { ygoGame } from '~/services/game/ygo'
import { ygoDeckEngine } from '~/services/deck/ygo'
import { ygoSearchEngine } from '~/services/search/ygo'
import { getYgoDetail } from '~/services/card/ygo'
import { identifyYgo } from '~/services/scan/ygo'
import { localSyncVersion, syncYgo } from '~/services/sync'

// ============================================================
// MODULE Yu-Gi-Oh! — tout ce qui est propre à YGO, en un seul endroit.
// Base de cartes : cards-ygo.db (migrations/ygo), synchronisée depuis
// YGOPRODeck ; images : images.ygoprodeck.com (image_cache.rs).
// ============================================================

export const ygoModule: GameModule = {
  def: ygoGame,
  deck: ygoDeckEngine,
  search: ygoSearchEngine,
  detail: getYgoDetail,
  scan: identifyYgo,
  cardData: { localVersion: localSyncVersion, sync: syncYgo },
}
