// L'app mobile tourne dans la WebView Android : caméra (scan QR, OCR) dispo.
export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)
}
