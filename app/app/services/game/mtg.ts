// ============================================================
// GAME REGISTRY — Magic: The Gathering
// États : l'échelle commune. Langues : celles de l'impression papier
// (Scryfall), dont le russe et le chinois absents de YGO.
// ============================================================

import type { GameDefinition } from './types'
import { TCG_CONDITIONS, DEFAULT_CONDITION, TCG_LANGUAGES, DEFAULT_LANGUAGE } from './common'

export const mtgGame: GameDefinition = {
  id: 'mtg',
  label: 'Magic: The Gathering',
  cardDb: 'cards-mtg',
  conditions: TCG_CONDITIONS,
  defaultCondition: DEFAULT_CONDITION,
  languages: [
    ...TCG_LANGUAGES,
    { id: 'ru', label: 'Russian' },
    { id: 'zh', label: 'Chinese (Simplified)' },
    { id: 'zh-tw', label: 'Chinese (Traditional)' },
  ],
  defaultLanguage: DEFAULT_LANGUAGE,
}
