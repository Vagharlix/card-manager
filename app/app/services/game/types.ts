// ============================================================
// GAME REGISTRY — types
// Per-game vocabulary the collection/settings layers depend on:
// valid card conditions and languages, plus each game's default.
// Mirrors the deck engine (services/deck/types.ts): the generic
// layers ask the registry, they never hardcode YGO-only values.
// ============================================================

export interface ConditionDef {
  id: string // stored in collection.condition (e.g. 'NM')
  label: string
}

export interface LanguageDef {
  id: string // ISO 639-1, stored in collection.language (e.g. 'en')
  label: string
}

export interface GameDefinition {
  id: string // stored in *.game columns (e.g. 'ygo')
  label: string
  conditions: readonly ConditionDef[]
  defaultCondition: string // must be one of conditions[].id
  languages: readonly LanguageDef[]
  defaultLanguage: string // must be one of languages[].id
}
