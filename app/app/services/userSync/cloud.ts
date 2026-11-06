import { useDatabase } from '~/composables/useDatabase'
import { DriveTransport } from './drive'
import { accessToken } from './google'
import { syncNow, type SyncReport } from './index'

// ============================================================
// Synchro avec le compte Google connecté (Drive, dossier caché).
// ============================================================

export interface LastSync {
  at: string
  changes: number // lignes modifiées dans la base locale
  conflicts: number
}

export async function syncWithGoogle(): Promise<SyncReport> {
  const report = await syncNow(new DriveTransport(() => accessToken()))
  const { user } = await useDatabase()
  const last: LastSync = {
    at: new Date().toISOString(),
    changes: report.applied.inserted + report.applied.updated + report.applied.deleted,
    conflicts: report.conflicts.length,
  }
  await user.execute(
    `INSERT INTO sync_state (key, value, updated_at) VALUES ('last_sync', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [JSON.stringify(last), last.at]
  )
  return report
}

export async function lastSync(): Promise<LastSync | null> {
  const { user } = await useDatabase()
  const rows = await user.select<{ value: string }[]>(
    `SELECT value FROM sync_state WHERE key = 'last_sync'`
  )
  return rows[0] ? (JSON.parse(rows[0].value) as LastSync) : null
}
