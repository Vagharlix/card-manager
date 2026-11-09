import type { DeckEngine, DeckRules, CardForPlacement } from './types'

// ============================================================
// MAGIC DECK ENGINE
// Statuts (card_legality, sur la carte logique) : banned | restricted |
// not_legal ; plus 'deck_limit' (copies max hors règle du format :
// terrains de base et « any number of cards named » → -1, Seven Dwarves → 7).
// Formats à une copie (commander) : 1 exemplaire sauf deck_limit.
// ============================================================

const RULES: DeckRules = {
  boards: [
    { id: 'main', label: 'Main Deck', shortLabel: 'Main', min: 60, max: 250 },
    { id: 'side', label: 'Sideboard', shortLabel: 'Side', min: 0, max: 15 },
    { id: 'commander', label: 'Commander', shortLabel: 'Cmdr', min: 0, max: 2, pickable: true },
  ],
  formats: [
    { id: 'casual', label: 'Casual (no restrictions)' },
    { id: 'standard', label: 'Standard' },
    { id: 'pioneer', label: 'Pioneer' },
    { id: 'modern', label: 'Modern' },
    { id: 'legacy', label: 'Legacy' },
    { id: 'vintage', label: 'Vintage' },
    { id: 'pauper', label: 'Pauper' },
    { id: 'commander', label: 'Commander' },
  ],
  defaultFormat: 'casual',
  defaultMaxCopies: 4,
}

const SINGLETON = new Set(['commander'])
const UNLIMITED = 999

function deckLimit(card: CardForPlacement): number | null {
  const raw = card.banlist?.deck_limit
  if (raw === undefined || raw === null) return null
  const n = Number(raw)
  return n < 0 ? UNLIMITED : n
}

export const mtgDeckEngine: DeckEngine = {
  rules: RULES,

  // un commandant se choisit (déplacement), jamais automatiquement
  boardForCard: () => 'main',

  maxCopiesForCard(card, format) {
    const status = format === 'casual' ? undefined : card.banlist?.[format]
    if (status === 'banned' || status === 'not_legal') return 0
    if (status === 'restricted') return 1
    const own = deckLimit(card)
    if (own !== null) return own
    return SINGLETON.has(format) ? 1 : RULES.defaultMaxCopies
  },

  limitLabel(limit, status) {
    if (status === 'banned') return 'banned'
    if (status === 'not_legal') return 'not legal'
    if (status === 'restricted') return 'restricted (1)'
    return `max ${limit}`
  },

  limitMessage(limit, status) {
    if (status === 'banned') return 'Card banned in this format'
    if (status === 'not_legal') return 'Card not legal in this format'
    if (status === 'restricted') return 'Card restricted to 1 copy'
    return limit === 1 ? 'Only 1 copy allowed in this format' : `${limit}-copy limit reached`
  },
}
