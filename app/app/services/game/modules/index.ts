import type { DeckEngine } from '~/services/deck/types'
import type { CardSearchEngine } from '~/services/search/types'
import type { CardDetail } from '~/services/card/detail'
import type { Identified, ScanZone } from '~/services/scan/types'
import type { OcrLine } from '~/services/scan/text'
import { registerGame, unregisterGame, type GameDefinition } from '~/services/game'
import { ygoModule } from './ygo'
import { mtgModule } from './mtg'
import { riftboundModule } from './riftbound'

// ============================================================
// MODULES DE JEU — point d'entrée unique de chaque jeu.
// Un module rassemble tout ce qui est propre à un jeu ; le reste de
// l'appli (collection, rangements, decks, partage, sauvegarde, synchro)
// est générique et passe par ici ou par le contrat commun de la base
// de cartes (services/card/meta.ts).
//
// Ajouter un jeu :
//   1. sa définition (services/game/<jeu>.ts : vocabulaire, base de cartes ;
//      états = sous-ensemble de NM/LP/MP/HP/DMG, zones de deck parmi
//      main/side/extra/commander/maybe/legend/champion/runes/battlefields,
//      cf. Board ; user.db accepte tout nom court depuis la migration 011)
//   2. sa base de cartes : migrations src-tauri/migrations/<jeu>/ qui
//      fournissent le contrat commun (cf. migrations/ygo/003), enregistrées
//      dans src-tauri/src/lib.rs
//   3. son module (services/game/modules/<jeu>.ts) + une ligne ci-dessous
//   4. ses images : une branche dans src-tauri/src/card_sources.rs
//      (image_source ; adresse non déductible de l'id : needs_hint + indices
//      envoyés par image_sources_set, cf. riftboundData/sync.ts)
//   5. facultatif : son panneau de filtres de recherche (utils/gameUi.ts)
// ============================================================

// source des données de référence (téléchargement de la base de cartes)
export interface CardDataSource {
  // version locale (null = jamais synchronisée)
  localVersion(): Promise<string | null>
  // met la base à jour (force : retélécharge et réécrit tout ;
  // auto : lancement de l'appli, la source peut espacer ses vérifications) ;
  // progression dans services/cardDataProgress. Mise à jour incrémentale :
  // seules les cartes nouvelles / modifiées sont écrites (null = rien fait,
  // une mise à jour était déjà en cours)
  sync(options?: { force?: boolean; auto?: boolean }): Promise<CardDataReport | null>
}

// bilan d'une mise à jour (affiché dans les réglages)
export interface CardDataReport {
  changed: number // cartes / impressions ajoutées ou modifiées
  removed: number // retirées de la source
}

export interface GameModule {
  def: GameDefinition
  deck: DeckEngine
  search: CardSearchEngine
  detail(cardId: string): Promise<CardDetail | null>
  // identification OCR (absent = pas de scan pour ce jeu)
  scan?: (lines: OcrLine[]) => Promise<Identified | null>
  // zones relues de près (agrandies) quand le scan n'a pas trouvé l'impression
  scanZones?: ScanZone[]
  // absent = base de cartes fournie autrement (tests)
  cardData?: CardDataSource
}

const MODULES = new Map<string, GameModule>()

// enregistre un jeu (définition + module) ; utilisé ici pour les jeux de
// l'appli, et par les tests pour un faux jeu
export function registerGameModule(mod: GameModule): void {
  registerGame(mod.def)
  MODULES.set(mod.def.id, mod)
}

// retire un jeu enregistré (tests)
export function unregisterGameModule(id: string): void {
  MODULES.delete(id)
  unregisterGame(id)
}

export function gameModule(game: string): GameModule {
  const mod = MODULES.get(game)
  if (!mod) throw new Error(`No module for game "${game}"`)
  return mod
}

export function gameModuleOrNull(game: string): GameModule | null {
  return MODULES.get(game) ?? null
}

registerGameModule(ygoModule)
registerGameModule(mtgModule)
registerGameModule(riftboundModule)
