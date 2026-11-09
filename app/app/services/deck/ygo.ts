import type { DeckEngine, DeckRules, Board, CardForPlacement } from './types'

// ============================================================
// YGO DECK ENGINE (EDOPro-style rules)
// ============================================================

const YGO_RULES: DeckRules = {
  boards: [
    { id: 'main', label: 'Main Deck', shortLabel: 'Main', min: 40, max: 60 },
    { id: 'extra', label: 'Extra Deck', shortLabel: 'Extra', min: 0, max: 15 },
    { id: 'side', label: 'Side Deck', shortLabel: 'Side', min: 0, max: 15 },
  ],
  formats: [
    { id: 'tcg', label: 'TCG' },
    { id: 'ocg', label: 'OCG' },
    { id: 'casual', label: 'Casual (no banlist)' },
  ],
  defaultFormat: 'tcg',
  defaultMaxCopies: 3,
}

// Monster types that belong to the Extra Deck. Matched case-insensitively:
// YGOPRODeck spells it "XYZ Monster", not "Xyz".
const EXTRA_DECK_TOKENS = ['fusion', 'synchro', 'xyz', 'link']

// banlist status → allowed copies
function copiesFromStatus(status: string | null | undefined): number {
  switch (status) {
    case 'Forbidden':
      return 0
    case 'Limited':
      return 1
    case 'Semi-Limited':
      return 2
    default:
      return 3
  }
}

export const ygoDeckEngine: DeckEngine = {
  rules: YGO_RULES,

  boardForCard(card: CardForPlacement): Board {
    const type = (card.type ?? '').toLowerCase()
    if (EXTRA_DECK_TOKENS.some((tok) => type.includes(tok))) return 'extra'
    return 'main'
  },

  maxCopiesForCard(card: CardForPlacement, format: string): number {
    // Casual (or unknown format) → no banlist, full 3 copies
    if (format === 'casual') return YGO_RULES.defaultMaxCopies

    const status = card.banlist?.[format]
    // if we have a banlist status for this format, apply it; else default 3
    if (status === undefined) return YGO_RULES.defaultMaxCopies
    return copiesFromStatus(status)
  },

  limitLabel(limit, status) {
    if (status === 'Forbidden') return 'forbidden (0)'
    if (status === 'Limited') return 'limited to 1'
    if (status === 'Semi-Limited') return 'semi-limited (2)'
    return `max ${limit}`
  },

  limitMessage(limit, status) {
    if (status === 'Forbidden') return 'Card forbidden in this format'
    if (status === 'Limited') return 'Card limited to 1 copy'
    if (status === 'Semi-Limited') return 'Card semi-limited (2 max)'
    return `${limit}-copy limit reached`
  },
}
