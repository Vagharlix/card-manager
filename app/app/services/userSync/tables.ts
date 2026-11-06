// ============================================================
// SYNCHRO ENTRE APPAREILS — tables synchronisées de user.db.
// Ordre = parents avant enfants (insertion dans cet ordre, suppression
// dans l'ordre inverse : les clés étrangères restent valides).
// ============================================================

export type Row = Record<string, unknown>
export type Tables = Record<string, Row[]>

export interface SyncTable {
  name: string
  /** colonnes de la clé primaire */
  key: string[]
  /** horodatage de la ligne : départage un conflit (le plus récent gagne) */
  stamp?: string
  /** lignes à synchroniser (par défaut toutes) */
  include?: (row: Row) => boolean
  /** contrainte d'unicité secondaire : une modification = suppression + insertion */
  replaceOnUpdate?: boolean
  /** clés étrangères : une ligne dont le parent n'existe plus est écartée */
  parents?: { column: string; table: string }[]
}

// Réglages partagés entre appareils ; les autres (limite du cache d'images…)
// dépendent de l'appareil.
const SYNCED_SETTING =
  /^(share_owner_name|favorite_game|show_game_picker|[a-z0-9_]+\.default_(condition|language))$/

const inContainer = (column: string) => ({ column, table: 'containers' })

export const SYNC_TABLES: SyncTable[] = [
  { name: 'user_games', key: ['game'] },
  {
    name: 'settings',
    key: ['key'],
    stamp: 'updated_at',
    include: (r) => SYNCED_SETTING.test(String(r.key)),
  },
  { name: 'containers', key: ['id'], stamp: 'updated_at' },
  { name: 'deckbox_details', key: ['container_id'], parents: [inContainer('container_id')] },
  { name: 'binder_details', key: ['container_id'], parents: [inContainer('container_id')] },
  { name: 'bulk_box_details', key: ['container_id'], parents: [inContainer('container_id')] },
  { name: 'collection', key: ['id'], stamp: 'updated_at' },
  { name: 'decks', key: ['id'], stamp: 'updated_at' },
  { name: 'deck_cards', key: ['id'], parents: [{ column: 'deck_id', table: 'decks' }] },
  {
    name: 'deckbox_decks',
    key: ['deckbox_id', 'deck_id'],
    parents: [inContainer('deckbox_id'), { column: 'deck_id', table: 'decks' }],
  },
  {
    name: 'deckbox_cards',
    key: ['id'],
    parents: [inContainer('deckbox_id'), { column: 'collection_id', table: 'collection' }],
  },
  {
    name: 'binder_slots',
    key: ['id'],
    replaceOnUpdate: true, // UNIQUE(container_id, page, row, col)
    parents: [inContainer('container_id'), { column: 'collection_id', table: 'collection' }],
  },
  {
    name: 'bulk_box_contents',
    key: ['id'],
    parents: [inContainer('container_id'), { column: 'collection_id', table: 'collection' }],
  },
  {
    name: 'shared_collections',
    key: ['id'],
    stamp: 'received_at',
    replaceOnUpdate: true, // UNIQUE(game, owner)
  },
]

/**
 * Version du schéma de user.db (= nombre de migrations user/). Un instantané
 * venant d'une version plus récente de l'appli est refusé ; un plus ancien
 * est accepté (ses colonnes manquantes sont considérées comme inchangées).
 * Un test vérifie qu'elle suit les migrations.
 */
export const USER_SCHEMA_VERSION = 9

export const keyOf = (t: SyncTable, row: Row) => t.key.map((c) => String(row[c])).join('\u0001')

export const sameValue = (a: unknown, b: unknown) => a === b || (a == null && b == null)

export function sameRow(a: Row, b: Row): boolean {
  const cols = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const c of cols) if (!sameValue(a[c], b[c])) return false
  return true
}

export function indexRows(t: SyncTable, rows: Row[] | undefined): Map<string, Row> {
  const m = new Map<string, Row>()
  for (const r of rows ?? []) m.set(keyOf(t, r), r)
  return m
}
