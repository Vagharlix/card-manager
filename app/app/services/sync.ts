import { useDatabase } from '~/composables/useDatabase'
import { hashString } from '~/utils/hash'
type CardDb = import('@tauri-apps/plugin-sql').default
import {
  syncProgress,
  syncStatus,
  syncError,
  isSyncing,
} from '~/services/cardDataProgress'

// ============================================================
// YGO SYNC SERVICE
// Syncs card data from YGOPRODeck API into local cards-ygo.db.
// Only runs when the remote DB version differs from local.
// All writes happen in a single transaction for atomicity and speed.
//
// ALIAS RECONSTRUCTION:
// YGOPRODeck does NOT fill the `alias` field on aliased entries.
// Instead, all artworks of one logical card share the same
// misc_info.konami_id. We rebuild the alias ourselves: the first
// passcode seen for a given konami_id is the "main" print; every
// other passcode in that group gets alias = main passcode.
// ============================================================

const BASE_URL = 'https://db.ygoprodeck.com/api/v7'

interface YgoCardImage {
  id: number
  image_url: string
  image_url_small: string
  image_url_cropped: string
}

interface YgoCardSet {
  set_name: string
  set_code: string
  set_rarity: string
  set_rarity_code: string
  set_price: string
}

interface YgoApiCard {
  id: number
  name: string
  type: string
  desc: string
  atk?: number
  def?: number
  level?: number
  race: string
  attribute?: string
  archetype?: string
  scale?: number
  linkval?: number
  linkmarkers?: string[]
  card_sets?: YgoCardSet[]
  card_images: YgoCardImage[]
  alias?: number
  banlist_info?: {
    ban_tcg?: string
    ban_ocg?: string
    ban_goat?: string
  }
  misc_info?: { konami_id?: number }[]
}

interface YgoApiResponse {
  data: YgoApiCard[]
}

interface SyncMetaRow {
  value: string
}

export { syncProgress, syncStatus, syncError, isSyncing }
export type { YgoApiCard }

function setProgress(value: number, status: string) {
  syncProgress.value = value
  syncStatus.value = status
}

async function fetchRemoteVersion(): Promise<string> {
  const res = await fetch(`${BASE_URL}/checkDBVer.php`)
  if (!res.ok) throw new Error(`checkDBVer failed: ${res.status}`)
  const data = await res.json()
  return String(data[0].database_version)
}

async function getLocalVersion(ygo: CardDb): Promise<string | null> {
  const rows = await ygo.select<SyncMetaRow[]>(
    `SELECT value FROM sync_meta WHERE key = 'db_version'`
  )
  return rows[0]?.value ?? null
}

async function fetchAllCards(): Promise<YgoApiCard[]> {
  const res = await fetch(`${BASE_URL}/cardinfo.php?includeAliased=true&misc=yes`)
  if (!res.ok) throw new Error(`cardinfo fetch failed: ${res.status}`)
  const json: YgoApiResponse = await res.json()
  return json.data
}

interface FlatPrinting {
  id: string
  card_id: string
  set_name: string
  set_code: string
  rarity: string
  rarity_code: string
  price_usd: number | null
}

interface PreProcessResult {
  types: string[]
  attributes: string[]
  races: string[]
  printings: FlatPrinting[]
  aliasByCard: Map<string, string | null>
}

function preProcess(cards: YgoApiCard[]): PreProcessResult {
  const types = new Set<string>()
  const attributes = new Set<string>()
  const races = new Set<string>()
  const printings: FlatPrinting[] = []

  const mainByKonami = new Map<number, string>()
  const aliasByCard = new Map<string, string | null>()

  for (const card of cards) {
    if (card.type) types.add(card.type)
    if (card.attribute) attributes.add(card.attribute)
    if (card.race) races.add(card.race)

    if (card.card_sets) {
      for (const s of card.card_sets) {
        printings.push({
          id: s.set_code,
          card_id: String(card.id),
          set_name: s.set_name,
          set_code: s.set_code,
          rarity: s.set_rarity ?? '',
          rarity_code: s.set_rarity_code ?? '',
          price_usd: s.set_price ? parseFloat(s.set_price) || null : null,
        })
      }
    }

    const passcode = String(card.id)
    const konami = card.misc_info?.[0]?.konami_id
    if (konami == null) {
      aliasByCard.set(passcode, null)
    } else {
      const existingMain = mainByKonami.get(konami)
      if (existingMain === undefined) {
        mainByKonami.set(konami, passcode)
        aliasByCard.set(passcode, null)
      } else {
        aliasByCard.set(passcode, existingMain)
      }
    }
  }

  return {
    types: [...types],
    attributes: [...attributes],
    races: [...races],
    printings,
    aliasByCard,
  }
}

async function batchInsert(
  db: CardDb,
  table: string,
  columns: string[],
  rows: unknown[][],
  chunkSize = 200,
  onProgress?: (done: number, total: number) => void,
  verb = 'INSERT OR REPLACE'
) {
  const cols = columns.join(', ')

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const placeholders = chunk.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')

    await db.execute(`${verb} INTO ${table} (${cols}) VALUES ${placeholders}`, chunk.flat())

    onProgress?.(Math.min(i + chunkSize, rows.length), rows.length)
  }
}

