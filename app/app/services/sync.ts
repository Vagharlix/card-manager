import { useDatabase } from '~/composables/useDb'
 
// ============================================================
// YGO SYNC SERVICE
// Syncs card data from YGOPRODeck API into local cards-ygo.db.
// Only runs when the remote DB version differs from local.
// All writes happen in a single transaction for atomicity and speed.
// ============================================================
 
const BASE_URL = 'https://db.ygoprodeck.com/api/v7'
 
// ============================================================
// TYPES — mirrors the YGOPRODeck API response shape
// ============================================================
 
interface YgoCardImage {
  id:               number
  image_url:        string
  image_url_small:  string
  image_url_cropped: string
}
 
interface YgoCardSet {
  set_name:       string
  set_code:       string
  set_rarity:     string
  set_rarity_code: string
  set_price:      string
}
 
interface YgoApiCard {
  id:          number
  name:        string
  type:        string
  desc:        string
  atk?:        number
  def?:        number
  level?:      number
  race:        string
  attribute?:  string
  archetype?:  string
  scale?:      number
  linkval?:    number
  linkmarkers?: string[]
  card_sets?:  YgoCardSet[]
  card_images: YgoCardImage[]
  alias?:      number
  banlist_info?: {
    ban_tcg?: string
    ban_ocg?: string
    ban_goat?: string
  }
}
 
interface YgoApiResponse {
  data: YgoApiCard[]
}
 
interface SyncMetaRow {
  value: string
}
 
// ============================================================
// SYNC STATE — reactive, consumed by the UI for progress display
// ============================================================
 
export const syncProgress  = ref(0)      // 0–100
export const syncStatus    = ref('')     // human-readable current step
export const syncError     = ref<string | null>(null)
export const isSyncing     = ref(false)
 
function setProgress(value: number, status: string) {
  syncProgress.value = value
  syncStatus.value   = status
}
 
// ============================================================
// VERSION CHECK
// Single cheap request — determines if a full sync is needed.
// ============================================================
 
async function fetchRemoteVersion(): Promise<string> {
  const res  = await fetch(`${BASE_URL}/checkDBVer.php`)
  if (!res.ok) throw new Error(`checkDBVer failed: ${res.status}`)
  const data = await res.json()
  return String(data[0].database_version)
}
 
async function getLocalVersion(ygo: import('@tauri-apps/plugin-sql').default): Promise<string | null> {
  const rows = await ygo.select<SyncMetaRow[]>(
    `SELECT value FROM sync_meta WHERE key = 'db_version'`
  )
  return rows.length > 0 ? rows[0].value : null
}
 
// ============================================================
// FETCH
// One request for the full card dump.
// includeAliased=true → alt artworks get their own passcode entry.
// misc=yes            → extra metadata fields.
// ============================================================
 
async function fetchAllCards(): Promise<YgoApiCard[]> {
  const res = await fetch(
    `${BASE_URL}/cardinfo.php?includeAliased=true&misc=yes`
  )
  if (!res.ok) throw new Error(`cardinfo fetch failed: ${res.status}`)
  const json: YgoApiResponse = await res.json()
  return json.data
}
 
// ============================================================
// PRE-PROCESS IN MEMORY
// Two passes over the raw array before touching the DB:
//   1. Collect unique lookup values (types, attributes, races)
//   2. Flatten printings (each card has an array of set printings)
// ============================================================
 
interface FlatPrinting {
  id:            string   // set_code e.g. 'LOB-EN005'
  card_id:       string
  set_name:      string
  set_code:      string
  rarity:        string
  rarity_code:   string
  price_usd:     number | null
}
 
interface PreProcessResult {
  types:      string[]
  attributes: string[]
  races:      string[]
  printings:  FlatPrinting[]
}
 
function preProcess(cards: YgoApiCard[]): PreProcessResult {
  const types      = new Set<string>()
  const attributes = new Set<string>()
  const races      = new Set<string>()
  const printings: FlatPrinting[] = []
 
  for (const card of cards) {
    if (card.type)      types.add(card.type)
    if (card.attribute) attributes.add(card.attribute)
    if (card.race)      races.add(card.race)
 
    if (card.card_sets) {
      for (const s of card.card_sets) {
        printings.push({
          id:          s.set_code,
          card_id:     String(card.id),
          set_name:    s.set_name,
          set_code:    s.set_code,
          rarity:      s.set_rarity      ?? '',
          rarity_code: s.set_rarity_code ?? '',
          price_usd:   s.set_price ? parseFloat(s.set_price) || null : null,
        })
      }
    }
  }
 
  return {
    types:      [...types],
    attributes: [...attributes],
    races:      [...races],
    printings,
  }
}
 
// ============================================================
// BATCH INSERT HELPER
// Splits an array into chunks and inserts each chunk in one
// multi-row VALUES statement. Dramatically faster than one
// INSERT per row even inside a transaction.
// ============================================================
 
async function batchInsert(
  db:          import('@tauri-apps/plugin-sql').default,
  table:       string,
  columns:     string[],
  rows:        unknown[][],
  chunkSize  = 200,
  onProgress?: (done: number, total: number) => void
) {
  const cols = columns.join(', ')
 
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk       = rows.slice(i, i + chunkSize)
    const placeholders = chunk
      .map(() => `(${columns.map(() => '?').join(', ')})`)
      .join(', ')
 
    await db.execute(
      `INSERT OR REPLACE INTO ${table} (${cols}) VALUES ${placeholders}`,
      chunk.flat()
    )
 
    onProgress?.(Math.min(i + chunkSize, rows.length), rows.length)
  }
}
 
