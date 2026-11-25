import type { GameModule } from './index'
import { riftboundGame } from '~/services/game/riftbound'
import { riftboundDeckEngine } from '~/services/deck/riftbound'
import { riftboundSearchEngine } from '~/services/search/riftbound'
import { getRiftboundDetail } from '~/services/card/riftbound'
import { identifyRiftbound } from '~/services/scan/riftbound'
import { localRiftboundVersion, syncRiftbound } from '~/services/riftboundData/sync'

// ============================================================
// MODULE Riftbound (Riot Games).
// Base de cartes : cards-riftbound.db (migrations/riftbound), mise à jour
// depuis RiftHunt (services/riftboundData) ; images : images.rifthunt.com,
// adresse fournie par carte (indices, card_sources.rs). Une carte = une
// impression ; deck : légende, champion choisi, runes, champs de bataille.
// ============================================================

export const riftboundModule: GameModule = {
  def: riftboundGame,
  deck: riftboundDeckEngine,
  search: riftboundSearchEngine,
  detail: getRiftboundDetail,
  scan: identifyRiftbound,
  // bas gauche : « SFD • 227/221 »
  scanZones: [{ x: 0, y: 0.88, w: 0.6, h: 0.12 }],
  cardData: { localVersion: localRiftboundVersion, sync: (o) => syncRiftbound(o) },
}
