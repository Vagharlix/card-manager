import { gameModule } from '~/services/game/modules'

// ============================================================
// getCardDetail(game, id)
// Fiche complète d'une carte : caractéristiques, impressions (avec
// toutes leurs raretés) et artworks. Routeur : chaque jeu fournit son
// implémentation dans son module (YGO : services/card/ygo.ts).
// ============================================================

export interface CardPrinting {
  id: string // set_code e.g. 'LOB-EN005'
  setName: string
  setCode: string
  rarity: string | null
  // toutes les raretés connues pour ce code (un même code peut exister en
  // Super, Ultra, Secret…) ; à défaut, la rareté unique de `printings`
  rarities: string[]
}

export interface CardArtwork {
  id: string // passcode of this specific artwork
  name: string
}

// une caractéristique affichée telle quelle par la fiche (« ATK : 2500 »)
export interface CardFact {
  label: string
  value: string
}

// une mention mise en avant (ex. statut de banlist)
export interface CardBadge {
  label: string
  color: 'error' | 'warning' | 'neutral'
}

// fiche commune à tous les jeux : l'interface n'affiche que ça
export interface CardDetail {
  game: string
  id: string
  name: string
  legalText: string | null
  facts: CardFact[]
  badges: CardBadge[]
  printings: CardPrinting[]
  artworks: CardArtwork[] // all arts of this card (incl. itself)
}

// fiche YGO : la fiche commune + les champs bruts (tests, usages YGO)
export interface YgoCardDetail extends CardDetail {
  game: 'ygo'
  type: string | null
  attribute: string | null
  race: string | null
  atk: number | null
  def: number | null
  level: number | null
  rank: number | null
  linkValue: number | null
  linkMarkers: string[] | null
  scale: number | null
  archetype: string | null
  banlistTcg: string | null
  banlistOcg: string | null
}

export function getCardDetail(game: string, id: string): Promise<CardDetail | null> {
  return gameModule(game).detail(id)
}

export { printingRarities } from './meta'
