// ============================================================
// GAME REGISTRY — Yu-Gi-Oh!
// Inherits the common TCG vocabulary as-is. If a future game
// needs a different condition/language scale, it defines its own
// arrays here instead of importing the common ones.
// ============================================================

import type { GameDefinition } from './types'
import { TCG_CONDITIONS, DEFAULT_CONDITION, TCG_LANGUAGES, DEFAULT_LANGUAGE } from './common'

export const ygoGame: GameDefinition = {
  id: 'ygo',
  label: 'Yu-Gi-Oh!',
  cardDb: 'cards-ygo',
  conditions: TCG_CONDITIONS,
  defaultCondition: DEFAULT_CONDITION,
  languages: TCG_LANGUAGES,
  defaultLanguage: DEFAULT_LANGUAGE,
  firstEdition: true,
}
