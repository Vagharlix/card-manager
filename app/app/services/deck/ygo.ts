import type { DeckEngine, DeckRules, Board, CardForPlacement } from './types'

// ============================================================
// YGO DECK ENGINE (EDOPro-style rules)
// ============================================================

const YGO_RULES: DeckRules = {
  boards: [
    { id: 'main', label: 'Main Deck', min: 40, max: 60 },
    { id: 'extra', label: 'Extra Deck', min: 0, max: 15 },
    { id: 'side', label: 'Side Deck', min: 0, max: 15 },
  ],
  defaultMaxCopies: 3,
}

// Monster card types that belong to the Extra Deck.
// A card whose `type` contains one of these tokens is an Extra Deck card.
const EXTRA_DECK_TOKENS = ['Fusion', 'Synchro', 'Xyz', 'Link']

export const ygoDeckEngine: DeckEngine = {
  rules: YGO_RULES,

  boardForCard(card: CardForPlacement): Board {
    const type = card.type ?? ''
    // Extra Deck monsters go to extra; everything else to main.
    // (Side is never automatic — it's an explicit user move.)
    if (EXTRA_DECK_TOKENS.some((tok) => type.includes(tok))) return 'extra'
    return 'main'
  },

  // banlist-aware copy limit will be wired later (reads ygo_details
  // banlist columns). For now, the default of 3 applies.
  maxCopiesForCard(_card: CardForPlacement): number {
    return YGO_RULES.defaultMaxCopies
  },
}
