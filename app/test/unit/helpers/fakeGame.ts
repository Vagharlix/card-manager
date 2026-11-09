import { fileURLToPath } from 'node:url'
import { TestDatabase, type TestDatabases } from './testDb'
import type { GameModule } from '~/services/game/modules'
import type { DeckEngine } from '~/services/deck/types'
import type { CardSearchEngine, SearchParams } from '~/services/search/types'
import type { CardDetail } from '~/services/card/detail'

// ============================================================
// FAUX JEU (tests) : un deuxième jeu complet, avec son propre schéma de
// base de cartes (fixtures/fake-game), son vocabulaire (états, langues),
// ses règles de deck et sa recherche. S'il fonctionne de bout en bout
// avec les services génériques, ceux-ci ne dépendent pas de YGO.
// ============================================================

export const FAKE = 'fkg'
const DIR = fileURLToPath(new URL('../fixtures/fake-game', import.meta.url))

let db: TestDatabase | null = null
const cards = () => {
  if (!db) throw new Error('faux jeu non installé')
  return db
}

const deck: DeckEngine = {
  rules: {
    boards: [
      { id: 'main', label: 'Deck', min: 30, max: 30 },
      { id: 'commander', label: 'Hero', min: 1, max: 1 },
      { id: 'side', label: 'Reserve', min: 0, max: 10 },
    ],
    formats: [
      { id: 'standard', label: 'Standard' },
      { id: 'free', label: 'Free play' },
    ],
    defaultFormat: 'standard',
    defaultMaxCopies: 4,
  },
  boardForCard: (c) => (c.type === 'Hero' ? 'commander' : 'main'),
  maxCopiesForCard(c, format) {
    if (c.type === 'Hero') return 1
    const status = c.banlist?.[format]
    if (status === 'banned') return 0
    if (status === 'restricted') return 1
    return 4
  },
}

const search: CardSearchEngine = {
  async search(p: SearchParams) {
    const rows = await cards().select<{ id: string; name: string }[]>(
      `SELECT id, name FROM cards WHERE name LIKE ? ORDER BY name LIMIT ? OFFSET ?`,
      [`%${p.query ?? ''}%`, p.limit ?? 48, p.offset ?? 0]
    )
    return rows.map((r) => ({ game: FAKE, id: r.id, name: r.name, imageUrl: '' }))
  },
  async count(p: SearchParams) {
    const rows = await cards().select<{ n: number }[]>(
      `SELECT COUNT(*) AS n FROM cards WHERE name LIKE ?`,
      [`%${p.query ?? ''}%`]
    )
    return rows[0]?.n ?? 0
  },
}

async function detail(id: string): Promise<CardDetail | null> {
  const rows = await cards().select<{ id: string; name: string; kind: string; power: number }[]>(
    `SELECT c.id, c.name, d.kind, d.power FROM cards c JOIN fake_details d ON d.card_id = c.id
     WHERE c.id = ?`,
    [id]
  )
  const r = rows[0]
  if (!r) return null
  return {
    game: FAKE,
    id: r.id,
    name: r.name,
    legalText: null,
    facts: [
      { label: 'Kind', value: r.kind },
      { label: 'Power', value: String(r.power) },
    ],
    badges: [],
    printings: [],
    artworks: [{ id: r.id, name: r.name }],
  }
}

export const fakeModule: GameModule = {
  def: {
    id: FAKE,
    label: 'Fake Game',
    cardDb: 'cards-fkg',
    // sous-ensemble de l'échelle commune (imposée par la base), libellés à lui
    conditions: [
      { id: 'NM', label: 'Mint' },
      { id: 'LP', label: 'Played' },
    ],
    defaultCondition: 'LP',
    languages: [
      { id: 'de', label: 'German' },
      { id: 'en', label: 'English' },
    ],
    defaultLanguage: 'de',
  },
  deck,
  search,
  detail,
  // pas de scan, pas de source de données : comme un jeu fraîchement ajouté
}

/** Ajoute la base du faux jeu aux bases de test et enregistre son module. */
export async function installFakeGame(dbs: TestDatabases): Promise<TestDatabase> {
  db = new TestDatabase({ dir: DIR })
  dbs.games.set(FAKE, db)
  const { registerGameModule } = await import('~/services/game/modules')
  registerGameModule(fakeModule)
  return db
}

export async function uninstallFakeGame(): Promise<void> {
  const { unregisterGameModule } = await import('~/services/game/modules')
  unregisterGameModule(FAKE)
  db?.close()
  db = null
}

/** Une carte du faux jeu ; `base` = carte dont c'est une variante d'illustration. */
export function fakeCard(
  id: string,
  name: string,
  opts: { kind?: string; power?: number; base?: string; bans?: Record<string, string> } = {}
): string {
  const raw = cards().raw
  raw.prepare(`INSERT INTO cards (id, name) VALUES (?, ?)`).run(id, name)
  raw
    .prepare(`INSERT INTO fake_details (card_id, kind, power, base_card) VALUES (?, ?, ?, ?)`)
    .run(id, opts.kind ?? 'Unit', opts.power ?? 1, opts.base ?? null)
  for (const [format, status] of Object.entries(opts.bans ?? {}))
    raw.prepare(`INSERT INTO fake_bans VALUES (?, ?, ?)`).run(id, format, status)
  return id
}
