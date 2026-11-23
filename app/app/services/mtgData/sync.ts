import { invoke } from '@tauri-apps/api/core'
import { useDatabase } from '~/composables/useDatabase'
import {
  syncProgress,
  syncStatus,
  syncError,
  isSyncing,
  syncBlocking,
} from '~/services/cardDataProgress'
import type { CardDataReport } from '~/services/game/modules'
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
// MISE À JOUR DE LA BASE MAGIC depuis Scryfall — incrémentale.
// Scryfall publie ses fichiers en masse chaque jour, sans « modifié depuis » :
// tout retélécharger (~80 Mo) à chaque fois serait du gaspillage. Donc :
//  - import COMPLET (default_cards, ~80 Mo, flux Rust tiré lot par lot) à
//    l'installation, sur « Force », si la base l'exige (needs_full, ex. après
//    la migration mtg 002) et tous les FULL_DAYS jours (rattrape les rares
//    impressions ajoutées tard, ou seulement dans une autre langue, et retire
//    celles que Scryfall a supprimées) ;
//  - sinon, mise à jour INCRÉMENTALE :
//    1. nouvelles impressions : recherche Scryfall des cartes sorties (ou
//       annoncées) depuis la dernière mise à jour (moins MARGIN_DAYS, au
//       plus RECENT_DAYS), pages de 175 (~1 600 sur 4 semaines) ;
//    2. règles et légalités (errata, bannissements, rotations) : fichier
//       oracle_cards (~25 Mo, une ligne par carte) au plus tous les
//       ORACLE_DAYS jours ;
//    3. impression par défaut recalculée pour les cartes touchées, index
//       plein texte reconstruit.
// Au lancement (auto) : rien avant AUTO_DAYS jours (pas même une requête).
// Tout s'écrit dans une transaction : l'ancienne base reste lisible, et la
// mise à jour se fait en arrière-plan (sauf la 1re installation).
// ============================================================

