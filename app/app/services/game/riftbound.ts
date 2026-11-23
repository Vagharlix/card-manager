// ============================================================
// GAME REGISTRY — Riftbound (Riot Games)
// États : l'échelle commune. Langues : celles où le jeu est imprimé ou
// annoncé (anglais, chinois simplifié, langues européennes).
// ============================================================

import type { GameDefinition } from './types'
import { TCG_CONDITIONS, DEFAULT_CONDITION, TCG_LANGUAGES, DEFAULT_LANGUAGE } from './common'

export const riftboundGame: GameDefinition = {
  id: 'riftbound',
  label: 'Riftbound',
  shortLabel: 'RB',
  cardDb: 'cards-riftbound',
  conditions: TCG_CONDITIONS,
  defaultCondition: DEFAULT_CONDITION,
  languages: [...TCG_LANGUAGES, { id: 'zh', label: 'Chinese (Simplified)' }],
  defaultLanguage: DEFAULT_LANGUAGE,
}
