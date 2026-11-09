import { invoke } from '@tauri-apps/api/core'
import { useDatabase } from '~/composables/useDatabase'
import { syncProgress, syncStatus, syncError, isSyncing } from '~/services/cardDataProgress'
import {
  SCRYFALL_KEYS,
  betterPrint,
  legalityRows,
  mapCard,
  oracleColumns,
  printColumns,
  type OracleRow,
  type PrintRow,
  type ScryfallCard,
} from './import'

// ============================================================
// MISE À JOUR DE LA BASE MAGIC depuis Scryfall.
//  1. métadonnées du fichier « default_cards » (version = updated_at) ;
//  2. téléchargement en flux par Rust (card_data.rs : JSONL gzip, ~80 Mo),
//     tiré lot par lot : on n'a jamais tout le fichier en mémoire ;
//  3. écriture dans une transaction (l'ancienne base reste lisible jusqu'au
//     COMMIT), cartes logiques et légalités à la fin, index plein texte.
// Au lancement (auto) : pas plus d'une fois tous les AUTO_DAYS jours, et
// sans réseau si la base est assez récente ; « Check for updates » vérifie
// toujours ; « Force » retélécharge.
// ============================================================

const META_URL = 'https://api.scryfall.com/bulk-data/default-cards'
export const AUTO_DAYS = 14

type CardDb = import('@tauri-apps/plugin-sql').default

interface BulkMeta {
  updated_at: string
  jsonl_download_uri?: string
  download_uri?: string
}

interface Batch {
  items: ScryfallCard[]
  read: number
  total: number | null
  done: boolean
}

function setProgress(value: number, status: string) {
  syncProgress.value = value
  syncStatus.value = status
}

async function meta(db: CardDb, key: string): Promise<string | null> {
  const rows = await db.select<{ value: string }[]>(`SELECT value FROM sync_meta WHERE key = ?`, [
    key,
  ])
  return rows[0]?.value ?? null
}

export async function localMtgVersion(): Promise<string | null> {
  return meta((await useDatabase()).cards('mtg'), 'db_version')
}

async function insertRows(
  db: CardDb,
  table: string,
  columns: string[],
  rows: unknown[][],
  chunk: number
): Promise<void> {
  const one = `(${columns.map(() => '?').join(', ')})`
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk)
    await db.execute(
      `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES ${part.map(() => one).join(', ')}`,
      part.flat()
    )
  }
}

const CARD_COLS = ['id', 'name', 'image_url', 'image_url_small', 'image_url_cropped', 'legal_text']
const PRINT_COLS = [
  'card_id',
  'oracle_id',
  'set_code',
  'set_name',
  'set_type',
  'collector_number',
  'rarity',
  'released_at',
  'lang',
  'layout',
  'finishes',
  'artist',
  'illustration_id',
]
const META_COLS = ['card_id', 'root', 'type']
const ORACLE_COLS = [
  'oracle_id',
  'name',
  'default_print',
  'mana_cost',
  'cmc',
  'type_line',
  'oracle_text',
  'power',
  'toughness',
  'loyalty',
  'defense',
  'colors',
  'color_identity',
  'keywords',
  'reserved',
  'deck_limit',
]

export interface ImportStats {
  prints: number
  cards: number
  skipped: number
}

