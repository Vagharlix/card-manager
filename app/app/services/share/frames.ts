import { SHARE_PREFIX } from './codec'

// ============================================================
// QR ANIMÉ — découpe un code de partage en une série d'images QR
// affichées en boucle, et les réassemble côté réception, dans
// n'importe quel ordre (une image ratée repasse au tour suivant).
//
// Image : "CMSQ:<lot>:<i>:<n>:<morceau>"
//   lot     = empreinte du code (4 car.), pour ne pas mélanger deux partages
//   i / n   = index (base 1) / nombre d'images
// Tout reste dans le jeu alphanumérique des QR codes (majuscules,
// chiffres, ':'), donc des QR peu denses et faciles à lire à l'écran.
// ============================================================

const FRAME_RE = /^CMSQ:([A-Z2-7]{4}):(\d+):(\d+):([A-Z2-7:]+)$/

// ~700 caractères par image → QR version ~17 : lisible sur un écran de téléphone
export const DEFAULT_CHUNK = 700

function lotOf(code: string): string {
  // FNV-1a 32 bits → 4 caractères base32
  let h = 0x811c9dc5
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let out = ''
  for (let i = 0; i < 4; i++) out += B32[(h >>> (i * 5)) & 31]
  return out
}

export function toFrames(code: string, chunk = DEFAULT_CHUNK): string[] {
  const body = code.slice(SHARE_PREFIX.length)
  const lot = lotOf(code)
  const n = Math.max(1, Math.ceil(body.length / chunk))
  const frames: string[] = []
  for (let i = 0; i < n; i++) {
    frames.push(`CMSQ:${lot}:${i + 1}:${n}:${body.slice(i * chunk, (i + 1) * chunk)}`)
  }
  return frames
}

export type AssembleResult =
  | { status: 'ignored' }
  | { status: 'progress'; got: number; total: number }
  | { status: 'complete'; code: string }

export class FrameAssembler {
  private lot = ''
  private total = 0
  private chunks = new Map<number, string>()

  get got(): number {
    return this.chunks.size
  }

  add(text: string): AssembleResult {
    const t = text.trim()
    // un code complet (QR simple, ancien format) suffit à lui seul
    if (t.toUpperCase().startsWith(SHARE_PREFIX)) return { status: 'complete', code: t }

    const m = FRAME_RE.exec(t)
    if (!m) return { status: 'ignored' }
    const [, lot, iStr, nStr, part] = m as unknown as [string, string, string, string, string]
    const i = Number(iStr)
    const n = Number(nStr)
    if (n < 1 || i < 1 || i > n) return { status: 'ignored' }

    if (lot !== this.lot || n !== this.total) {
      // nouveau partage à l'écran : on repart de zéro
      this.lot = lot
      this.total = n
      this.chunks.clear()
    }
    this.chunks.set(i, part)

    if (this.chunks.size < n) return { status: 'progress', got: this.chunks.size, total: n }
    let body = ''
    for (let k = 1; k <= n; k++) body += this.chunks.get(k)
    const code = SHARE_PREFIX + body
    // l'empreinte protège d'un mélange de morceaux entre deux partages
    if (lotOf(code) !== lot) {
      this.chunks.clear()
      return { status: 'progress', got: 0, total: n }
    }
    return { status: 'complete', code }
  }
}
