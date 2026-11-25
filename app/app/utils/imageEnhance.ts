// ============================================================
// Amélioration d'une petite zone d'image avant l'OCR (numéro de collection
// relu de près) : niveaux de gris puis contraste étiré entre les 2e et 98e
// centiles. Le texte fin, gris sur fond clair (ou délavé par l'écran d'une
// photo, le moiré, un reflet), redevient franchement sombre sur clair.
// Pur : travaille sur les octets RGBA d'un ImageData (testé).
// ============================================================

export function enhanceForOcr(rgba: Uint8ClampedArray, lowPct = 0.02, highPct = 0.98): void {
  const n = rgba.length / 4
  if (!n) return
  const gray = new Uint8Array(n)
  const hist = new Uint32Array(256)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    // luminance (Rec. 601), en entier
    const g = (rgba[p]! * 299 + rgba[p + 1]! * 587 + rgba[p + 2]! * 114) / 1000
    const v = g | 0
    gray[i] = v
    hist[v]!++
  }
  const percentile = (q: number) => {
    const target = q * n
    let acc = 0
    for (let v = 0; v < 256; v++) {
      acc += hist[v]!
      if (acc >= target) return v
    }
    return 255
  }
  const lo = percentile(lowPct)
  const hi = percentile(highPct)
  const span = Math.max(1, hi - lo)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const v = Math.max(0, Math.min(255, ((gray[i]! - lo) * 255) / span))
    rgba[p] = rgba[p + 1] = rgba[p + 2] = v
    rgba[p + 3] = 255
  }
}
