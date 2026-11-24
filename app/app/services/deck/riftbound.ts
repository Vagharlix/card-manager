import { useDatabase } from '~/composables/useDatabase'
import type { DeckEngine, DeckRules, CardForPlacement, DeckForIssues, DeckIssue } from './types'

// ============================================================
// RIFTBOUND DECK ENGINE — règles de construction (règles officielles,
// section 103) :
//  - 1 légende (Champion Legend) : elle fixe l'identité de domaines ;
//  - un deck principal d'au moins 40 cartes, champion choisi compris
//    (zone « Chosen Champion » : une unité Champion qui porte l'étiquette
//    de champion de la légende) ;
//  - 3 copies au plus d'un même nom (champion choisi compris) ;
//  - 3 cartes Signature au plus en tout, toutes de la légende ;
//  - un deck de runes de 12 runes, de l'identité ;
//  - 3 champs de bataille différents (1v1 comme 2v2) ;
//  - toute carte : ses domaines ⊂ identité (une carte multi-domaines
//    exige tous ses domaines) ; incolore = partout ;
//  - réserve (sideboard) de 8 cartes au plus.
// Statuts (card_legality) : banned | not_legal (jetons) ; deck_limit
// (12 pour une rune, 1 pour une légende ou un champ de bataille).
// ============================================================

const RULES: DeckRules = {
  boards: [
    { id: 'legend', label: 'Legend', shortLabel: 'Legend', min: 1, max: 1 },
    {
      id: 'champion',
      label: 'Chosen Champion',
      shortLabel: 'Champion',
      min: 1,
      max: 1,
      pickable: true,
    },
    { id: 'main', label: 'Main Deck', shortLabel: 'Main', min: 39, max: 999 },
    { id: 'runes', label: 'Rune Deck', shortLabel: 'Runes', min: 12, max: 12 },
    {
      id: 'battlefields',
      label: 'Battlefields',
      shortLabel: 'Fields',
      min: 3,
      max: 3,
      landscape: true,
    },
    { id: 'side', label: 'Sideboard', shortLabel: 'Side', min: 0, max: 8 },
  ],
  formats: [
    { id: 'standard', label: 'Standard (1v1)' },
    { id: '2v2', label: '2v2' },
    { id: 'casual', label: 'Casual (no ban list)' },
  ],
  defaultFormat: 'standard',
  defaultMaxCopies: 3,
}

export const RB_MAIN_MIN = 40
export const RB_RUNES = 12
export const RB_BATTLEFIELDS = 3
export const RB_SIGNATURES = 3
export const RB_SIDE_MAX = 8

