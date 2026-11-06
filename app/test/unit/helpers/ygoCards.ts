import type { TestDatabases } from './testDb'

// Carte YGO complète (stats, lookups, texte) pour les tests de recherche
// et de fiche ; seed.card() ne pose que le minimum.
export interface YgoCardSeed {
  id: string
  name: string
  text?: string
  type?: string
  attribute?: string
  race?: string
  atk?: number
  def?: number
  level?: number
  rank?: number
  link?: number
  markers?: string[]
  scale?: number
  archetype?: string
  alias?: string
  banlist?: 'Forbidden' | 'Limited' | 'Semi-Limited'
}

export function ygoCard(dbs: TestDatabases, c: YgoCardSeed): string {
  const db = dbs.ygo.raw
  if (c.type) db.prepare(`INSERT OR IGNORE INTO card_types VALUES (?)`).run(c.type)
  if (c.attribute) db.prepare(`INSERT OR IGNORE INTO card_attributes VALUES (?)`).run(c.attribute)
  if (c.race) db.prepare(`INSERT OR IGNORE INTO card_races VALUES (?)`).run(c.race)
  db.prepare(`INSERT INTO cards (id, name, legal_text, image_url_small) VALUES (?, ?, ?, ?)`).run(
    c.id,
    c.name,
    c.text ?? null,
    `https://img/${c.id}.jpg`
  )
  db.prepare(
    `INSERT INTO ygo_details (card_id, type, attribute, race, atk, def, level, rank,
       link_value, link_markers, pendulum_scale, archetype, alias, banlist_tcg)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    c.id,
    c.type ?? null,
    c.attribute ?? null,
    c.race ?? null,
    c.atk ?? null,
    c.def ?? null,
    c.level ?? null,
    c.rank ?? null,
    c.link ?? null,
    c.markers ? JSON.stringify(c.markers) : null,
    c.scale ?? null,
    c.archetype ?? null,
    c.alias ?? null,
    c.banlist ?? null
  )
  return c.id
}

export function printing(
  dbs: TestDatabases,
  code: string,
  cardId: string,
  setName = 'Set',
  rarity: string | null = null
) {
  dbs.ygo.raw
    .prepare(
      `INSERT INTO printings (id, card_id, set_name, set_code, rarity) VALUES (?, ?, ?, ?, ?)`
    )
    .run(code, cardId, setName, code, rarity)
}

export function rarities(dbs: TestDatabases, code: string, ...list: string[]) {
  for (const r of list)
    dbs.ygo.raw
      .prepare(`INSERT INTO printing_rarities (set_code, rarity) VALUES (?, ?)`)
      .run(code, r)
}
