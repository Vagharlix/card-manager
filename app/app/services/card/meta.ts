import { useDatabase } from '~/composables/useDatabase'
import { gameDefOrNull } from '~/services/game'

// ============================================================
// MÉTADONNÉES COMMUNES D'UNE CARTE (tous jeux)
// Lues dans la base de cartes du jeu via le contrat commun :
//   cards(id, name, …) + vue card_meta(card_id, root, type), une ligne
//   par carte. root = carte logique (les artworks d'une même carte
//   partagent le root) ; type = indication pour le moteur de deck.
// Les services génériques passent par ici, jamais par les tables d'un jeu.
// ============================================================

export interface CardMeta {
  id: string
  root: string
  name: string
  type: string | null
}

// au-delà, on découpe (limite de variables SQLite)
const CHUNK = 5000

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK))
  return out
}

// id → métadonnées ; un id inconnu de la base est absent de la map
export async function cardMetaOf(game: string, cardIds: Iterable<string>): Promise<Map<string, CardMeta>> {
  const ids = [...new Set(cardIds)]
  const out = new Map<string, CardMeta>()
  if (!ids.length) return out
  const db = (await useDatabase()).cards(game)
  for (const part of chunks(ids)) {
    const rows = await db.select<CardMeta[]>(
      `SELECT c.id, COALESCE(m.root, c.id) AS root, c.name, m.type
       FROM cards c LEFT JOIN card_meta m ON m.card_id = c.id
       WHERE c.id IN (${part.map(() => '?').join(', ')})`,
      part
    )
    for (const r of rows) out.set(r.id, r)
  }
  return out
}

// carte logique → tous ses artworks (une carte absente de la base → elle seule)
export async function variantsOfRoots(
  game: string,
  roots: Iterable<string>
): Promise<Map<string, string[]>> {
  const list = [...new Set(roots)]
  const out = new Map<string, string[]>(list.map((r) => [r, []]))
  if (!list.length) return out
  const db = (await useDatabase()).cards(game)
  for (const part of chunks(list)) {
    const rows = await db.select<{ id: string; root: string }[]>(
      `SELECT card_id AS id, root FROM card_meta
       WHERE root IN (${part.map(() => '?').join(', ')})`,
      part
    )
    for (const r of rows) out.get(r.root)?.push(r.id)
  }
  for (const [root, ids] of out) if (!ids.length) ids.push(root)
  return out
}

// carte logique d'un id (lui-même s'il est inconnu)
export async function rootOf(game: string, cardId: string): Promise<string> {
  return (await cardMetaOf(game, [cardId])).get(cardId)?.root ?? cardId
}

// tous les artworks de la carte logique d'un id
export async function logicalVariants(game: string, cardId: string): Promise<string[]> {
  const root = await rootOf(game, cardId)
  return (await variantsOfRoots(game, [root])).get(root) ?? [root]
}

// statut par format (vue card_legality) de chaque carte logique :
// root → { format: statut }. Pas de ligne = aucune restriction.
export async function legalityOf(
  game: string,
  roots: Iterable<string>
): Promise<Map<string, Record<string, string>>> {
  const list = [...new Set(roots)]
  const out = new Map<string, Record<string, string>>(list.map((r) => [r, {}]))
  if (!list.length) return out
  const db = (await useDatabase()).cards(game)
  for (const part of chunks(list)) {
    const rows = await db.select<{ card_id: string; format: string; status: string }[]>(
      `SELECT card_id, format, status FROM card_legality
       WHERE card_id IN (${part.map(() => '?').join(', ')})`,
      part
    )
    for (const r of rows) {
      const rec = out.get(r.card_id)
      if (rec) rec[r.format] = r.status
    }
  }
  return out
}

// raretés par code d'impression (printing_rarities, remplie par la synchro
// des cartes) : code → raretés triées
export async function raritiesOf(
  game: string,
  codes: Iterable<string>
): Promise<Map<string, string[]>> {
  const list = [...new Set(codes)]
  const out = new Map<string, string[]>()
  if (!list.length) return out
  const db = (await useDatabase()).cards(game)
  for (const part of chunks(list)) {
    const rows = await db.select<{ set_code: string; rarity: string }[]>(
      `SELECT set_code, rarity FROM printing_rarities
       WHERE set_code IN (${part.map(() => '?').join(', ')}) ORDER BY rarity`,
      part
    )
    for (const r of rows) out.set(r.set_code, [...(out.get(r.set_code) ?? []), r.rarity])
  }
  return out
}

// raretés possibles d'une impression (choix après un scan, fiche carte) :
// toutes celles connues, à défaut la rareté unique de `printings`
export async function printingRarities(game: string, printingId: string): Promise<string[]> {
  if (!gameDefOrNull(game)) return []
  const found = (await raritiesOf(game, [printingId])).get(printingId)
  if (found?.length) return found
  const db = (await useDatabase()).cards(game)
  const rows = await db.select<{ rarity: string | null }[]>(
    `SELECT rarity FROM printings WHERE id = ?`,
    [printingId]
  )
  return rows[0]?.rarity ? [rows[0].rarity] : []
}