function deckLimit(card: CardForPlacement): number | null {
  const raw = card.banlist?.deck_limit
  if (raw === undefined || raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

// card_meta.type : « Champion Unit », « Signature Spell », « Basic Rune »…
const typeHas = (type: string | null | undefined, word: string) =>
  new RegExp(`\\b${word}\\b`, 'i').test(type ?? '')

// ce que les règles du deck entier lisent d'une carte logique
export interface RbDeckCard {
  oracle_id: string
  name: string
  type: string
  supertype: string | null
  domains: string // 'Fury,Mind'
  tags: string // 'Jinx, Zaun'
}

const list = (s: string, sep: RegExp) =>
  s
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean)

export const domainsOf = (c: Pick<RbDeckCard, 'domains'>) => list(c.domains, /,/)
export const tagsOf = (c: Pick<RbDeckCard, 'tags'>) => list(c.tags, /,/)

const count = (cards: { quantity: number }[] | undefined) =>
  (cards ?? []).reduce((n, c) => n + c.quantity, 0)

// règles du deck entier (pures) : `info` = carte logique → caractéristiques
export function riftboundIssues(deck: DeckForIssues, info: Map<string, RbDeckCard>): DeckIssue[] {
  const issues: DeckIssue[] = []
  const legends = deck.legend ?? []
  const legendCount = count(legends)
  const legend = legendCount === 1 ? info.get(legends[0]!.root) : undefined

  if (legendCount === 0) issues.push({ code: 'legend', message: 'Choose a Legend' })
  else if (legendCount > 1) issues.push({ code: 'legend', message: 'Only one Legend per deck' })

  // champion choisi
  const champions = deck.champion ?? []
  const championCount = count(champions)
  if (championCount === 0) {
    issues.push({
      code: 'champion',
      message: 'Choose a Champion unit (menu of a main deck card → Chosen Champion)',
    })
  } else if (championCount > 1) {
    issues.push({ code: 'champion', message: 'Only one Chosen Champion' })
  } else {
    const c = champions[0]!
    const ci = info.get(c.root)
    if (ci && !(ci.type === 'Unit' && ci.supertype === 'Champion')) {
      issues.push({
        code: 'champion',
        message: `${c.name} is not a Champion unit`,
        cardIds: [c.cardId],
      })
    } else if (ci && legend && !tagsOf(ci).some((t) => tagsOf(legend).includes(t))) {
      issues.push({
        code: 'champion',
        message: `${c.name} does not match your Legend (${tagsOf(legend).join(', ')})`,
        cardIds: [c.cardId],
      })
    }
  }

  // deck principal : 40 cartes au moins, champion choisi compris
  const mainCount = count(deck.main) + championCount
  if (mainCount < RB_MAIN_MIN)
    issues.push({
      code: 'main',
      message: `Main deck: ${mainCount} / ${RB_MAIN_MIN} cards (chosen champion included)`,
    })

  // runes et champs de bataille
  const runeCount = count(deck.runes)
  if (runeCount !== RB_RUNES)
    issues.push({ code: 'runes', message: `Rune deck: ${runeCount} / ${RB_RUNES} runes` })
  const fieldCount = count(deck.battlefields)
  if (fieldCount !== RB_BATTLEFIELDS)
    issues.push({
      code: 'battlefields',
      message: `Battlefields: ${fieldCount} / ${RB_BATTLEFIELDS} (all different)`,
    })
  if (count(deck.side) > RB_SIDE_MAX)
    issues.push({ code: 'side', message: `Sideboard: ${RB_SIDE_MAX} cards at most` })

  // cartes à la mauvaise place (une rune dans le deck principal…)
  const misplaced: string[] = []
  for (const [board, cards] of Object.entries(deck)) {
    for (const c of cards ?? []) {
      const ci = info.get(c.root)
      if (!ci) continue
      const where =
        ci.type === 'Legend'
          ? 'legend'
          : ci.type === 'Rune'
            ? 'runes'
            : ci.type === 'Battlefield'
              ? 'battlefields'
              : null
      const ok =
        where === board ||
        (where === null && ['main', 'champion', 'side'].includes(board)) ||
        (board === 'side' && where !== 'legend')
      if (!ok) misplaced.push(c.cardId)
    }
  }
  if (misplaced.length)
    issues.push({ code: 'zone', message: 'Some cards are in the wrong zone', cardIds: misplaced })

  // signatures : 3 au plus, toutes de la légende
  const sigs = [...(deck.main ?? []), ...(deck.champion ?? []), ...(deck.side ?? [])].filter(
    (c) => info.get(c.root)?.supertype === 'Signature'
  )
  if (count(sigs) > RB_SIGNATURES)
    issues.push({
      code: 'signatures',
      message: `${count(sigs)} Signature cards: ${RB_SIGNATURES} at most`,
      cardIds: sigs.map((c) => c.cardId),
    })
  if (legend) {
    const wrongSig = sigs.filter((c) => !tagsOf(info.get(c.root)!).some((t) => tagsOf(legend).includes(t)))
    if (wrongSig.length)
      issues.push({
        code: 'signature-tag',
        message: `Signature cards must belong to your Legend: ${[...new Set(wrongSig.map((c) => c.name))].join(', ')}`,
        cardIds: wrongSig.map((c) => c.cardId),
      })
  }

  // identité de domaines
  if (legend) {
    const identity = new Set(domainsOf(legend))
    const outside: { cardId: string; name: string }[] = []
    for (const [board, cards] of Object.entries(deck)) {
      if (board === 'legend') continue
      for (const c of cards ?? []) {
        const ci = info.get(c.root)
        if (ci && !domainsOf(ci).every((d) => identity.has(d))) outside.push(c)
      }
    }
    if (outside.length)
      issues.push({
        code: 'identity',
        message: `Outside your Legend's domains (${[...identity].join(', ')}): ${[...new Set(outside.map((c) => c.name))].join(', ')}`,
        cardIds: outside.map((c) => c.cardId),
      })
  }
  return issues
}

async function readInfo(roots: string[]): Promise<Map<string, RbDeckCard>> {
  const out = new Map<string, RbDeckCard>()
  if (!roots.length) return out
  const db = (await useDatabase()).cards('riftbound')
  for (let i = 0; i < roots.length; i += 500) {
    const part = roots.slice(i, i + 500)
    const rows = await db.select<RbDeckCard[]>(
      `SELECT oracle_id, name, type, supertype, domains, tags FROM rb_cards
       WHERE oracle_id IN (${part.map(() => '?').join(', ')})`,
      part
    )
    for (const r of rows) out.set(r.oracle_id, r)
  }
  return out
}

export const riftboundDeckEngine: DeckEngine = {
  rules: RULES,

  // légende, runes, champs de bataille : leur zone ; le champion choisi se
  // choisit (menu « Chosen Champion »), jamais automatiquement
  boardForCard(card) {
    if (typeHas(card.type, 'legend')) return 'legend'
    if (typeHas(card.type, 'rune')) return 'runes'
    if (typeHas(card.type, 'battlefield')) return 'battlefields'
    return 'main'
  },

  maxCopiesForCard(card, format) {
    const status = format === 'casual' ? undefined : card.banlist?.[format]
    if (status === 'banned' || status === 'not_legal') return 0
    // jetons : jamais dans un deck, même en casual
    if (card.banlist?.standard === 'not_legal') return 0
    return deckLimit(card) ?? RULES.defaultMaxCopies
  },

  limitLabel(limit, status) {
    if (status === 'banned') return 'banned'
    if (status === 'not_legal') return 'not legal'
    return `max ${limit}`
  },

  limitMessage(limit, status) {
    if (status === 'banned') return 'Card banned in this format'
    if (status === 'not_legal' || limit === 0) return 'Card not legal in a deck'
    return limit === 1 ? 'Only 1 copy allowed' : `${limit}-copy limit reached`
  },

  async deckIssues(deck) {
    const roots = new Set<string>()
    for (const cards of Object.values(deck)) for (const c of cards ?? []) roots.add(c.root)
    return riftboundIssues(deck, await readInfo([...roots]))
  },
}