// écrit tout le contenu d'une source de lots (flux Rust, ou tableau en test)
export async function importMtg(
  db: CardDb,
  next: () => Promise<Batch>,
  version: string
): Promise<ImportStats> {
  const oracles = new Map<string, { row: OracleRow; best: PrintRow }>()
  let prints = 0
  let skipped = 0

  await db.execute('PRAGMA foreign_keys = OFF')
  await db.execute('BEGIN TRANSACTION')
  try {
    for (const t of ['card_legality', 'card_meta', 'mtg_prints', 'mtg_oracle', 'cards'])
      await db.execute(`DELETE FROM ${t}`)

    for (;;) {
      const batch = await next()
      const cards: unknown[][] = []
      const printRows: unknown[][] = []
      const metaRows: unknown[][] = []
      for (const raw of batch.items) {
        const m = mapCard(raw)
        if (!m) {
          skipped++
          continue
        }
        const cols = printColumns(m.print)
        cards.push(cols.card)
        printRows.push(cols.print)
        metaRows.push(cols.meta)
        const seen = oracles.get(m.print.oracleId)
        if (!seen) oracles.set(m.print.oracleId, { row: m.oracle, best: m.print })
        else if (betterPrint(m.print, seen.best)) seen.best = m.print
      }
      await insertRows(db, 'cards', CARD_COLS, cards, 500)
      await insertRows(db, 'mtg_prints', PRINT_COLS, printRows, 500)
      await insertRows(db, 'card_meta', META_COLS, metaRows, 500)
      prints += printRows.length
      const pct = batch.total ? Math.min(1, batch.read / batch.total) : 0
      setProgress(5 + Math.round(pct * 80), `Importing cards… ${prints.toLocaleString('en')}`)
      if (batch.done) break
    }

    setProgress(86, 'Writing rules and legalities…')
    const all = [...oracles.values()]
    await insertRows(
      db,
      'mtg_oracle',
      ORACLE_COLS,
      all.map((o) => oracleColumns(o.row, o.best.id)),
      300
    )
    await insertRows(
      db,
      'card_legality',
      ['card_id', 'format', 'status'],
      all.flatMap((o) => legalityRows(o.row)),
      500
    )
    setProgress(95, 'Building the search index…')
    await db.execute(`INSERT INTO mtg_oracle_fts(mtg_oracle_fts) VALUES ('rebuild')`)
    for (const [key, value] of [
      ['db_version', version],
      ['synced_at', new Date().toISOString()],
    ])
      await db.execute(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)`, [key, value])
    await db.execute('COMMIT')
  } catch (err) {
    await db.execute('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await db.execute('PRAGMA foreign_keys = ON').catch(() => {})
  }
  return { prints, cards: oracles.size, skipped }
}

// assez récente pour une mise à jour automatique ?
export function recentEnough(syncedAt: string | null, now = Date.now()): boolean {
  if (!syncedAt) return false
  const t = Date.parse(syncedAt)
  return Number.isFinite(t) && now - t < AUTO_DAYS * 86_400_000
}

export async function syncMtg(options: { force?: boolean; auto?: boolean } = {}): Promise<void> {
  if (isSyncing.value) return
  const db = (await useDatabase()).cards('mtg')
  const local = await meta(db, 'db_version')
  // au lancement, une base récente ne coûte même pas une requête
  if (options.auto && local && recentEnough(await meta(db, 'synced_at'))) return

  isSyncing.value = true
  syncError.value = null
  setProgress(0, 'Checking for updates…')
  let stream: number | null = null
  try {
    const info = JSON.parse(await invoke<string>('card_data_get', { url: META_URL })) as BulkMeta
    const url = info.jsonl_download_uri ?? info.download_uri
    if (!url) throw new Error('No Scryfall download available')
    if (!options.force && local === info.updated_at) {
      // déjà à jour : on note la vérification pour espacer les suivantes
      await db.execute(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('synced_at', ?)`, [
        new Date().toISOString(),
      ])
      setProgress(100, 'Already up to date')
      return
    }

    setProgress(2, 'Downloading card data…')
    const opened = await invoke<{ id: number; total: number | null }>('jsonl_open', {
      url,
      keys: SCRYFALL_KEYS,
    })
    stream = opened.id
    const id = opened.id
    await importMtg(db, () => invoke<Batch>('jsonl_next', { id }), info.updated_at)
    stream = null
    setProgress(100, 'Sync complete')
  } catch (err) {
    syncError.value = err instanceof Error ? err.message : String(err)
    setProgress(0, 'Sync failed')
    throw err
  } finally {
    if (stream !== null) await invoke('jsonl_close', { id: stream }).catch(() => {})
    isSyncing.value = false
  }
}
