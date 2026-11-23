import { useDatabase } from '~/composables/useDatabase'
import { nameCandidates, nameSimilarity, type OcrLine } from './text'
import { NAME_THRESHOLD, type Identified } from './types'
import { rbPrintCode } from '~/services/card/riftbound'

// ============================================================
// SCAN RIFTBOUND — identification à partir du texte OCR :
//   1. numéro de collection imprimé en bas de la carte, « 001/298 »
//      (« 007a/298 » art alternatif, « 299*/298 » signée), souvent avec le
//      code d'extension (« OGN ») : l'id de Riot (« ogn-001-298 ») contient
//      numéro ET taille de l'extension → l'impression exacte, même si le
//      code d'extension est mal lu ;
//   2. sinon le nom (en haut de la carte) → carte logique, montrée avec
//      son impression par défaut.
// ============================================================

export interface CollectorHit {
  number: string // '001', '007a', '299*'
  total: string // '298'
}

// « 001/298 », « 007a / 298 », « 299★/298 », « O01/298 » (O lu pour 0)
export function rbCollectorNumbers(lines: OcrLine[]): CollectorHit[] {
  const out = new Map<string, CollectorHit>()
  for (const l of lines) {
    const text = l.text.replace(/[★☆✱]/g, '*')
    for (const m of text.matchAll(
      /(?<![\p{L}\d])([0-9OIl]{1,3})([a-z*]?)\s*\/\s*([0-9OIl]{2,3})(?![\d])/giu
    )) {
      const digits = (s: string) => s.replace(/[Oo]/g, '0').replace(/[Il]/g, '1')
      const n = digits(m[1]!)
      const total = digits(m[3]!)
      if (!/^\d+$/.test(n) || !/^\d+$/.test(total) || Number(n) === 0) continue
      const hit = { number: n.padStart(3, '0') + m[2]!.toLowerCase(), total: String(Number(total)) }
      out.set(`${hit.number}/${hit.total}`, hit)
    }
  }
  return [...out.values()]
}

// codes d'extension lus (« OGN », « SFD »…), parmi ceux de la base
export function rbSetCodes(lines: OcrLine[], known: Set<string>): string[] {
  const out = new Set<string>()
  for (const l of lines)
    for (const m of l.text.toUpperCase().matchAll(/\b([A-Z0-9]{3})\b/g)) {
      const code = m[1]!.replace(/0/g, 'O').toLowerCase()
      if (known.has(code)) out.add(code)
    }
  return [...out]
}

type Found = Omit<Identified, 'firstEdition'>

interface PrintHit {
  card_id: string
  name: string
  set_code: string
  collector_number: string
  rarity: string | null
  is_default: number
}

async function byCollector(lines: OcrLine[]): Promise<Found | null> {
  const hits = rbCollectorNumbers(lines)
  if (!hits.length) return null
  const db = (await useDatabase()).cards('riftbound')
  const known = new Set(
    (await db.select<{ code: string }[]>(`SELECT DISTINCT set_code AS code FROM rb_prints`)).map(
      (r) => r.code
    )
  )
  const sets = rbSetCodes(lines, known)
  const names = nameCandidates(lines)
  for (const hit of hits) {
    const rows = await db.select<PrintHit[]>(
      `SELECT p.card_id, o.name, p.set_code, p.collector_number, p.rarity,
              (o.default_print = p.card_id) AS is_default
       FROM rb_prints p JOIN rb_cards o ON o.oracle_id = p.oracle_id
       WHERE lower(p.riftbound_id) LIKE ?`,
      [`%-${hit.number}-${hit.total}`]
    )
    if (!rows.length) continue
    // le code d'extension lu départage ; puis le nom lu ; puis l'impression
    // normale (les promos « Metal » partagent l'id de Riot de leur base)
    const scored = rows.map((r) => ({
      r,
      score:
        (sets.includes(r.set_code) ? 4 : 0) +
        Math.max(0, ...names.map((n) => nameSimilarity(n, r.name))) * 2 +
        (r.rarity !== 'Promo' ? 0.5 : 0) +
        (r.is_default ? 0.25 : 0),
    }))
    scored.sort((a, b) => b.score - a.score)
    const r = scored[0]!.r
    return {
      cardId: r.card_id,
      printingId: r.card_id,
      printingLabel: rbPrintCode(r.set_code, r.collector_number),
      name: r.name,
      via: 'setcode',
      score: 1,
      language: null,
    }
  }
  return null
}

async function byName(lines: OcrLine[]): Promise<Found | null> {
  const db = (await useDatabase()).cards('riftbound')
  let best: Found | null = null
  for (const text of nameCandidates(lines)) {
    const words = text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)
    if (!words?.length) continue
    // OU entre les mots : un mot mal lu ne fait pas tout rater
    const match = `name : (${words.map((w) => `"${w}"*`).join(' OR ')})`
    const rows = await db.select<{ id: string; name: string }[]>(
      `SELECT o.default_print AS id, o.name FROM rb_cards_fts
       JOIN rb_cards o ON o.rowid = rb_cards_fts.rowid
       WHERE rb_cards_fts MATCH ? LIMIT 200`,
      [match]
    )
    for (const r of rows) {
      // « Jinx, Loose Cannon » : la ligne lue peut ne porter qu'une partie
      const score = Math.max(
        nameSimilarity(text, r.name),
        ...r.name.split(', ').map((part) => nameSimilarity(text, part) - 0.1)
      )
      if (score >= NAME_THRESHOLD && (!best || score > best.score)) {
        best = {
          cardId: r.id,
          printingId: null,
          printingLabel: null,
          name: r.name,
          via: 'name',
          score,
          language: null,
        }
      }
    }
  }
  return best
}

export async function identifyRiftbound(lines: OcrLine[]): Promise<Identified | null> {
  const found = (await byCollector(lines)) ?? (await byName(lines))
  return found && { ...found, firstEdition: false }
}
