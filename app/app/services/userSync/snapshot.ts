import {
  SYNC_TABLES,
  USER_SCHEMA_VERSION,
  indexRows,
  keyOf,
  sameRow,
  sameValue,
  type Row,
  type Tables,
} from './tables'

// ============================================================
// INSTANTANÉ de user.db (tables synchronisées) et application d'un
// instantané cible sur la base locale, en une transaction.
// ============================================================

export const SYNC_PROTOCOL = 1

export interface Snapshot {
  protocol: number
  schema: number // USER_SCHEMA_VERSION de l'appli qui l'a écrit
  deviceId: string
  createdAt: string
  tables: Tables
}

/** Ce dont la synchro a besoin d'une base (plugin-sql en vrai, SQLite mémoire en test). */
export interface SyncDb {
  select<T>(sql: string, params?: unknown[]): Promise<T>
  execute(sql: string, params?: unknown[]): Promise<unknown>
}

export async function takeSnapshot(db: SyncDb, deviceId: string): Promise<Snapshot> {
  const tables: Tables = {}
  for (const t of SYNC_TABLES) {
    const rows = await db.select<Row[]>(`SELECT * FROM ${t.name}`)
    tables[t.name] = rows
      .filter((r) => !t.include || t.include(r))
      .sort((a, b) => (keyOf(t, a) < keyOf(t, b) ? -1 : 1))
  }
  return {
    protocol: SYNC_PROTOCOL,
    schema: USER_SCHEMA_VERSION,
    deviceId,
    createdAt: new Date().toISOString(),
    tables,
  }
}

export function sameTables(a: Tables, b: Tables): boolean {
  for (const t of SYNC_TABLES) {
    const A = indexRows(t, a[t.name])
    const B = indexRows(t, b[t.name])
    if (A.size !== B.size) return false
    for (const [k, row] of A) {
      const other = B.get(k)
      if (!other || !sameRow(row, other)) return false
    }
  }
  return true
}

export interface ApplyStats {
  inserted: number
  updated: number
  deleted: number
}

const IDENT = /^[a-z_][a-z0-9_]*$/

/**
 * Amène la base de `current` à `target`. Les noms de colonnes viennent en
 * partie d'un fichier distant : seules les colonnes qui existent localement
 * sont écrites (et jamais interpolées sans vérification).
 */
export async function applySnapshot(
  db: SyncDb,
  current: Tables,
  target: Tables
): Promise<ApplyStats> {
  const stats: ApplyStats = { inserted: 0, updated: 0, deleted: 0 }

  const columns = new Map<string, Set<string>>()
  for (const t of SYNC_TABLES) {
    const info = await db.select<{ name: string }[]>(`PRAGMA table_info(${t.name})`)
    columns.set(t.name, new Set(info.map((c) => c.name).filter((c) => IDENT.test(c))))
  }
  const known = (table: string, row: Row) =>
    Object.keys(row).filter((c) => columns.get(table)!.has(c))

  const whereKey = (key: string[]) => key.map((c) => `${c} = ?`).join(' AND ')
  const del = (table: string, key: string[], row: Row) =>
    db.execute(
      `DELETE FROM ${table} WHERE ${whereKey(key)}`,
      key.map((c) => row[c])
    )
  const ins = (table: string, row: Row) => {
    const cols = known(table, row)
    return db.execute(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => row[c])
    )
  }

  await db.execute('BEGIN TRANSACTION')
  try {
    // suppressions : enfants d'abord
    for (const t of [...SYNC_TABLES].reverse()) {
      const T = indexRows(t, target[t.name])
      for (const row of current[t.name] ?? []) {
        if (!T.has(keyOf(t, row))) {
          await del(t.name, t.key, row)
          stats.deleted++
        }
      }
    }
    // insertions et modifications : parents d'abord
    for (const t of SYNC_TABLES) {
      const C = indexRows(t, current[t.name])
      const replaced: Row[] = []
      for (const row of target[t.name] ?? []) {
        const cur = C.get(keyOf(t, row))
        if (!cur) {
          await ins(t.name, row)
          stats.inserted++
        } else if (!sameRow(cur, row)) {
          if (t.replaceOnUpdate) {
            replaced.push(row)
            continue
          }
          const changed = known(t.name, row).filter((c) => !sameValue(cur[c], row[c]))
          if (!changed.length) continue
          await db.execute(
            `UPDATE ${t.name} SET ${changed.map((c) => `${c} = ?`).join(', ')} WHERE ${whereKey(t.key)}`,
            [...changed.map((c) => row[c]), ...t.key.map((c) => row[c])]
          )
          stats.updated++
        }
      }
      // contrainte d'unicité secondaire : tout libérer avant de tout réécrire
      for (const row of replaced) await del(t.name, t.key, row)
      for (const row of replaced) {
        await ins(t.name, row)
        stats.updated++
      }
    }
    await db.execute('COMMIT')
  } catch (e) {
    await db.execute('ROLLBACK')
    throw e
  }
  return stats
}