// ============================================================
// MISE À JOUR INCRÉMENTALE
// YGOPRODeck n'a pas d'API « modifié depuis » (les dates des cartes sont
// des dates de sortie : un errata ou une banlist passeraient à la trappe).
// Le fichier complet est petit (~3,5 Mo compressés) : on le télécharge,
// mais on n'ÉCRIT que les cartes dont l'empreinte a changé (texte, stats,
// banlist, impressions, alias), et on supprime celles qui ont disparu.
// Les prix ne comptent pas (non affichés : sinon presque tout changerait à
// chaque mise à jour de la source).
// ============================================================

export { hashString } from '~/utils/hash'

// tout ce qui est écrit pour une carte, sauf les prix
export function cardHash(c: YgoApiCard, alias: string | null): string {
  return hashString(
    JSON.stringify([
      c.name,
      c.type,
      c.desc,
      c.atk ?? null,
      c.def ?? null,
      c.level ?? null,
      c.race,
      c.attribute ?? null,
      c.archetype ?? null,
      c.scale ?? null,
      c.linkval ?? null,
      c.linkmarkers ?? null,
      c.card_images[0]?.image_url ?? null,
      c.card_images[0]?.image_url_small ?? null,
      c.card_images[0]?.image_url_cropped ?? null,
      alias,
      c.banlist_info?.ban_tcg ?? null,
      c.banlist_info?.ban_ocg ?? null,
      (c.card_sets ?? []).map((s) => [s.set_name, s.set_code, s.set_rarity, s.set_rarity_code]),
    ])
  )
}

export interface YgoUpdatePlan {
  changed: YgoApiCard[] // nouvelles ou modifiées
  removed: string[] // passcodes disparus de la source
  unchanged: number
  hashes: Map<string, string> // empreinte de chaque carte reçue
}

// ce qu'il faut écrire : force = tout réécrire
export function planYgoUpdate(
  cards: YgoApiCard[],
  aliasByCard: Map<string, string | null>,
  stored: Map<string, string>,
  force = false
): YgoUpdatePlan {
  const hashes = new Map<string, string>()
  const changed: YgoApiCard[] = []
  for (const c of cards) {
    const id = String(c.id)
    const h = cardHash(c, aliasByCard.get(id) ?? null)
    hashes.set(id, h)
    if (force || stored.get(id) !== h) changed.push(c)
  }
  const removed = [...stored.keys()].filter((id) => !hashes.has(id))
  return { changed, removed, unchanged: cards.length - changed.length, hashes }
}

export interface YgoUpdateStats {
  changed: number
  removed: number
  unchanged: number
}

const IN_CHUNK = 400

async function forChunks(ids: string[], fn: (part: string[], ph: string) => Promise<void>) {
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const part = ids.slice(i, i + IN_CHUNK)
    await fn(part, part.map(() => '?').join(', '))
  }
}

