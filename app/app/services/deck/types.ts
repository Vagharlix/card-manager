// ============================================================
// DECK ENGINE — multi-TCG deck rules
// Each game defines its own boards, formats, where a card goes,
// and how copy limits work. The generic deck builder asks the
// engine — it never hardcodes YGO rules. Mirrors search engine.
// ============================================================

export type Board = 'main' | 'side' | 'extra' | 'commander' | 'maybe'

export interface BoardDef {
  id: Board
  label: string // « Main Deck »
  shortLabel?: string // onglet mobile : « Main »
  // zone où l'on place une carte à la main (Magic : commandant) : proposée
  // dans le menu des autres zones, et « retour au deck » depuis elle
  pickable?: boolean
  min: number
  max: number
}

// a playable format for a game (e.g. YGO: TCG, OCG, Casual)
export interface FormatDef {
  id: string // stored in decks.format
  label: string
}

export interface DeckRules {
  boards: BoardDef[]
  formats: FormatDef[]
  defaultFormat: string
  defaultMaxCopies: number
}

// minimal card info the engine needs to decide placement / limits
export interface CardForPlacement {
  cardId: string
  type?: string | null
  // banlist status per format, supplied by the service (engine stays pure).
  // e.g. { tcg: 'Limited', ocg: null }
  banlist?: Record<string, string | null>
}

export interface DeckEngine {
  rules: DeckRules
  // which board a freshly added card belongs to (auto-placement)
  boardForCard(card: CardForPlacement): Board
  // copy limit for a card in a given format (banlist-aware)
  maxCopiesForCard(card: CardForPlacement, format: string): number
  // libellé court d'une limite (liste des infractions : « banned », « max 4 »)
  // et message quand un ajout est refusé ; status = statut brut du format
  limitLabel(limit: number, status: string | null): string
  limitMessage(limit: number, status: string | null): string
}
