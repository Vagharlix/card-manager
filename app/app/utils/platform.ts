// L'app mobile tourne dans la WebView Android : caméra (scan QR, OCR) dispo.
export function isAndroid(): boolean {
  if (testFlag('__forceAndroid')) return true // captures multi-appareils (E2E)
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)
}

// drapeaux de simulation d'appareil, en build de test seulement
export function testFlag(name: string): boolean {
  if (import.meta.env.VITE_TEST_MODE !== 'true') return false
  try {
    return localStorage.getItem(name) === '1'
  } catch {
    return false
  }
}
