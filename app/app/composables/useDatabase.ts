import Database from '@tauri-apps/plugin-sql'
import { DB_NAMES, cardDbName } from '~/utils/db-names'
import { allGames } from '~/services/game'

// ============================================================
// DATABASE CONNECTION MANAGER
// Opens user.db + the card database of every registered game, once,
// and reuses the same connections.
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

export interface DatabaseInstances {
  user: Database // user.db — collection, containers, decks
  // base de cartes d'un jeu (référence, lecture seule) : seul point d'accès
  // aux données d'un jeu. Les couches génériques n'y lisent que le contrat
  // commun (cards, printings, printing_rarities, vues card_meta / card_legality).
  cards(game: string): Database
}

let instance: DatabaseInstances | null = null
let initPromise: Promise<DatabaseInstances> | null = null

async function initDatabases(): Promise<DatabaseInstances> {
  const games = allGames()
  const [user, ...cardDbs] = await Promise.all([
    Database.load(DB_NAMES.user),
    ...games.map((g) => Database.load(cardDbName(g.cardDb))),
  ])

  // Enforce foreign key constraints at runtime. SQLite defaults this OFF
  // per connection, and it is ignored inside a transaction — so it has to
  // be set here, right after opening, not in a migration. Best-effort:
  // a failure here should not prevent the app from working.
  await Promise.all(
    [user, ...cardDbs].map((db) => db.execute('PRAGMA foreign_keys = ON').catch(() => {}))
  )

  const byGame = new Map(games.map((g, i) => [g.id, cardDbs[i]!]))
  return {
    user,
    cards(game: string) {
      const db = byGame.get(game)
      if (!db) throw new Error(`No card database for game "${game}"`)
      return db
    },
  }
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
