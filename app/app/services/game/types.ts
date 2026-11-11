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
  shortLabel: string // sélecteur de jeu sur petit écran (« YGO »)
  // base de cartes du jeu, sans suffixe ni extension (ex. 'cards-ygo' →
  // cards-ygo.db) ; ses migrations sont enregistrées côté Rust (lib.rs)
  // et doivent fournir le contrat commun (cf. migrations/ygo/003)
  cardDb: string
  // sous-ensemble de l'échelle commune NM / LP / MP / HP / DMG (imposée par
  // la base : CHECK de collection.condition, cf. migrations/user/001) ;
  // les libellés, eux, sont libres
  conditions: readonly ConditionDef[]
  defaultCondition: string // must be one of conditions[].id
  languages: readonly LanguageDef[]
  defaultLanguage: string // must be one of languages[].id
  // mention « 1re édition » proposée à l'ajout / au scan (YGO oui, Magic non)
  firstEdition?: boolean
}
