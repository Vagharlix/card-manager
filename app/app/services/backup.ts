import { useDatabase } from '~/composables/useDatabase'
import { cardMetaOf } from '~/services/card/meta'
import { gameDefOrNull } from '~/services/game'
import { repairTables } from '~/services/userSync/merge'
import { applySnapshot, takeSnapshot, type Snapshot } from '~/services/userSync/snapshot'
import { USER_SCHEMA_VERSION, type Row } from '~/services/userSync/tables'
import { deviceId } from '~/services/userSync'

// ============================================================
// SAUVEGARDE de la collection, indépendante de Google :
//  - export complet (JSON) : mêmes tables que la synchro (collection,
//    rangements, decks, collections reçues, réglages partagés) ;
//  - import : remplace les données locales par celles du fichier ; l'état
//    d'avant est gardé et peut être restauré (« annuler ») ;
//  - export CSV de la collection, lisible dans un tableur ;
//  - restauration de l'état d'avant la dernière synchro / le dernier import.
// ============================================================

export const BACKUP_KIND = 'card-manager-backup'

export interface BackupFile extends Snapshot {
  kind: typeof BACKUP_KIND
}

export class BackupError extends Error {
  constructor(
    public readonly code: 'INVALID' | 'NEWER' | 'NOTHING',
    message: string
  ) {
    super(message)
  }
}

async function writeState(key: string, value: unknown) {
  const { user } = await useDatabase()
  await user.execute(
    `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), new Date().toISOString()]
  )
}

async function readState<T>(key: string): Promise<T | null> {
  const { user } = await useDatabase()
  const rows = await user.select<{ value: string }[]>(
    `SELECT value FROM sync_state WHERE key = ?`,
    [key]
  )
  return rows[0] ? (JSON.parse(rows[0].value) as T) : null
}

export async function exportBackup(): Promise<string> {
  const { user } = await useDatabase()
  const snap = await takeSnapshot(user, await deviceId(user))
  const file: BackupFile = { kind: BACKUP_KIND, ...snap }
  return JSON.stringify(file)
}

export function parseBackup(text: string): BackupFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new BackupError('INVALID', 'This file is not a card-manager backup')
  }
  const f = data as Partial<BackupFile>
  if (!f || f.kind !== BACKUP_KIND || typeof f.tables !== 'object' || !f.tables)
    throw new BackupError('INVALID', 'This file is not a card-manager backup')
  if ((f.schema ?? 0) > USER_SCHEMA_VERSION)
    throw new BackupError(
      'NEWER',
      'This backup comes from a newer version of the app: update it first'
    )
  return f as BackupFile
}

export interface ImportStats {
  cards: number // exemplaires dans le fichier
  inserted: number
  updated: number
  deleted: number
}

/** Remplace les données locales par la sauvegarde ; l'état d'avant reste restaurable. */
export async function importBackup(text: string): Promise<ImportStats> {
  const file = parseBackup(text)
  const { user } = await useDatabase()
  const local = await takeSnapshot(user, await deviceId(user))
  const target = repairTables(file.tables).tables
  await writeState('backup', local)
  const s = await applySnapshot(user, local.tables, target)
  return {
    cards: (target.collection ?? []).filter((r) => r.deleted_at == null).length,
    ...s,
  }
}

export interface RestorePoint {
  createdAt: string
}

/** État gardé avant la dernière synchro ou le dernier import. */
export async function restorePoint(): Promise<RestorePoint | null> {
  const b = await readState<Snapshot>('backup')
  return b ? { createdAt: b.createdAt } : null
}

/** Revient à cet état ; l'état actuel le remplace (on peut donc refaire). */
export async function restoreLastBackup(): Promise<void> {
  const backup = await readState<Snapshot>('backup')
  if (!backup) throw new BackupError('NOTHING', 'Nothing to restore')
  const { user } = await useDatabase()
  const current = await takeSnapshot(user, await deviceId(user))
  await applySnapshot(user, current.tables, repairTables(backup.tables).tables)
  await writeState('backup', current)
}

// ── CSV ──
const CSV_COLUMNS = [
  'game',
  'card_id',
  'name',
  'set_code',
  'rarity',
  'first_edition',
  'language',
  'condition',
  'quantity',
  'for_trade',
  'foil',
  'notes',
] as const

export function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Une ligne par exemplaire (pile) de la collection, avec le nom de la carte. */
export async function exportCollectionCsv(): Promise<string> {
  const { user } = await useDatabase()
  const entries = await user.select<Row[]>(
    `SELECT game, card_id, printing_id, rarity, first_edition, language, condition,
            quantity, trade_qty, foil, notes
     FROM collection WHERE deleted_at IS NULL ORDER BY game, card_id, created_at`
  )
  // noms depuis la base de cartes de chaque jeu (jeu inconnu de cette
  // version : colonne vide)
  const names = new Map<string, string>()
  for (const game of new Set(entries.map((e) => String(e.game)))) {
    if (!gameDefOrNull(game)) continue
    const meta = await cardMetaOf(
      game,
      entries.filter((e) => String(e.game) === game).map((e) => String(e.card_id))
    )
    for (const m of meta.values()) names.set(`${game}:${m.id}`, m.name)
  }
  const lines = [CSV_COLUMNS.join(',')]
  for (const e of entries) {
    lines.push(
      [
        e.game,
        e.card_id,
        names.get(`${e.game}:${e.card_id}`) ?? '',
        e.printing_id,
        e.rarity,
        e.first_edition ? 'yes' : '',
        e.language,
        e.condition,
        e.quantity,
        e.trade_qty,
        e.foil ? 'yes' : '',
        e.notes,
      ]
        .map(csvCell)
        .join(',')
    )
  }
  return lines.join('\r\n') + '\r\n'
}

export function backupFileName(kind: 'json' | 'csv', date = new Date()): string {
  const d = date.toISOString().slice(0, 10)
  return kind === 'json' ? `card-manager-backup-${d}.json` : `card-manager-collection-${d}.csv`
}
