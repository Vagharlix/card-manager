import { useDatabase } from '~/composables/useDatabase'

// ============================================================
// TEST RESET PLUGIN  (test mode only)
//
// Exposes window.__resetTestDb() so E2E specs can wipe the user
// database between tests, guaranteeing each test starts clean.
// Only registered when VITE_TEST_MODE === 'true', so it never
// ships in dev or production builds.
//
// It empties every user table except migration bookkeeping, then
// the test recreates whatever state it needs.
// ============================================================

export default defineNuxtPlugin(() => {
  if (import.meta.env.VITE_TEST_MODE !== 'true') return

  // tables we must NOT wipe (migration tracking from tauri-plugin-sql)
  const PROTECTED = new Set(['_sqlx_migrations', 'sqlite_sequence'])

  async function resetTestDb(): Promise<void> {
    const { user } = await useDatabase()

    // discover all user tables dynamically
    const tables = await user.select<{ name: string }[]>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
    )

    // disable FK checks while wiping to avoid order issues
    await user.execute('PRAGMA foreign_keys = OFF')
    for (const t of tables) {
      if (PROTECTED.has(t.name)) continue
      await user.execute(`DELETE FROM ${t.name}`)
    }
    await user.execute('PRAGMA foreign_keys = ON')
  }

  // expose to the WebView global so WebdriverIO can call it via execute()
  ;(window as unknown as { __resetTestDb: () => Promise<void> }).__resetTestDb = resetTestDb
})
