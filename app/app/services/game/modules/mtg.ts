import type { GameModule } from './index'
import { mtgGame } from '~/services/game/mtg'
import { mtgDeckEngine } from '~/services/deck/mtg'
import { mtgSearchEngine } from '~/services/search/mtg'
import { getMtgDetail } from '~/services/card/mtg'
import { identifyMtg } from '~/services/scan/mtg'
import { localMtgVersion, syncMtg } from '~/services/mtgData/sync'

// ============================================================
// MODULE Magic: The Gathering.
// Base de cartes : cards-mtg.db (migrations/mtg), importée depuis le
// fichier « default_cards » de Scryfall (services/mtgData) ; images :
// cards.scryfall.io (card_sources.rs). Une carte = une impression.
// ============================================================

export const mtgModule: GameModule = {
  def: mtgGame,
  deck: mtgDeckEngine,
  search: mtgSearchEngine,
  detail: getMtgDetail,
  scan: identifyMtg,
  cardData: { localVersion: localMtgVersion, sync: syncMtg },
}
