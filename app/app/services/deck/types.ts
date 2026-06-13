// ============================================================
// DECK ENGINE — multi-TCG deck rules
// Each game defines its own boards, where a card goes, and how a
// deck is validated. The generic deck builder asks the engine —
// it never hardcodes YGO rules. Mirrors the search engine pattern.
// ============================================================

export type Board = 'main' | 'side' | 'extra' | 'commander' | 'maybe'

export interface BoardDef {
  id: Board
  label: string
  min: number // min cards (0 if optional)
  max: number // max cards
}

export interface DeckRules {
  // boards this game uses, in display order
  boards: BoardDef[]
  // default per-card copy limit (before banlist adjustments)
  defaultMaxCopies: number
}

// minimal card info the engine needs to decide placement
export interface CardForPlacement {
  cardId: string
  type?: string | null // YGO: "Synchro Monster", "Spell Card", ...
  // extensible per game
}

export interface DeckEngine {
  rules: DeckRules
  // which board a freshly added card belongs to (auto-placement).
  // returns the board, or null if the card can't be auto-placed.
  boardForCard(card: CardForPlacement): Board
  // copy limit for a specific card (banlist-aware); falls back to default
  maxCopiesForCard?(card: CardForPlacement): number
}
