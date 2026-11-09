import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

// ============================================================
// Base SQLite en mémoire qui imite l'API de @tauri-apps/plugin-sql
// (select / execute avec paramètres positionnels `?`).
//
// Le schéma vient des VRAIES migrations de src-tauri/migrations/,
// appliquées dans l'ordre : impossible de diverger de la prod.
// Comme useDatabase.ts, on active foreign_keys par connexion.
// ============================================================

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../src-tauri/migrations', import.meta.url))

export interface QueryResult {
  rowsAffected: number
  lastInsertId?: number
}

export class TestDatabase {
  readonly raw: DatabaseSync
  /** requêtes passées par select/execute (dans l'appli, chacune est un aller-retour vers Rust) */
  queries = 0

  private readonly files: string[]
  private readonly dir: string

  /** `upTo` : n'applique que les migrations <= ce numéro (tester une migration sur données). */
  constructor(
    migrationSet: 'user' | 'ygo' | 'mtg' | { dir: string },
    opts: { upTo?: number } = {}
  ) {
    this.raw = new DatabaseSync(':memory:')
    this.raw.exec('PRAGMA foreign_keys = ON')
    this.dir =
      typeof migrationSet === 'string' ? join(MIGRATIONS_DIR, migrationSet) : migrationSet.dir
    this.files = readdirSync(this.dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    for (const file of this.files) {
      if (opts.upTo !== undefined && parseInt(file, 10) > opts.upTo) break
      this.raw.exec(readFileSync(join(this.dir, file), 'utf8'))
    }
  }

  /** Applique la migration numéro `n` (ex. 4 → 004_*.sql). */
  applyMigration(n: number): void {
    const file = this.files.find((f) => parseInt(f, 10) === n)
    if (!file) throw new Error(`migration ${n} introuvable`)
    this.raw.exec(readFileSync(join(this.dir, file), 'utf8'))
  }

  async select<T>(sql: string, params: unknown[] = []): Promise<T> {
    this.queries++
    return this.raw.prepare(sql).all(...(params as SQLInputValue[])) as T
  }

  async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    this.queries++
    const r = this.raw.prepare(sql).run(...(params as SQLInputValue[]))
    return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) }
  }

  close(): void {
    this.raw.close()
  }
}

export interface TestDatabases {
  user: TestDatabase
  ygo: TestDatabase
  mtg: TestDatabase
  // bases de cartes par jeu, comme useDatabase().cards(game)
  games: Map<string, TestDatabase>
  cards(game: string): TestDatabase
}

/** `user` / `ygo` : bases déjà créées (ex. une base user à une migration donnée). */
export function createTestDatabases(
  opts: { user?: TestDatabase; ygo?: TestDatabase; mtg?: TestDatabase } = {}
): TestDatabases {
  const ygo = opts.ygo ?? new TestDatabase('ygo')
  const mtg = opts.mtg ?? new TestDatabase('mtg')
  const games = new Map<string, TestDatabase>([
    ['ygo', ygo],
    ['mtg', mtg],
  ])
  return {
    user: opts.user ?? new TestDatabase('user'),
    ygo,
    mtg,
    games,
    cards(game: string) {
      const db = games.get(game)
      if (!db) throw new Error(`No card database for game "${game}"`)
      return db
    },
  }
}
