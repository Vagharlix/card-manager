// ============================================================
// GAME REGISTRY — router
// Resolves a game id to its definition (pure data: vocabulary, card
// database). Everything else a game provides lives in its module
// (services/game/modules) — the single entry point of a game.
// ============================================================

import type { GameDefinition } from './types'
import { ygoGame } from './ygo'
import { DEFAULT_CONDITION, DEFAULT_LANGUAGE } from './common'

const GAMES: Record<string, GameDefinition> = {
  ygo: ygoGame,
}

// ajoute un jeu (appelé par registerGameModule ; tests : faux jeu)
export function registerGame(def: GameDefinition): void {
  GAMES[def.id] = def
}

// retire un jeu (tests)
export function unregisterGame(id: string): void {
  delete GAMES[id]
}

// strict resolver — throws on unknown game (use where a game must exist)
export function gameDef(game: string): GameDefinition {
  const def = GAMES[game]
  if (!def) throw new Error(`No game definition for "${game}"`)
  return def
}

// soft resolver — never throws (use for default resolution in the
// settings layer, so an unknown game still yields sane fallbacks)
export function gameDefOrNull(game: string): GameDefinition | null {
  return GAMES[game] ?? null
}

// the registered games, e.g. for the game picker / enabled-games UI
export function allGames(): GameDefinition[] {
  return Object.values(GAMES)
}

// universal fallbacks when no game definition is available
export function fallbackCondition(game: string): string {
  return gameDefOrNull(game)?.defaultCondition ?? DEFAULT_CONDITION
}

export function fallbackLanguage(game: string): string {
  return gameDefOrNull(game)?.defaultLanguage ?? DEFAULT_LANGUAGE
}

export type { GameDefinition, ConditionDef, LanguageDef } from './types'
export { TCG_CONDITIONS, TCG_LANGUAGES, DEFAULT_CONDITION, DEFAULT_LANGUAGE } from './common'