const META_URL = 'https://api.scryfall.com/bulk-data/default-cards'
const ORACLE_META_URL = 'https://api.scryfall.com/bulk-data/oracle-cards'
const SEARCH_URL = 'https://api.scryfall.com/cards/search'
export const AUTO_DAYS = 7
export const ORACLE_DAYS = 30
export const FULL_DAYS = 90
// fenêtre des nouvelles impressions : depuis la dernière mise à jour, avec
// MARGIN_DAYS de marge (cartes ajoutées un peu après leur sortie), au plus
// RECENT_DAYS ; les cartes annoncées (sortie future) y sont toujours
export const RECENT_DAYS = 60
export const MARGIN_DAYS = 21
// Scryfall demande 50 à 100 ms entre deux requêtes
const SEARCH_DELAY_MS = 120
const DAY_MS = 86_400_000

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
  'promo',
  'variation',
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
    const now = new Date().toISOString()
    for (const [key, value] of [
      ['db_version', version],
      ['synced_at', now],
      ['full_at', now],
      ['oracle_at', now],
    ])
      await db.execute(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)`, [key, value])
    await db.execute(`DELETE FROM sync_meta WHERE key = 'needs_full'`)
    await db.execute('COMMIT')
  } catch (err) {
    await db.execute('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await db.execute('PRAGMA foreign_keys = ON').catch(() => {})
  }
  return { prints, cards: oracles.size, skipped }
}

// date ISO assez récente ? (days jours)
export function recentEnough(at: string | null, now = Date.now(), days = AUTO_DAYS): boolean {
  if (!at) return false
  const t = Date.parse(at)
  return Number.isFinite(t) && now - t < days * DAY_MS
}

// ── mise à jour incrémentale ────────────────────────────────

export interface IncrementalSources {
  // pages de la recherche Scryfall des impressions sorties depuis `since`
  recentPrints(since: string): AsyncIterable<ScryfallCard[]>
  // lots du fichier oracle_cards (absent = pas de rafraîchissement des règles)
  oracleBatches?: () => Promise<Batch>
}

export interface IncrementalStats {
  newPrints: number // impressions qui n'existaient pas
  updatedPrints: number // impressions récentes réécrites (déjà connues)
  oracleRefreshed: boolean
}

// impression → ligne comparable par betterPrint (depuis la base)
interface PrintDbRow {
  card_id: string
  oracle_id: string
  set_type: string | null
  collector_number: string
  promo: number
  variation: number
  lang: string | null
  released_at: string | null
}

function asPrintRow(r: PrintDbRow): PrintRow {
  return {
    id: r.card_id,
    oracleId: r.oracle_id,
    name: '',
    setCode: '',
    setName: '',
    setType: r.set_type,
    collectorNumber: r.collector_number,
    rarity: null,
    releasedAt: r.released_at,
    lang: r.lang,
    layout: null,
    finishes: '',
    artist: null,
    illustrationId: null,
    typeLine: null,
    promo: !!r.promo,
    variation: !!r.variation,
  }
}

const IN_CHUNK = 400

async function existingIds(db: CardDb, table: string, column: string, ids: string[]) {
  const out = new Set<string>()
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const part = ids.slice(i, i + IN_CHUNK)
    const rows = await db.select<{ id: string }[]>(
      `SELECT ${column} AS id FROM ${table} WHERE ${column} IN (${part.map(() => '?').join(', ')})`,
      part
    )
    for (const r of rows) out.add(r.id)
  }
  return out
}

// règles d'une carte logique, sans toucher à son impression par défaut
async function upsertOracles(db: CardDb, rows: OracleRow[]) {
  const cols = ORACLE_COLS.filter((c) => c !== 'default_print')
  const one = `(${cols.map(() => '?').join(', ')}, (SELECT default_print FROM mtg_oracle WHERE oracle_id = ?))`
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200)
    await db.execute(
      `INSERT OR REPLACE INTO mtg_oracle (${cols.join(', ')}, default_print) VALUES ${part.map(() => one).join(', ')}`,
      part.flatMap((o) => {
        const all = oracleColumns(o, '')
        return [...all.filter((_, k) => ORACLE_COLS[k] !== 'default_print'), o.oracleId]
      })
    )
  }
}

async function replaceLegalities(db: CardDb, rows: OracleRow[]) {
  const ids = rows.map((o) => o.oracleId)
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const part = ids.slice(i, i + IN_CHUNK)
    await db.execute(
      `DELETE FROM card_legality WHERE card_id IN (${part.map(() => '?').join(', ')})`,
      part
    )
  }
  await insertRows(
    db,
    'card_legality',
    ['card_id', 'format', 'status'],
    rows.flatMap((o) => legalityRows(o)),
    500
  )
}

// impression par défaut (celle de la recherche) des cartes logiques touchées
async function recomputeDefaults(db: CardDb, oracleIds: string[]) {
  for (let i = 0; i < oracleIds.length; i += IN_CHUNK) {
    const part = oracleIds.slice(i, i + IN_CHUNK)
    const rows = await db.select<PrintDbRow[]>(
      `SELECT card_id, oracle_id, set_type, collector_number, promo, variation, lang, released_at
       FROM mtg_prints WHERE oracle_id IN (${part.map(() => '?').join(', ')})`,
      part
    )
    const best = new Map<string, PrintRow>()
    for (const r of rows) {
      const p = asPrintRow(r)
      const cur = best.get(p.oracleId)
      if (!cur || betterPrint(p, cur)) best.set(p.oracleId, p)
    }
    for (const [oracleId, p] of best)
      await db.execute(`UPDATE mtg_oracle SET default_print = ? WHERE oracle_id = ?`, [
        p.id,
        oracleId,
      ])
  }
}

// écrit une mise à jour incrémentale (transaction) ; sources injectées
// (Scryfall dans l'appli, tableaux dans les tests)
export function recentWindowStart(lastSync: string | null, now = new Date()): string {
  const floor = now.getTime() - RECENT_DAYS * DAY_MS
  const last = lastSync ? Date.parse(lastSync) : NaN
  const from = Number.isFinite(last) ? Math.max(floor, last - MARGIN_DAYS * DAY_MS) : floor
  return new Date(from).toISOString().slice(0, 10)
}

export async function updateMtgIncremental(
  db: CardDb,
  sources: IncrementalSources,
  now = new Date(),
  lastSync: string | null = null
): Promise<IncrementalStats> {
  const since = recentWindowStart(lastSync, now)

  // 1. impressions récentes (lues avant la transaction : réseau)
  setProgress(5, 'Looking for new cards…')
  const prints = new Map<string, { print: PrintRow; oracle: OracleRow }>()
  for await (const page of sources.recentPrints(since)) {
    for (const raw of page) {
      const m = mapCard(raw)
      if (m) prints.set(m.print.id, m)
    }
    setProgress(15, `Looking for new cards… ${prints.size.toLocaleString('en')}`)
  }
  const printList = [...prints.values()]
  const known = await existingIds(
    db,
    'mtg_prints',
    'card_id',
    printList.map((m) => m.print.id)
  )
  const knownOracles = await existingIds(db, 'mtg_oracle', 'oracle_id', [
    ...new Set(printList.map((m) => m.print.oracleId)),
  ])

  await db.execute('PRAGMA foreign_keys = OFF')
  await db.execute('BEGIN TRANSACTION')
  let oracleRefreshed = false
  try {
    // impressions (nouvelles ou réécrites) + leurs cartes logiques
    setProgress(25, 'Writing new cards…')
    const cols = printList.map((m) => printColumns(m.print))
    await insertRows(
      db,
      'cards',
      CARD_COLS,
      cols.map((c) => c.card),
      500
    )
    await insertRows(
      db,
      'mtg_prints',
      PRINT_COLS,
      cols.map((c) => c.print),
      500
    )
    await insertRows(
      db,
      'card_meta',
      META_COLS,
      cols.map((c) => c.meta),
      500
    )
    const oracles = new Map<string, OracleRow>()
    for (const m of printList) oracles.set(m.oracle.oracleId, m.oracle)
    // nouvelle carte logique : sa 1re impression en attendant le calcul
    const fresh = [...oracles.values()].filter((o) => !knownOracles.has(o.oracleId))
    await insertRows(
      db,
      'mtg_oracle',
      ORACLE_COLS,
      fresh.map((o) =>
        oracleColumns(o, printList.find((m) => m.oracle.oracleId === o.oracleId)!.print.id)
      ),
      300
    )
    const seen = [...oracles.values()].filter((o) => knownOracles.has(o.oracleId))
    await upsertOracles(db, seen)
    await replaceLegalities(db, [...oracles.values()])

    // 2. règles et légalités de toutes les cartes (fichier oracle_cards)
    if (sources.oracleBatches) {
      setProgress(40, 'Updating rules and legalities…')
      const all = new Set(
        (await db.select<{ id: string }[]>(`SELECT oracle_id AS id FROM mtg_oracle`)).map(
          (r) => r.id
        )
      )
      for (;;) {
        const batch = await sources.oracleBatches()
        const rows: OracleRow[] = []
        for (const raw of batch.items) {
          const m = mapCard(raw)
          if (m && all.has(m.oracle.oracleId) && !oracles.has(m.oracle.oracleId))
            rows.push(m.oracle)
        }
        await upsertOracles(db, rows)
        await replaceLegalities(db, rows)
        const pct = batch.total ? Math.min(1, batch.read / batch.total) : 0
        setProgress(40 + Math.round(pct * 45), 'Updating rules and legalities…')
        if (batch.done) break
      }
      oracleRefreshed = true
    }

    // 3. impressions par défaut, index plein texte
    setProgress(90, 'Building the search index…')
    await recomputeDefaults(db, [...oracles.keys()])
    if (oracles.size || oracleRefreshed)
      await db.execute(`INSERT INTO mtg_oracle_fts(mtg_oracle_fts) VALUES ('rebuild')`)

    const at = now.toISOString()
    const meta: [string, string][] = [
      ['db_version', at],
      ['synced_at', at],
    ]
    if (oracleRefreshed) meta.push(['oracle_at', at])
    for (const [key, value] of meta)
      await db.execute(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)`, [key, value])
    await db.execute('COMMIT')
  } catch (err) {
    await db.execute('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await db.execute('PRAGMA foreign_keys = ON').catch(() => {})
  }
  return {
    newPrints: printList.filter((m) => !known.has(m.print.id)).length,
    updatedPrints: printList.filter((m) => known.has(m.print.id)).length,
    oracleRefreshed,
  }
}

