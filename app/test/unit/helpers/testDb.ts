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
  constructor(migrationSet: 'user' | 'ygo', opts: { upTo?: number } = {}) {
    this.raw = new DatabaseSync(':memory:')
    this.raw.exec('PRAGMA foreign_keys = ON')
    this.dir = join(MIGRATIONS_DIR, migrationSet)
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
}

export function createTestDatabases(): TestDatabases {
  return { user: new TestDatabase('user'), ygo: new TestDatabase('ygo') }
}
