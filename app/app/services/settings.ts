import { useDatabase } from '~/composables/useDatabase'
import { fallbackCondition, fallbackLanguage } from '~/services/game'

// ============================================================
// SETTINGS SERVICE
// Key-value preferences stored in user.db.
// Cached in memory after first read; writes update both.
//
// Two scopes share the same flat table:
//  - GLOBAL keys  : bare key (e.g. 'favorite_game')
//  - PER-GAME keys: '{game}.{key}' (e.g. 'ygo.default_condition')
//
// Defaults live in TS, never in the DB. A missing key falls back
// to its default; per-game defaults come from the game registry.
// Consequence: adding a game needs no migration and no re-seed —
// 'mtg.default_condition' simply doesn't exist until first write.
// ============================================================

// known setting keys + their default if the row is somehow missing
const DEFAULTS = {
  favorite_game: '',
  show_game_picker: 'true',
  default_condition: 'NM', // legacy GLOBAL key — superseded by per-game
  default_language: 'en', //  keys below; kept only for back-compat
  image_cache_limit_mb: '200',
  share_owner_name: '', // nom affiché aux joueurs avec qui on partage sa collection
} satisfies Record<string, string>

let cache: Record<string, string> | null = null

async function loadAll(): Promise<Record<string, string>> {
  if (cache) return cache
  const { user } = await useDatabase()
  const rows = await user.select<{ key: string; value: string }[]>(
    `SELECT key, value FROM settings`
  )
  cache = { ...DEFAULTS }
  for (const r of rows) cache[r.key] = r.value
  return cache
}

export async function setSetting(key: string, value: string): Promise<void> {
  const { user } = await useDatabase()
  await user.execute(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value]
  )
  if (cache) cache[key] = value
}

// force re-read on next access (e.g. after external change)
export function invalidateSettingsCache(): void {
  cache = null
}

// ============================================================
// TYPED GLOBAL SETTINGS
// Decoded into their real types (bool/int) instead of raw strings.
// Encoding lives here so it never diverges across callers.
// ============================================================

export interface GlobalSettings {
  favoriteGame: string // '' = none chosen yet
  showGamePicker: boolean
  imageCacheLimitMb: number
}

export async function getGlobalSettings(): Promise<GlobalSettings> {
  const all = await loadAll()
  return {
    favoriteGame: all['favorite_game'] ?? DEFAULTS.favorite_game,
    showGamePicker: (all['show_game_picker'] ?? DEFAULTS.show_game_picker) === 'true',
    imageCacheLimitMb: parseInt(all['image_cache_limit_mb'] ?? DEFAULTS.image_cache_limit_mb, 10),
  }
}

export async function setFavoriteGame(game: string): Promise<void> {
  await setSetting('favorite_game', game)
}

export async function setShowGamePicker(show: boolean): Promise<void> {
  await setSetting('show_game_picker', show ? 'true' : 'false')
}

export async function getShareOwnerName(): Promise<string> {
  return (await loadAll())['share_owner_name'] ?? ''
}

export async function setShareOwnerName(name: string): Promise<void> {
  await setSetting('share_owner_name', name.trim())
}

export async function setImageCacheLimitMb(mb: number): Promise<void> {
  await setSetting('image_cache_limit_mb', String(Math.max(0, Math.round(mb))))
}

// ============================================================
// PER-GAME SETTINGS
// Stored namespaced ('{game}.{key}'). Reading returns the user's
// override if set, else the game's default from the registry.
// ============================================================

export type GameSettingKey = 'default_condition' | 'default_language'

function gameKey(game: string, key: GameSettingKey): string {
  return `${game}.${key}`
}

// raw stored override for a per-game key, or null if the user never set it
export async function getGameOverride(game: string, key: GameSettingKey): Promise<string | null> {
  const all = await loadAll()
  return all[gameKey(game, key)] ?? null
}

export async function setGameSetting(
  game: string,
  key: GameSettingKey,
  value: string
): Promise<void> {
  await setSetting(gameKey(game, key), value)
}

// resolved values: override ?? registry default (never throws)
export async function getDefaultCondition(game: string): Promise<string> {
  return (await getGameOverride(game, 'default_condition')) ?? fallbackCondition(game)
}

export async function getDefaultLanguage(game: string): Promise<string> {
  return (await getGameOverride(game, 'default_language')) ?? fallbackLanguage(game)
}

export interface GameSettings {
  defaultCondition: string
  defaultLanguage: string
}

export async function getGameSettings(game: string): Promise<GameSettings> {
  // loadAll() is cached, so these resolve from one read
  return {
    defaultCondition: await getDefaultCondition(game),
    defaultLanguage: await getDefaultLanguage(game),
  }
}