// ── sources réelles (Scryfall, via les commandes Rust) ──────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface SearchPage {
  data?: ScryfallCard[]
  has_more?: boolean
  next_page?: string
}

// recherche paginée : impressions papier sorties (ou annoncées) depuis `since`
export function recentPrintsUrl(since: string): string {
  const q = encodeURIComponent(`date>=${since} game:paper`)
  return `${SEARCH_URL}?q=${q}&unique=prints&order=released&dir=asc&include_extras=true&include_variations=true`
}

async function* scryfallRecentPrints(since: string): AsyncIterable<ScryfallCard[]> {
  let url: string | undefined = recentPrintsUrl(since)
  while (url) {
    let page: SearchPage
    try {
      page = JSON.parse(await invoke<string>('card_data_get', { url })) as SearchPage
    } catch (e) {
      // 404 = aucune carte ne correspond (rien de sorti depuis)
      if (String(e).includes('404')) return
      throw e
    }
    yield page.data ?? []
    url = page.has_more ? page.next_page : undefined
    if (url) await sleep(SEARCH_DELAY_MS)
  }
}

async function bulkStream(metaUrl: string): Promise<{
  version: string
  open: () => Promise<{ next: () => Promise<Batch>; close: () => Promise<void> }>
}> {
  const info = JSON.parse(await invoke<string>('card_data_get', { url: metaUrl })) as BulkMeta
  const url = info.jsonl_download_uri ?? info.download_uri
  if (!url) throw new Error('No Scryfall download available')
  return {
    version: info.updated_at,
    async open() {
      const opened = await invoke<{ id: number; total: number | null }>('jsonl_open', {
        url,
        keys: SCRYFALL_KEYS,
      })
      let closed = false
      return {
        next: () => invoke<Batch>('jsonl_next', { id: opened.id }),
        close: async () => {
          if (closed) return
          closed = true
          await invoke('jsonl_close', { id: opened.id }).catch(() => {})
        },
      }
    },
  }
}

