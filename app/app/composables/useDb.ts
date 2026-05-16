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
// ============================================================
 
interface DatabaseInstances {
  user: Database   // user.db  — collection, containers, decks
  ygo:  Database   // cards-ygo.db — reference card data (read-only)
}
 
let instance:    DatabaseInstances | null          = null
let initPromise: Promise<DatabaseInstances> | null = null
 
async function initDatabases(): Promise<DatabaseInstances> {
  const [user, ygo] = await Promise.all([
    Database.load(DB_NAMES.user),
    Database.load(DB_NAMES.ygo),
  ])
  return { user, ygo }
}
 
export async function useDatabase(): Promise<DatabaseInstances> {
  if (instance) return instance
 
  if (!initPromise) {
    initPromise = initDatabases()
      .then(dbs => {
        instance = dbs
        return dbs
      })
      .catch(err => {
        initPromise = null
        throw new Error(`Failed to initialize databases: ${err}`)
      })
  }
 
  return initPromise
}
 
export function resetDatabaseInstance(): void {
  instance    = null
  initPromise = null
}
