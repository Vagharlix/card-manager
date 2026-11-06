import { useDatabase } from '~/composables/useDatabase'
import { mergeTables, repairTables, type SyncConflict } from './merge'
import {
  SYNC_PROTOCOL,
  applySnapshot,
  sameTables,
  takeSnapshot,
  type ApplyStats,
  type Snapshot,
  type SyncDb,
} from './snapshot'
import { USER_SCHEMA_VERSION } from './tables'

// ============================================================
// SYNCHRO ENTRE APPAREILS (PC ↔ téléphone) — orchestration
//
// Un seul état publié (instantané de user.db) chez un transport (Google
// Drive en vrai, mémoire en test). À chaque synchro :
//   1. instantané local + base (dernière synchro réussie) + état publié
//   2. fusion à trois, puis réparation des règles de l'appli
//   3. sauvegarde de l'état local, puis application de la fusion
//   4. publication conditionnelle : refusée si un autre appareil a publié
//      entre-temps → on recommence (rien n'est écrasé)
//   5. la fusion devient la nouvelle base
// ============================================================

export interface PublishedState {
  snapshot: Snapshot
  /** identifiant de version opaque (ETag Drive…) pour l'écriture conditionnelle */
  version: string
}

export interface SyncTransport {
  pull(): Promise<PublishedState | null>
  /** false si l'état publié n'est plus `expectedVersion` (un autre appareil a écrit) */
  push(snapshot: Snapshot, expectedVersion: string | null): Promise<boolean>
}

export class SyncError extends Error {
  constructor(
    public readonly code: 'REMOTE_NEWER' | 'PROTOCOL' | 'BUSY',
    message: string
  ) {
    super(message)
  }
}

export interface SyncReport {
  pulled: boolean // un état publié existait
  pushed: boolean // nous avons publié
  applied: ApplyStats // changements écrits dans la base locale
  conflicts: SyncConflict[]
  fixes: number
  attempts: number
}

// ── état local (table sync_state, jamais synchronisée) ──
async function readState<T>(db: SyncDb, key: string): Promise<T | null> {
  const rows = await db.select<{ value: string }[]>(`SELECT value FROM sync_state WHERE key = ?`, [
    key,
  ])
  return rows[0] ? (JSON.parse(rows[0].value) as T) : null
}

async function writeState(db: SyncDb, key: string, value: unknown): Promise<void> {
  await db.execute(
    `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), new Date().toISOString()]
  )
}

export async function deviceId(db: SyncDb): Promise<string> {
  const existing = await readState<string>(db, 'device_id')
  if (existing) return existing
  const id = crypto.randomUUID()
  await writeState(db, 'device_id', id)
  return id
}

/** Sauvegarde de la base locale prise juste avant la dernière fusion. */
export async function lastBackup(): Promise<Snapshot | null> {
  const { user } = await useDatabase()
  return readState<Snapshot>(user, 'backup')
}

/** Oublie la synchro (déconnexion) : la prochaine repart d'une union. */
export async function forgetSyncBase(): Promise<void> {
  const { user } = await useDatabase()
  await user.execute(`DELETE FROM sync_state WHERE key IN ('base', 'backup')`)
}

let running = false

export async function syncNow(transport: SyncTransport, maxAttempts = 4): Promise<SyncReport> {
  if (running) throw new SyncError('BUSY', 'Une synchronisation est déjà en cours')
  running = true
  try {
    const { user } = await useDatabase()
    const me = await deviceId(user)
    const applied: ApplyStats = { inserted: 0, updated: 0, deleted: 0 }
    const conflicts: SyncConflict[] = []
    let fixes = 0

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const local = await takeSnapshot(user, me)
      const base = await readState<Snapshot>(user, 'base')
      const remote = await transport.pull()

      if (remote) {
        if (remote.snapshot.protocol !== SYNC_PROTOCOL)
          throw new SyncError('PROTOCOL', 'Format de synchronisation inconnu')
        if (remote.snapshot.schema > USER_SCHEMA_VERSION)
          throw new SyncError(
            'REMOTE_NEWER',
            "Un autre appareil utilise une version plus récente de l'appli : mets-la à jour ici"
          )
      }

      const merged = remote
        ? mergeTables(base?.tables ?? null, local.tables, remote.snapshot.tables)
        : { tables: local.tables, conflicts: [] }
      const repaired = repairTables(merged.tables, remote?.snapshot.tables)
      conflicts.push(...merged.conflicts)
      fixes += repaired.fixes

      const next: Snapshot = {
        ...local,
        createdAt: new Date().toISOString(),
        tables: repaired.tables,
      }

      if (!sameTables(local.tables, next.tables)) {
        await writeState(user, 'backup', local) // de quoi revenir en arrière
        const s = await applySnapshot(user, local.tables, next.tables)
        applied.inserted += s.inserted
        applied.updated += s.updated
        applied.deleted += s.deleted
      }

      // rien de neuf à publier : l'état publié est déjà le bon
      const upToDate = remote && sameTables(remote.snapshot.tables, next.tables)
      const pushed = upToDate ? true : await transport.push(next, remote?.version ?? null)
      if (pushed) {
        await writeState(user, 'base', next)
        return {
          pulled: !!remote,
          pushed: !upToDate,
          applied,
          conflicts,
          fixes,
          attempts: attempt,
        }
      }
      // un autre appareil a publié entre-temps : on refusionne avec son état
    }
    throw new SyncError('BUSY', 'Synchronisation impossible : un autre appareil publie en continu')
  } finally {
    running = false
  }
}

// ── transport en mémoire : tests, et modèle pour le transport Drive ──
export class MemoryTransport implements SyncTransport {
  private state: PublishedState | null = null
  private seq = 0
  /** appelé entre pull et push : simule un autre appareil qui publie */
  beforePush?: () => void

  async pull(): Promise<PublishedState | null> {
    return this.state ? structuredClone(this.state) : null
  }

  async push(snapshot: Snapshot, expectedVersion: string | null): Promise<boolean> {
    this.beforePush?.()
    if ((this.state?.version ?? null) !== expectedVersion) return false
    this.state = { snapshot: structuredClone(snapshot), version: `v${++this.seq}` }
    return true
  }

  /** écriture directe (autre appareil, ancienne version…) */
  publish(snapshot: Snapshot) {
    this.state = { snapshot: structuredClone(snapshot), version: `v${++this.seq}` }
  }

  get published() {
    return this.state
  }
}

export type { Snapshot, SyncConflict, ApplyStats }
