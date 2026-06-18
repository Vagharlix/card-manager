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

  ;(window as any).__seedOwned = async (cardId: string, qty = 1) => {
    const { user } = await useDatabase()

    const cols = await user.select(`PRAGMA table_info(collection)`)
    const colNames = cols.map((c: any) => c.name)

    const id =
      (globalThis.crypto?.randomUUID?.() as string) ||
      `seed-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const nowIso = new Date().toISOString()

    const values: Record<string, unknown> = {
      id,
      card_id: cardId,
      game: 'ygo',
      quantity: qty,
    }
    if (colNames.includes('condition')) values.condition = 'NM'
    if (colNames.includes('language')) values.language = 'en'
    if (colNames.includes('printing_id')) values.printing_id = null
    if (colNames.includes('created_at')) values.created_at = nowIso
    if (colNames.includes('updated_at')) values.updated_at = nowIso
    if (colNames.includes('deleted_at')) values.deleted_at = null

    for (const c of cols as any[]) {
      if (c.notnull === 1 && c.dflt_value === null && !(c.name in values)) {
        values[c.name] = ''
      }
    }

    const keys = Object.keys(values)
    const placeholders = keys.map(() => '?').join(', ')
    const params = keys.map((k) => values[k])
    await user.execute(
      `INSERT INTO collection (${keys.join(', ')}) VALUES (${placeholders})`,
      params
    )
    return { id, cardId, qty, columns: colNames }
  }

  // expose to the WebView global so WebdriverIO can call it via execute()
  ;(window as unknown as { __resetTestDb: () => Promise<void> }).__resetTestDb = resetTestDb
})
