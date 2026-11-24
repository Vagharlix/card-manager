import { useDatabase } from '~/composables/useDatabase'
import { nameCandidates, nameSimilarity, type OcrLine } from './text'
import { NAME_THRESHOLD, type Identified } from './types'
import { rbPrintCode } from '~/services/card/riftbound'

// ============================================================
// SCAN RIFTBOUND — identification à partir du texte OCR :
//   1. bas de carte : « UNL • 131/219 » (code d'extension, numéro, taille de
//      l'extension ; « 007a/298 » art alternatif, « 299*/298 » signée).
//      Le texte est minuscule : l'OCR lit souvent le « / » comme 1, l, I ou |,
//      saute le « • », confond O/0, I/1, S/5, B/8. On s'appuie donc sur ce que
//      la base connaît : codes d'extension et tailles d'extension (« 219 »,
//      tirées des ids de Riot « unl-131-219 ») ; un séparateur douteux n'est
//      accepté que devant une taille connue. → l'impression exacte ;
//   2. sinon le nom (en haut ; les champions l'impriment sur deux lignes,
//      « Jinx » / « REBEL » : lignes voisines recollées) → carte logique,
//      montrée avec son impression par défaut.
// ============================================================

export interface CollectorHit {
  number: string // '131', '007a', '299*' (3 chiffres au moins, comme l'id de Riot)
  total: string | null // '219', '024' ; null si seul le code d'extension accompagne le numéro
  set: string | null // 'unl' si lu
}

// ce que la base connaît (codes d'extension, tailles imprimées)
export interface RbKnown {
  sets: Set<string> // 'unl', 'ogn'…
  totals: Set<string> // '219', '298', '024'…
}

const digits = (s: string) =>
  s.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8')
const pad3 = (n: string) => n.padStart(3, '0')
const D = '[0-9OoIlSB]'

// numéros lus en bas de carte (pur, testé) ; sans `known`, seul « / » sépare
export function rbCollectorNumbers(lines: OcrLine[], known?: RbKnown): CollectorHit[] {
  const out = new Map<string, CollectorHit>()
  const add = (hit: CollectorHit) => out.set(`${hit.set}|${hit.number}|${hit.total}`, hit)
  for (const l of lines) {
    const text = l.text.replace(/[★☆✱✻]/g, '*')
    const setRead = known ? setsIn(text, known.sets)[0] ?? null : null

    // « 131/219 » (et « 1311219 », « 131l219 »… si 219 est une taille connue)
    const withTotal = new RegExp(
      `(?<![\\p{L}\\d])(${D}{1,3})([a-z*]?)\\s*([/|lI1])\\s*(${D}{3})(?!\\d)`,
      'gu'
    )
    for (const m of text.matchAll(withTotal)) {
      const n = digits(m[1]!)
      const total = digits(m[4]!)
      if (!/^\d+$/.test(n) || !/^\d{3}$/.test(total) || Number(n) === 0) continue
      const strictSlash = m[3] === '/'
      if (!strictSlash && !known?.totals.has(total)) continue
      if (known && !known.totals.has(total)) continue
      add({ number: pad3(n) + m[2]!.toLowerCase(), total, set: setRead })
    }

    // « UNL • 131 » sans taille lisible : code d'extension connu + numéro
    if (known) {
      for (const set of setsIn(text, known.sets)) {
        const after = new RegExp(
          `\\b${set}\\b\\s*[•·.*\\-+:]?\\s*(${D}{1,3}|[rRtT]\\d{2})([a-z*]?)(?![\\d])`,
          'giu'
        )
        for (const m of text.matchAll(after)) {
          const raw = m[1]!
          const n = /^[rt]/i.test(raw) ? raw.toLowerCase() : pad3(digits(raw))
          if (/^0+$/.test(n)) continue
          add({ number: n + m[2]!.toLowerCase(), total: null, set })
        }
      }
    }
  }
  // les lectures complètes (avec la taille) d'abord ; un numéro déjà lu avec
  // sa taille n'est pas répété sans elle
  const all = [...out.values()]
  const full = new Set(all.filter((h) => h.total).map((h) => h.number))
  return all
    .filter((h) => h.total || !full.has(h.number))
    .sort((a, b) => Number(!!b.total) - Number(!!a.total))
}

