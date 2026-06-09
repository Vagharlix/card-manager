import { useDatabase } from '../../composables/useDatabase'
import type { CardSearchEngine, CardSearchResult, SearchParams } from './types'
import { ygoSearchEngine } from './ygo'

// ============================================================
// SEARCH ROUTER
// Maps a game id to its search engine.
// Adding a new TCG = implement its engine + register it here.
// Nothing else in the app changes.
// ============================================================

const engines: Record<string, CardSearchEngine> = {
  ygo: ygoSearchEngine,
  // mtg: mtgSearchEngine,   // later
}

export function searchCards(game: string, params: SearchParams): Promise<CardSearchResult[]> {
  const engine = engines[game]
  if (!engine) throw new Error(`No search engine for game: ${game}`)
  return engine.search(params)
}

// ============================================================
// FILTER OPTIONS
// Derives the available filter values from the lookup tables
// (and the type column for atomic subtypes), so the UI is always
// in sync with the actual synced data.
// ============================================================

// Known atomic subtype keywords (stable, rarely changes).
// We only surface the ones that actually appear in the data.
const MONSTER_SUBTYPE_KEYWORDS = [
  'Normal',
  'Effect',
  'Fusion',
  'Synchro',
  'Xyz',
  'Link',
  'Pendulum',
  'Ritual',
  'Tuner',
  'Flip',
  'Toon',
  'Spirit',
  'Union',
  'Gemini',
]
const SPELLTRAP_SUBTYPE_KEYWORDS = [
  'Normal',
  'Continuous',
  'Quick-Play',
  'Field',
  'Equip',
  'Ritual',
  'Counter',
]

export interface YgoFilterOptions {
  attributes: string[]
  races: string[]
  archetypes: string[]
  monsterTypes: string[]
  spellTrapTypes: string[]
}

export async function getYgoFilterOptions(): Promise<YgoFilterOptions> {
  const { ygo } = await useDatabase()

  const attributes = await ygo.select<{ value: string }[]>(
    `SELECT value FROM card_attributes ORDER BY value`
  )
  const races = await ygo.select<{ value: string }[]>(`SELECT value FROM card_races ORDER BY value`)
  const archetypes = await ygo.select<{ archetype: string }[]>(
    `SELECT DISTINCT archetype FROM ygo_details
     WHERE archetype IS NOT NULL ORDER BY archetype`
  )

  // derive which atomic subtypes actually appear in the type column
  const allTypes = await ygo.select<{ value: string }[]>(`SELECT value FROM card_types`)
  const typeBlob = allTypes.map((t) => t.value).join(' | ')

  const monsterTypes = MONSTER_SUBTYPE_KEYWORDS.filter((kw) => typeBlob.includes(kw))
  const spellTrapTypes = SPELLTRAP_SUBTYPE_KEYWORDS.filter((kw) => typeBlob.includes(kw))

  return {
    attributes: attributes.map((r) => r.value),
    races: races.map((r) => r.value),
    archetypes: archetypes.map((r) => r.archetype),
    monsterTypes,
    spellTrapTypes,
  }
}

export type { CardSearchResult, SearchParams } from './types'
