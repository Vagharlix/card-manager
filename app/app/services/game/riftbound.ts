// ============================================================
// GAME REGISTRY — Riftbound (Riot Games)
// États : l'échelle commune. Langues : celles où le jeu est imprimé ou
// annoncé (anglais, chinois simplifié, langues européennes).
// ============================================================

import type { GameDefinition } from './types'
import {
  TCG_CONDITIONS,
  DEFAULT_CONDITION,
  TCG_LANGUAGES,
  DEFAULT_LANGUAGE,
  CARD_ASPECT_STANDARD,
} from './common'

export const riftboundGame: GameDefinition = {
  id: 'riftbound',
  label: 'Riftbound',
  shortLabel: 'RB',
  // 63 × 88 mm ; les champs de bataille sont imprimés en paysage
  cardAspect: CARD_ASPECT_STANDARD,
  cardDb: 'cards-riftbound',
  conditions: TCG_CONDITIONS,
  defaultCondition: DEFAULT_CONDITION,
  languages: [...TCG_LANGUAGES, { id: 'zh', label: 'Chinese (Simplified)' }],
  defaultLanguage: DEFAULT_LANGUAGE,
}
