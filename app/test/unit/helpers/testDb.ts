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

  constructor(migrationSet: 'user' | 'ygo') {
    this.raw = new DatabaseSync(':memory:')
    this.raw.exec('PRAGMA foreign_keys = ON')
    const dir = join(MIGRATIONS_DIR, migrationSet)
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      this.raw.exec(readFileSync(join(dir, file), 'utf8'))
    }
  }

  async select<T>(sql: string, params: unknown[] = []): Promise<T> {
    return this.raw.prepare(sql).all(...(params as SQLInputValue[])) as T
  }

  async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
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
