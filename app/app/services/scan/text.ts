// ============================================================
// SCAN — analyse pure du texte reconnu par l'OCR (aucune base).
//   - codes d'impression YGO (« LOB-EN005 ») tolérants aux variantes
//     régionales (LOB-FR005, LOB-F005, LOB-005) et aux confusions
//     classiques de l'OCR dans la partie numérique (O→0, I/l→1, S→5, B→8)
//   - similarité de noms (Levenshtein normalisé)
//   - stabilisation : une carte n'est retenue que vue sur plusieurs
//     images de suite, et pas ré-ajoutée tant qu'elle reste à l'écran
// ============================================================

export interface OcrLine {
  text: string
  x?: number
  y?: number
  w?: number
  h?: number
}

export interface SetCodeRef {
  set: string // « LOB », « MP24 »…
  number: string // 3 chiffres : « 005 »
  key: string // clé indépendante de la région : « LOB-005 »
  region: string // « EN », « FR », « F »… ; '' si absente
  language: string | null // langue de la carte (ids du registre de jeux), null si inconnue
}

// La région du code d'impression dit dans quelle langue la carte est imprimée
// (le passcode, lui, est le même dans toutes les langues). Codes actuels à
// 2 lettres, anciens codes européens à 1 lettre, pas de région = premières
// impressions nord-américaines (anglais). AE = anglais d'Asie. Les régions
// sans langue gérée (chinois TC/SC…) renvoient null → langue par défaut.
const REGION_LANGUAGE: Record<string, string> = {
  '': 'en',
  EN: 'en',
  E: 'en',
  AE: 'en',
  FR: 'fr',
  F: 'fr',
  FC: 'fr', // français du Canada
  DE: 'de',
  G: 'de',
  IT: 'it',
  I: 'it',
  SP: 'es',
  S: 'es',
  PT: 'pt',
  P: 'pt',
  JP: 'ja',
  JA: 'ja',
  KR: 'ko',
  K: 'ko',
}

export function regionLanguage(region: string): string | null {
  return REGION_LANGUAGE[region] ?? null
}

const DIGIT_FIX: Record<string, string> = {
  O: '0',
  Q: '0',
  D: '0',
  I: '1',
  L: '1',
  S: '5',
  B: '8',
  Z: '2',
}

// set (2-5 alphanum) - région optionnelle (0-2 lettres) + 3 « chiffres »
const SET_CODE_RE = /\b([A-Z0-9]{2,5})\s?-\s?([A-Z]{0,2}?)([0-9OQDILSBZ]{3})\b/g

export function parseSetCode(raw: string): SetCodeRef | null {
  SET_CODE_RE.lastIndex = 0
  const m = SET_CODE_RE.exec(raw.toUpperCase())
  if (!m) return null
  return toRef(m[1]!, m[2]!, m[3]!)
}

function toRef(set: string, region: string, digits: string): SetCodeRef | null {
  const number = digits.replace(/[OQDILSBZ]/g, (c) => DIGIT_FIX[c]!)
  // un set est fait de lettres (et parfois de chiffres) mais jamais uniquement de chiffres
  if (!/[A-Z]/.test(set)) return null
  return { set, number, key: `${set}-${number}`, region, language: regionLanguage(region) }
}

// tous les codes d'impression plausibles trouvés dans les lignes OCR
export function extractSetCodes(lines: OcrLine[]): SetCodeRef[] {
  const out = new Map<string, SetCodeRef>()
  for (const line of lines) {
    const text = line.text.toUpperCase()
    SET_CODE_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = SET_CODE_RE.exec(text))) {
      const ref = toRef(m[1]!, m[2]!, m[3]!)
      if (ref) out.set(ref.key, ref)
    }
  }
  return [...out.values()]
}

// ── passcode (8 chiffres en bas à gauche de la carte) ──
// Les zéros de tête imprimés (« 04031928 ») n'existent pas dans les ids de
// la base : on renvoie la forme canonique (« 4031928 »).
const PASSCODE_RE = /\b[0-9OQDILSBZ]{8}\b/g

export function extractPasscodes(lines: OcrLine[]): string[] {
  const out = new Set<string>()
  for (const line of lines) {
    const text = line.text.toUpperCase()
    PASSCODE_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PASSCODE_RE.exec(text))) {
      const raw = m[0]
      // au moins 6 vrais chiffres : sinon c'est un mot, pas un passcode
      if ((raw.match(/\d/g) ?? []).length < 6) continue
      const digits = raw.replace(/[OQDILSBZ]/g, (c) => DIGIT_FIX[c]!)
      out.add(String(Number(digits)))
    }
  }
  return [...out]
}

// ── noms ──

export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    prev = cur
  }
  return prev[b.length]!
}

// 1 = identique, 0 = rien à voir
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a)
  const y = normalizeName(b)
  if (!x || !y) return 0
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length)
}

// lignes susceptibles d'être le nom : en haut de l'image, surtout des lettres
export function nameCandidates(lines: OcrLine[], max = 3): string[] {
  return lines
    .filter((l) => {
      const t = l.text.trim()
      const letters = (t.match(/[A-Za-zÀ-ÿ]/g) ?? []).length
      return t.length >= 3 && letters / t.length >= 0.6 && !SET_CODE_LIKE.test(t)
    })
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0))
    .slice(0, max)
    .map((l) => l.text.trim())
}
const SET_CODE_LIKE = /\b[A-Z0-9]{2,5}-[A-Z]{0,2}\d{2,3}\b/i

// ── stabilisation entre images ──

export interface Detection {
  cardId: string
}

// Vote sur les `windowSize` dernières images : une carte est retenue dès
// qu'elle y apparaît `confirmFrames` fois (les images ratées, fréquentes en
// direct, ne remettent pas le compteur à zéro). Elle n'est re-signalée
// qu'après avoir quitté l'image `clearFrames` images de suite (pour scanner
// plusieurs exemplaires : on retire la carte, on la remet).
export class ScanStabilizer<T extends Detection> {
  private window: (string | null)[] = []
  private lastAccepted: string | null = null
  private absent = 0

  constructor(
    private readonly confirmFrames = 2,
    private readonly clearFrames = 3,
    private readonly windowSize = 4
  ) {}

  push(detection: T | null): T | null {
    const id = detection?.cardId ?? null

    // la dernière carte ajoutée doit quitter l'image avant d'être ré-ajoutée
    if (this.lastAccepted) {
      if (id === this.lastAccepted) {
        this.absent = 0
        return null
      }
      if (++this.absent >= this.clearFrames) this.lastAccepted = null
    }

    this.window.push(id)
    if (this.window.length > this.windowSize) this.window.shift()
    if (id === null) return null

    if (this.window.filter((x) => x === id).length >= this.confirmFrames) {
      this.lastAccepted = id
      this.absent = 0
      this.window = []
      return detection
    }
    return null
  }
}