// écrit une mise à jour dans une transaction (l'ancienne base reste lisible,
// ROLLBACK si erreur) ; renvoie ce qui a été écrit
export async function writeYgoUpdate(
  ygo: CardDb,
  cards: YgoApiCard[],
  version: string,
  options: { force?: boolean } = {}
): Promise<YgoUpdateStats> {
  const { types, attributes, races, aliasByCard } = preProcess(cards)
  const storedRows = await ygo.select<{ card_id: string; hash: string }[]>(
    `SELECT card_id, hash FROM card_hashes`
  )
  const stored = new Map(storedRows.map((r) => [r.card_id, r.hash]))
  // base remplie avant les empreintes (migration ygo 004) : les cartes sans
  // empreinte sont réécrites ; celles absentes de la source, retirées
  const known = await ygo.select<{ id: string }[]>(`SELECT id FROM cards`)
  for (const r of known) if (!stored.has(r.id)) stored.set(r.id, '')

  const plan = planYgoUpdate(cards, aliasByCard, stored, options.force)
  const changedIds = plan.changed.map((c) => String(c.id))
  const gone = [...plan.removed, ...changedIds]
  const { printings } = preProcess(plan.changed)

  setProgress(30, `Updating ${plan.changed.length} card(s)...`)
  await ygo.execute('PRAGMA foreign_keys = OFF')
  await ygo.execute('BEGIN TRANSACTION')
  try {
    for (const v of types) await ygo.execute('INSERT OR IGNORE INTO card_types VALUES (?)', [v])
    for (const v of attributes)
      await ygo.execute('INSERT OR IGNORE INTO card_attributes VALUES (?)', [v])
    for (const v of races) await ygo.execute('INSERT OR IGNORE INTO card_races VALUES (?)', [v])

    // anciennes impressions (et leurs raretés) des cartes retirées ou modifiées
    await forChunks(gone, async (part, ph) => {
      await ygo.execute(
        `DELETE FROM printing_rarities WHERE set_code IN
           (SELECT set_code FROM printings WHERE card_id IN (${ph}))`,
        part
      )
      await ygo.execute(`DELETE FROM printings WHERE card_id IN (${ph})`, part)
    })
    // cartes disparues de la source
    await forChunks(plan.removed, async (part, ph) => {
      await ygo.execute(`DELETE FROM ygo_details WHERE card_id IN (${ph})`, part)
      await ygo.execute(`DELETE FROM cards WHERE id IN (${ph})`, part)
      await ygo.execute(`DELETE FROM card_hashes WHERE card_id IN (${ph})`, part)
    })

    setProgress(40, 'Writing cards...')
    await batchInsert(
      ygo,
      'cards',
      ['id', 'name', 'image_url', 'image_url_small', 'image_url_cropped', 'legal_text'],
      plan.changed.map((c) => [
        String(c.id),
        c.name,
        c.card_images[0]?.image_url ?? null,
        c.card_images[0]?.image_url_small ?? null,
        c.card_images[0]?.image_url_cropped ?? null,
        c.desc ?? null,
      ]),
      200,
      (done, total) =>
        setProgress(40 + Math.round((done / total) * 30), `Writing cards... ${done}/${total}`)
    )

    setProgress(70, 'Writing card details...')
    await batchInsert(
      ygo,
      'ygo_details',
      [
        'card_id',
        'type',
        'attribute',
        'race',
        'atk',
        'def',
        'level',
        'rank',
        'link_value',
        'link_markers',
        'pendulum_scale',
        'archetype',
        'alias',
        'banlist_tcg',
        'banlist_ocg',
        'banlist_md',
      ],
      plan.changed.map((c) => {
        const passcode = String(c.id)
        return [
          passcode,
          c.type ?? null,
          c.attribute ?? null,
          c.race ?? null,
          c.atk ?? null,
          c.def ?? null,
          c.level ?? null,
          null,
          c.linkval ?? null,
          c.linkmarkers ? JSON.stringify(c.linkmarkers) : null,
          c.scale ?? null,
          c.archetype ?? null,
          aliasByCard.get(passcode) ?? null,
          c.banlist_info?.ban_tcg ?? null,
          c.banlist_info?.ban_ocg ?? null,
          null,
        ]
      })
    )

    setProgress(85, 'Writing printings...')
    await batchInsert(
      ygo,
      'printings',
      ['id', 'card_id', 'set_name', 'set_code', 'rarity', 'rarity_code', 'price_usd'],
      printings.map((p) => [
        p.id,
        p.card_id,
        p.set_name,
        p.set_code,
        p.rarity,
        p.rarity_code,
        p.price_usd,
      ])
    )
    // toutes les raretés de chaque code (printings n'en garde qu'une par code)
    await batchInsert(
      ygo,
      'printing_rarities',
      ['set_code', 'rarity', 'rarity_code'],
      printings.filter((p) => p.rarity).map((p) => [p.set_code, p.rarity, p.rarity_code]),
      300,
      undefined,
      'INSERT OR REPLACE'
    )

    await batchInsert(
      ygo,
      'card_hashes',
      ['card_id', 'hash'],
      changedIds.map((id) => [id, plan.hashes.get(id)!]),
      500
    )
    await ygo.execute(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('db_version', ?)`, [
      version,
    ])
    await ygo.execute('COMMIT')
  } catch (err) {
    await ygo.execute('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await ygo.execute('PRAGMA foreign_keys = ON').catch(() => {})
  }
  return { changed: plan.changed.length, removed: plan.removed.length, unchanged: plan.unchanged }
}

// version de la base de cartes locale (null = jamais synchronisée)
export async function localSyncVersion(): Promise<string | null> {
  const ygo = (await useDatabase()).cards('ygo')
  return getLocalVersion(ygo)
}

// Vérifie la version distante (une petite requête) ; si elle a changé,
// télécharge le fichier complet et n'écrit que les différences.
// force : tout réécrire, même si la version distante est identique.
// En arrière-plan, même la 1re installation (cf. services/cardData.ts).
export async function syncYgo(options: { force?: boolean } = {}): Promise<YgoUpdateStats | null> {
  if (isSyncing.value) return null

  const ygo = (await useDatabase()).cards('ygo')
  const localVersion = await getLocalVersion(ygo)
  isSyncing.value = true
  syncError.value = null
  setProgress(0, 'Checking for updates...')

  try {
    const remoteVersion = await fetchRemoteVersion()

    if (!options.force && localVersion === remoteVersion) {
      setProgress(100, 'Already up to date')
      return { changed: 0, removed: 0, unchanged: 0 }
    }

    setProgress(10, 'Downloading card data...')
    const cards = await fetchAllCards()
    setProgress(25, 'Comparing with your card database...')
    const stats = await writeYgoUpdate(ygo, cards, remoteVersion, options)
    setProgress(
      100,
      stats.changed || stats.removed
        ? `Updated: ${stats.changed} card(s) changed, ${stats.removed} removed`
        : 'Already up to date'
    )
    return stats
  } catch (err) {
    syncError.value = err instanceof Error ? err.message : String(err)
    setProgress(0, 'Sync failed')
    throw err
  } finally {
    isSyncing.value = false
  }
}