export async function syncMtg(
  options: { force?: boolean; auto?: boolean } = {}
): Promise<CardDataReport | null> {
  if (isSyncing.value) return null
  const db = (await useDatabase()).cards('mtg')
  const local = await meta(db, 'db_version')
  const needsFull =
    !!options.force ||
    !local ||
    (await meta(db, 'needs_full')) === '1' ||
    !recentEnough(await meta(db, 'full_at'), Date.now(), FULL_DAYS)
  // au lancement, une base récente ne coûte même pas une requête
  if (options.auto && !needsFull && recentEnough(await meta(db, 'synced_at'))) return null

  isSyncing.value = true
  syncBlocking.value = !local // 1re installation : rien à afficher sans elle
  syncError.value = null
  setProgress(0, 'Checking for updates…')
  let stream: { close: () => Promise<void> } | null = null
  try {
    if (needsFull) {
      const bulk = await bulkStream(META_URL)
      setProgress(2, 'Downloading card data…')
      const s = await bulk.open()
      stream = s
      const before =
        (await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM mtg_prints`))[0]?.n ?? 0
      const stats = await importMtg(db, s.next, bulk.version)
      setProgress(100, 'Sync complete')
      return { changed: stats.prints, removed: Math.max(0, before - stats.prints) }
    }

    // règles et légalités : au plus une fois tous les ORACLE_DAYS jours
    const oracleDue = !recentEnough(await meta(db, 'oracle_at'), Date.now(), ORACLE_DAYS)
    let oracleBatches: (() => Promise<Batch>) | undefined
    if (oracleDue) {
      const s = await (await bulkStream(ORACLE_META_URL)).open()
      stream = s
      oracleBatches = s.next
    }
    const stats = await updateMtgIncremental(
      db,
      { recentPrints: scryfallRecentPrints, oracleBatches },
      new Date(),
      await meta(db, 'synced_at')
    )
    setProgress(
      100,
      stats.newPrints ? `${stats.newPrints.toLocaleString('en')} new printing(s)` : 'Up to date'
    )
    return { changed: stats.newPrints, removed: 0 }
  } catch (err) {
    syncError.value = err instanceof Error ? err.message : String(err)
    setProgress(0, 'Sync failed')
    throw err
  } finally {
    if (stream) await stream.close()
    isSyncing.value = false
    // 1re installation ratée : l'overlay reste, avec « Retry »
    if (!syncError.value) syncBlocking.value = false
  }
}
