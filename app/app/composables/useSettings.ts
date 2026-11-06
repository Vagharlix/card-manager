import {
  getGlobalSettings,
  getGameSettings,
  setFavoriteGame as persistFavoriteGame,
  setShowGamePicker as persistShowGamePicker,
  setImageCacheLimitMb as persistCacheLimit,
  setGameSetting as persistGameSetting,
  invalidateSettingsCache,
  type GlobalSettings,
  type GameSettings,
  type GameSettingKey,
} from '~/services/settings'

// ============================================================
// useSettings — reactive, app-wide settings store
//
// Wraps the settings SERVICE (which owns the DB + its plain cache)
// in a single reactive store shared across the whole app via
// VueUse's createGlobalState. Reads are reactive; writes are
// write-through (update reactive state, then persist).
//
// Load is idempotent with a shared promise — concurrent callers
// trigger a single read, mirroring useDatabase. Call ensureLoaded()
// once at boot (app.vue); per-game data loads lazily on first use.
//
// createGlobalState / ref / reactive are Nuxt + VueUse auto-imports.
// ============================================================

export const useSettings = createGlobalState(() => {
  // ── global (reactive; defaults overwritten on load) ──
  const global = reactive<GlobalSettings>({
    favoriteGame: '',
    showGamePicker: true,
    imageCacheLimitMb: 200,
  })

  // ── per-game settings, keyed by game id ──
  const games = reactive<Record<string, GameSettings>>({})

  const loaded = ref(false)
  let loadPromise: Promise<void> | null = null
  const gamePromises: Record<string, Promise<GameSettings>> = {}

  // idempotent global load; shared promise so concurrent calls read once
  async function ensureLoaded(): Promise<void> {
    if (loaded.value) return
    if (!loadPromise) {
      loadPromise = (async () => {
        Object.assign(global, await getGlobalSettings())
        loaded.value = true
      })().catch((e) => {
        loadPromise = null // failed load can be retried
        throw e
      })
    }
    return loadPromise
  }

  // idempotent per-game load; returns the reactive object in `games`
  async function ensureGame(game: string): Promise<GameSettings> {
    if (games[game]) return games[game]
    if (!gamePromises[game]) {
      gamePromises[game] = getGameSettings(game)
        .then((s) => {
          games[game] = s // deep-reactive via the reactive map
          return games[game]
        })
        .catch((e) => {
          delete gamePromises[game]
          throw e
        })
    }
    return gamePromises[game]
  }

  // ── global write-through setters ──
  async function setFavoriteGame(game: string): Promise<void> {
    global.favoriteGame = game
    await persistFavoriteGame(game)
  }

  async function setShowGamePicker(show: boolean): Promise<void> {
    global.showGamePicker = show
    await persistShowGamePicker(show)
  }

  async function setImageCacheLimitMb(mb: number): Promise<void> {
    const clamped = Math.max(0, Math.round(mb))
    global.imageCacheLimitMb = clamped
    await persistCacheLimit(clamped)
  }

  // ── per-game write-through setter ──
  async function setGameDefault(game: string, key: GameSettingKey, value: string): Promise<void> {
    const gs = await ensureGame(game)
    if (key === 'default_condition') gs.defaultCondition = value
    else if (key === 'default_language') gs.defaultLanguage = value
    await persistGameSetting(game, key, value)
  }

  // drop all in-memory state and reload (e.g. after an external change)
  async function reload(): Promise<void> {
    invalidateSettingsCache()
    loaded.value = false
    loadPromise = null
    for (const k of Object.keys(games)) delete games[k]
    for (const k of Object.keys(gamePromises)) delete gamePromises[k]
    await ensureLoaded()
  }

  return {
    global, // reactive GlobalSettings
    games, // reactive Record<game, GameSettings>
    loaded, // ref<boolean>
    ensureLoaded,
    ensureGame,
    setFavoriteGame,
    setShowGamePicker,
    setImageCacheLimitMb,
    setGameDefault,
    reload,
  }
})
