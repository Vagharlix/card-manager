import { useDatabase } from '~/composables/useDatabase'
import {
  detectFirstEdition,
  extractPasscodes,
  extractSetCodes,
  nameCandidates,
  nameSimilarity,
  parseSetCode,
  type OcrLine,
} from './text'
import { NAME_THRESHOLD, type Identified } from './types'

// ============================================================
// SCAN YGO — identification d'une carte à partir du texte OCR :
//   1. code d'impression (« LOB-EN005 ») → table printings : donne la
//      carte ET l'impression exacte. Le plus fiable.
//   2. sinon le passcode (8 chiffres en bas à gauche) → l'artwork exact.
//   3. sinon le nom (lignes du haut de l'image) → FTS puis similarité
//      de Levenshtein ≥ NAME_THRESHOLD, artwork principal privilégié.
// ============================================================

type Found = Omit<Identified, 'firstEdition' | 'printingLabel'>

export async function identifyYgo(lines: OcrLine[]): Promise<Identified | null> {
  const found = (await bySetCode(lines)) ?? (await byPasscode(lines)) ?? (await byName(lines))
  return (
    found && {
      ...found,
      printingLabel: found.printingId,
      firstEdition: detectFirstEdition(lines),
    }
  )
}

async function bySetCode(lines: OcrLine[]): Promise<Found | null> {
  const ygo = (await useDatabase()).cards('ygo')
  for (const code of extractSetCodes(lines)) {
    const rows = await ygo.select<
      { id: string; card_id: string; set_code: string; name: string }[]
    >(
      `SELECT p.id, p.card_id, p.set_code, c.name
       FROM printings p JOIN cards c ON c.id = p.card_id
       WHERE p.set_code LIKE ?`,
      [`${code.set}-%`]
    )
    const matches = rows.filter((r) => parseSetCode(r.set_code)?.number === code.number)
    // plusieurs régions possibles pour un même numéro : l'anglaise d'abord
    const best = matches.find((r) => /-EN\d/.test(r.set_code)) ?? matches[0]
    if (best) {
      return {
        cardId: best.card_id,
        printingId: best.id,
        name: best.name,
        via: 'setcode',
        score: 1,
        language: code.language,
      }
    }
  }
  return null
}

async function byPasscode(lines: OcrLine[]): Promise<Found | null> {
  const codes = extractPasscodes(lines)
  if (!codes.length) return null
  const ygo = (await useDatabase()).cards('ygo')
  const ph = codes.map(() => '?').join(', ')
  const rows = await ygo.select<{ id: string; name: string }[]>(
    `SELECT id, name FROM cards WHERE id IN (${ph})`,
    codes
  )
  const hit = rows[0]
  return hit
    ? {
        cardId: hit.id,
        printingId: null,
        name: hit.name,
        via: 'passcode',
        score: 1,
        language: null,
      }
    : null
}

async function byName(lines: OcrLine[]): Promise<Found | null> {
  const ygo = (await useDatabase()).cards('ygo')
  let best: Found | null = null
  for (const text of nameCandidates(lines)) {
    const words = text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^A-Za-z0-9]+/)
      .filter((w) => w.length >= 3)
    if (!words.length) continue
    const match = `name : (${words.map((w) => `"${w}"*`).join(' OR ')})`
    const rows = await ygo.select<{ id: string; name: string; alias: string | null }[]>(
      `SELECT c.id, c.name, d.alias
       FROM cards_fts JOIN cards c ON c.rowid = cards_fts.rowid
       JOIN ygo_details d ON d.card_id = c.id
       WHERE cards_fts MATCH ?
       LIMIT 200`,
      [match]
    )
    for (const r of rows) {
      const score = nameSimilarity(text, r.name)
      // à score égal, l'artwork principal (sans alias) l'emporte
      const better = !best || score > best.score || (score === best.score && r.alias === null)
      if (score >= NAME_THRESHOLD && better) {
        best = {
          cardId: r.alias ?? r.id,
          printingId: null,
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
