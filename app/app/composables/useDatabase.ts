import Database from '@tauri-apps/plugin-sql'
import { DB_NAMES } from '~/utils/db-names'

// ============================================================
// DATABASE CONNECTION MANAGER
// Opens both databases once and reuses the same connections.
// Every service imports this — never instantiates Database directly.
//
// The cached promise pattern guarantees that even if multiple
// services call useDatabase() simultaneously before init is done,
// only one initialization runs. All callers wait on the same promise.
//
// PRAGMAs that must NOT live in migration files (they cannot run
// inside the transaction that wraps each migration) are applied here,
// once per freshly opened connection:
//   - foreign_keys = ON  : enforce ON DELETE CASCADE etc. at runtime.
//                          This is per-connection and NOT persistent,
//                          so it must be set on every open.
// ============================================================

interface DatabaseInstances {
  user: Database // user.db   — collection, containers, decks
  ygo: Database // cards-ygo.db — reference card data (read-only)
}

let instance: DatabaseInstances | null = null
let initPromise: Promise<DatabaseInstances> | null = null

async function initDatabases(): Promise<DatabaseInstances> {
  const [user, ygo] = await Promise.all([Database.load(DB_NAMES.user), Database.load(DB_NAMES.ygo)])

  // Enforce foreign key constraints at runtime. SQLite defaults this OFF
  // per connection, and it is ignored inside a transaction — so it has to
  // be set here, right after opening, not in a migration. Best-effort:
  // a failure here should not prevent the app from working.
  await Promise.all([
    user.execute('PRAGMA foreign_keys = ON').catch(() => {}),
    ygo.execute('PRAGMA foreign_keys = ON').catch(() => {}),
  ])

  return { user, ygo }
}

export async function useDatabase(): Promise<DatabaseInstances> {
  if (instance) return instance
  if (!initPromise) {
    initPromise = initDatabases()
      .then((dbs) => {
        instance = dbs
        return dbs
      })
      .catch((err) => {
        initPromise = null
        throw new Error(`Failed to initialize databases: ${err}`)
      })
  }
  return initPromise
}

export function resetDatabaseInstance(): void {
  instance = null
  initPromise = null
}