// ============================================================
// MAIN SYNC FUNCTION
// ============================================================
 
export async function syncYgo(): Promise<void> {
  if (isSyncing.value) return   // prevent concurrent runs
 
  isSyncing.value   = true
  syncError.value   = null
  setProgress(0, 'Checking for updates...')
 
  try {
    const { ygo } = await useDatabase()
 
    // ── 1. version check ─────────────────────────────────────
    const [localVersion, remoteVersion] = await Promise.all([
      getLocalVersion(ygo),
      fetchRemoteVersion(),
    ])
 
    if (localVersion === remoteVersion) {
      setProgress(100, 'Already up to date')
      return
    }
 
    setProgress(10, 'Downloading card data...')
 
    // ── 2. fetch ─────────────────────────────────────────────
    const cards = await fetchAllCards()
    setProgress(25, 'Processing card data...')
 
    // ── 3. pre-process in memory ─────────────────────────────
    const { types, attributes, races, printings } = preProcess(cards)
    setProgress(30, 'Writing to database...')
 
    // ── 4. transaction ────────────────────────────────────────
    // tauri-plugin-sql doesn't expose BEGIN/COMMIT directly,
    // so we use the execute method with raw SQL statements.
    await ygo.execute('PRAGMA foreign_keys = OFF')
    await ygo.execute('BEGIN TRANSACTION')
 
    try {
 
      // step 1 — lookup tables
      for (const v of types)      await ygo.execute('INSERT OR IGNORE INTO card_types      VALUES (?)', [v])
      for (const v of attributes) await ygo.execute('INSERT OR IGNORE INTO card_attributes VALUES (?)', [v])
      for (const v of races)      await ygo.execute('INSERT OR IGNORE INTO card_races      VALUES (?)', [v])
      setProgress(35, 'Inserting cards...')
 
      // step 2 — cards base table
      const cardRows: unknown[][] = cards.map(c => [
        String(c.id),
        c.name,
        c.card_images[0]?.image_url         ?? null,
        c.card_images[0]?.image_url_small   ?? null,
        c.card_images[0]?.image_url_cropped ?? null,
        c.desc ?? null,
      ])
 
      await batchInsert(
        ygo,
        'cards',
        ['id', 'name', 'image_url', 'image_url_small', 'image_url_cropped', 'legal_text'],
        cardRows,
        200,
        (done, total) => {
          const pct = 35 + Math.round((done / total) * 35)  // 35→70%
          setProgress(pct, `Inserting cards... ${done}/${total}`)
        }
      )
 
      // step 3 — ygo_details
      // alias cards reference another card's passcode.
      // All cards are inserted before details so the FK is always satisfied.
      setProgress(70, 'Inserting card details...')
 
      const detailRows: unknown[][] = cards.map(c => [
        String(c.id),
        c.type      ?? null,
        c.attribute ?? null,
        c.race      ?? null,
        c.atk       ?? null,
        c.def       ?? null,
        c.level     ?? null,
        null,                              // rank — not in API directly
        c.linkval   ?? null,
        c.linkmarkers ? JSON.stringify(c.linkmarkers) : null,
        c.scale     ?? null,
        c.archetype ?? null,
        c.alias     ? String(c.alias) : null,
        c.banlist_info?.ban_tcg ?? null,
        c.banlist_info?.ban_ocg ?? null,
        null,                              // banlist_md — not in main API
      ])
 
      await batchInsert(
        ygo,
        'ygo_details',
        [
          'card_id', 'type', 'attribute', 'race',
          'atk', 'def', 'level', 'rank',
          'link_value', 'link_markers', 'pendulum_scale',
          'archetype', 'alias',
          'banlist_tcg', 'banlist_ocg', 'banlist_md',
        ],
        detailRows,
        200,
        (done, total) => {
          const pct = 70 + Math.round((done / total) * 15)  // 70→85%
          setProgress(pct, `Inserting card details... ${done}/${total}`)
        }
      )
 
      // step 4 — printings
      setProgress(85, 'Inserting printings...')
 
      const printingRows: unknown[][] = printings.map(p => [
        p.id, p.card_id, p.set_name, p.set_code,
        p.rarity, p.rarity_code, p.price_usd,
      ])
 
      await batchInsert(
        ygo,
        'printings',
        ['id', 'card_id', 'set_name', 'set_code', 'rarity', 'rarity_code', 'price_usd'],
        printingRows,
        200,
        (done, total) => {
          const pct = 85 + Math.round((done / total) * 10)  // 85→95%
          setProgress(pct, `Inserting printings... ${done}/${total}`)
        }
      )
 
      // ── 5. commit ─────────────────────────────────────────
      await ygo.execute('COMMIT')
      await ygo.execute('PRAGMA foreign_keys = ON')
 
    } catch (err) {
      // something failed inside the transaction — roll back entirely
      await ygo.execute('ROLLBACK')
      throw err
    }
 
    // ── 6. store new version (after commit — acts as success flag) ──
    await ygo.execute(
      `INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('db_version', ?)`,
      [remoteVersion]
    )
 
    setProgress(100, 'Sync complete')
 
  } catch (err) {
    syncError.value = err instanceof Error ? err.message : String(err)
    setProgress(0, 'Sync failed')
    throw err
  } finally {
    isSyncing.value = false
  }
}