// codes d'extension présents dans une ligne (« UNL », « 0GN » → ogn)
export function setsIn(text: string, sets: Set<string>): string[] {
  const out: string[] = []
  for (const m of text.toUpperCase().matchAll(/(?<![A-Z0-9])([A-Z0-9]{2,4})(?![A-Z0-9])/g)) {
    const code = m[1]!.replace(/0/g, 'O').toLowerCase()
    if (/^\d+$/.test(m[1]!)) continue
    if (sets.has(code) && !out.includes(code)) out.push(code)
  }
  return out
}

// codes d'extension et tailles connus : relus au plus toutes les minutes
let knownCache: { at: number; value: Promise<RbKnown> } | null = null
async function knownSets(): Promise<RbKnown> {
  if (knownCache && Date.now() - knownCache.at < 60_000) return knownCache.value
  const value = (async () => {
    const db = (await useDatabase()).cards('riftbound')
    const rows = await db.select<{ set_code: string; riftbound_id: string | null }[]>(
      `SELECT DISTINCT set_code, riftbound_id FROM rb_prints`
    )
    const sets = new Set<string>()
    const totals = new Set<string>()
    for (const r of rows) {
      sets.add(r.set_code)
      const m = /-(\d{3})$/.exec(r.riftbound_id ?? '')
      if (m) totals.add(m[1]!)
    }
    return { sets, totals }
  })()
  knownCache = { at: Date.now(), value }
  value.catch(() => (knownCache = null))
  return value
}

// tests : oublie le cache (nouvelle base)
export function resetRiftboundScanCache(): void {
  knownCache = null
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

const PRINT_SELECT = `SELECT p.card_id, o.name, p.set_code, p.collector_number, p.rarity,
       (o.default_print = p.card_id) AS is_default
  FROM rb_prints p JOIN rb_cards o ON o.oracle_id = p.oracle_id`

async function byCollector(lines: OcrLine[]): Promise<Found | null> {
  const known = await knownSets()
  const hits = rbCollectorNumbers(lines, known)
  if (!hits.length) return null
  const db = (await useDatabase()).cards('riftbound')
  const setsRead = new Set(lines.flatMap((l) => setsIn(l.text, known.sets)))
  const names = nameGuesses(lines)
  for (const hit of hits) {
    const rows = hit.total
      ? await db.select<PrintHit[]>(`${PRINT_SELECT} WHERE lower(p.riftbound_id) LIKE ?`, [
          `%-${hit.number}-${hit.total}`,
        ])
      : await db.select<PrintHit[]>(
          `${PRINT_SELECT} WHERE p.set_code = ? AND lower(p.collector_number) IN (?, ?)`,
          [hit.set!, hit.number, hit.number.replace('*', 's')]
        )
    if (!rows.length) continue
    // le code d'extension lu départage (promos qui partagent l'id de Riot),
    // puis le nom lu, puis l'impression normale
    const scored = rows.map((r) => ({
      r,
      score:
        (setsRead.has(r.set_code) ? 4 : 0) +
        Math.max(0, ...names.map((n) => nameSimilarity(n, r.name))) * 2 +
        (r.rarity !== 'Promo' ? 0.5 : 0) +
        (r.is_default ? 0.25 : 0),
    }))
    scored.sort((a, b) => b.score - a.score)
    const r = scored[0]!.r
    // numéro sans taille : on exige que le nom lu ressemble (un numéro seul
    // est trop facile à mal lire)
    if (!hit.total && names.length && scored[0]!.score < 4 + 0.6 * 2) continue
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

// noms possibles : lignes du haut, et deux lignes voisines recollées
// (« Jinx » + « REBEL » → « Jinx, REBEL »)
export function nameGuesses(lines: OcrLine[]): string[] {
  const single = nameCandidates(lines, 4)
  const joined = single.slice(0, -1).map((t, i) => `${t}, ${single[i + 1]}`)
  return [...joined, ...single]
}

async function byName(lines: OcrLine[]): Promise<Found | null> {
  const db = (await useDatabase()).cards('riftbound')
  let best: Found | null = null
  for (const text of nameGuesses(lines)) {
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
      // nom complet, ou sa partie avant la virgule pour une carte sans
      // sous-titre lu (légèrement pénalisée : plusieurs cartes la partagent)
      const score = Math.max(
        nameSimilarity(text, r.name),
        nameSimilarity(text, r.name.split(', ')[0]!) - 0.15
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
