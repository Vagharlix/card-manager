import Database from '@tauri-apps/plugin-sql'
import { activateUserWrites, noteUserWrite, UNCOUNTED } from '~/utils/userWrites'
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

// Une requête à la fois par base. tauri-plugin-sql ouvre une connexion de
// plus dès que deux requêtes partent en même temps (jusqu'à 10) et prête
// les connexions libres à tour de rôle (file FIFO de sqlx) : les commandes
// d'une transaction (BEGIN … COMMIT, synchro, sauvegarde, imports de cartes)
// tombaient alors sur des connexions différentes → « cannot start a
// transaction within a transaction », « database is locked », « cannot
// commit - no transaction is active ». En sérialisant, le pool garde une
// seule connexion. SQLite n'écrit de toute façon qu'une chose à la fois ;
// le coût est négligeable devant l'aller-retour WebView → Rust.
// Une requête lancée par ailleurs pendant une transaction passe sur la même
// connexion, donc dans la transaction (lectures : voient l'état en cours).
//
// onWrite (user.db) : chaque execute est compté (utils/userWrites), sauf via
// `uncounted(db)` (utils/userWrites) — même file d'attente, écritures de la synchro elle-même.
function serialized(db: Database, onWrite?: () => void): Database {
  let tail: Promise<unknown> = Promise.resolve()
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn)
    tail = next.catch(() => {})
    return next
  }
  const wrap = (count: boolean): Database =>
    new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === UNCOUNTED) return count ? quiet : receiver
        if (prop === 'select' || prop === 'execute') {
          const method = Reflect.get(target, prop, receiver) as (...a: unknown[]) => Promise<unknown>
          return (...args: unknown[]) => {
            if (count && prop === 'execute') onWrite?.()
            return run(() => method.apply(target, args))
          }
        }
        return Reflect.get(target, prop, receiver)
      },
    })
  const quiet = wrap(false)
  return wrap(true)
}


let instance: DatabaseInstances | null = null
let initPromise: Promise<DatabaseInstances> | null = null

async function initDatabases(): Promise<DatabaseInstances> {
  const games = allGames()
  const [rawUser, ...rawCards] = await Promise.all([
    Database.load(DB_NAMES.user),
    ...games.map((g) => Database.load(cardDbName(g.cardDb))),
  ])
  const user = serialized(rawUser, noteUserWrite)
  activateUserWrites()
  const cardDbs = rawCards.map((db) => serialized(db)) // écritures non comptées

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
