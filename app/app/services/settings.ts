import { useDatabase } from '~/composables/useDatabase'

// ============================================================
// SETTINGS SERVICE
// Key-value preferences stored in user.db.
// Cached in memory after first read; writes update both.
// ============================================================

// known setting keys + their default if the row is somehow missing
const DEFAULTS: Record<string, string> = {
  favorite_game: '',
  show_game_picker: 'true',
  default_condition: 'NM',
  default_language: 'en',
  image_cache_limit_mb: '200',
}

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

export async function getSetting(key: string): Promise<string> {
  const all = await loadAll()
  return all[key] ?? DEFAULTS[key] ?? ''
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
