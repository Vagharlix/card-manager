import { useDatabase } from '~/composables/useDatabase'
import { nameCandidates, nameSimilarity, type OcrLine } from './text'
import { NAME_THRESHOLD, type Identified } from './types'
import { ftsQuery } from '~/services/search/mtg'
import { mtgPrintCode } from '~/services/card/mtg'

// ============================================================
// SCAN MAGIC — identification à partir du texte OCR :
//   1. bas à gauche des cartes récentes (depuis 2014) : numéro de
//      collection (« 0280 », « 280/281 ») et extension + langue
//      (« BLB • EN ») → l'impression exacte, et sa langue ;
//   2. sinon le nom (en haut de la carte) → carte logique, montrée avec
//      son impression par défaut.
// ============================================================

// langues imprimées sur les cartes → codes de l'appli
const LANGS: Record<string, string> = {
  EN: 'en',
  FR: 'fr',
  DE: 'de',
  IT: 'it',
  ES: 'es',
  SP: 'es',
  PT: 'pt',
  JP: 'ja',
  JA: 'ja',
  KO: 'ko',
  KR: 'ko',
  RU: 'ru',
  CS: 'zh',
  CT: 'zh-tw',
}

export interface CollectorRef {
  set: string // minuscules, comme Scryfall
  language: string | null
}

// « BLB • EN », « MOM * FR », « DMU · EN » (le point est souvent mal lu)
const SET_LANG = /\b([A-Z0-9]{3,5})\s*[•·*.\-+]?\s*(EN|FR|DE|IT|ES|SP|PT|JP|JA|KO|KR|RU|CS|CT)\b/

export function extractCollectorRefs(lines: OcrLine[]): CollectorRef[] {
  const out = new Map<string, CollectorRef>()
  for (const l of lines) {
    const m = SET_LANG.exec(l.text.toUpperCase())
    if (!m || /^\d+$/.test(m[1]!)) continue
    out.set(m[1]!.toLowerCase(), { set: m[1]!.toLowerCase(), language: LANGS[m[2]!] ?? null })
  }
  return [...out.values()]
}

// numéros candidats (« 0280 », « 280/281 », « 280 C ») sans zéros de tête
export function collectorNumbers(lines: OcrLine[]): string[] {
  const out = new Set<string>()
  for (const l of lines) {
    // nombre isolé (pas le « 10 » de « M10 »)
    for (const m of l.text.matchAll(
      /(?<![\p{L}\d/])(\d{1,4})(?:\s*\/\s*\d{1,4})?(?![\p{L}\d/])/gu
    )) {
      const n = String(Number(m[1]))
      if (n !== '0') out.add(n)
    }
  }
  return [...out]
}

type Found = Omit<Identified, 'firstEdition'>

async function byCollector(lines: OcrLine[]): Promise<Found | null> {
  const refs = extractCollectorRefs(lines)
  const numbers = collectorNumbers(lines)
  if (!refs.length || !numbers.length) return null
  const db = (await useDatabase()).cards('mtg')
  for (const ref of refs) {
    const rows = await db.select<{ card_id: string; name: string; collector_number: string }[]>(
      `SELECT p.card_id, o.name, p.collector_number FROM mtg_prints p
       JOIN mtg_oracle o ON o.oracle_id = p.oracle_id
       WHERE p.set_code = ? AND ltrim(p.collector_number, '0') IN (${numbers.map(() => '?').join(', ')})`,
      [ref.set, ...numbers]
    )
    // plusieurs numéros plausibles : celui dont le nom ressemble au nom lu
    const names = nameCandidates(lines)
    const scored = rows.map((r) => ({
      r,
      score: Math.max(0, ...names.map((n) => nameSimilarity(n, r.name))),
    }))
    scored.sort((a, b) => b.score - a.score)
    const pick =
      rows.length === 1 ? rows[0] : scored[0] && scored[0].score >= 0.6 ? scored[0].r : undefined
    if (pick) {
      const r = pick
      return {
        cardId: r.card_id,
        printingId: r.card_id,
        printingLabel: mtgPrintCode(ref.set, r.collector_number),
        name: r.name,
        via: 'setcode',
        score: 1,
        language: ref.language,
      }
    }
  }
  return null
}

async function byName(lines: OcrLine[]): Promise<Found | null> {
  const db = (await useDatabase()).cards('mtg')
  let best: Found | null = null
  for (const text of nameCandidates(lines)) {
    const words = text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)
    if (!words?.length) continue
    // OU entre les mots : un mot mal lu ne fait pas tout rater
    const match = `name : (${words.map((w) => `"${w}"*`).join(' OR ')})`
    const rows = await db.select<{ id: string; name: string }[]>(
      `SELECT o.default_print AS id, o.name FROM mtg_oracle_fts
       JOIN mtg_oracle o ON o.rowid = mtg_oracle_fts.rowid
       WHERE mtg_oracle_fts MATCH ? LIMIT 200`,
      [match]
    )
    for (const r of rows) {
      // cartes à deux faces : le nom lu est celui de la face visible
      const score = Math.max(
        nameSimilarity(text, r.name),
        ...r.name.split(' // ').map((face) => nameSimilarity(text, face))
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

export async function identifyMtg(lines: OcrLine[]): Promise<Identified | null> {
  const found = (await byCollector(lines)) ?? (await byName(lines))
  return found && { ...found, firstEdition: false }
}
