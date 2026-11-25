// types communs du scan (tous jeux)

export interface Identified {
  cardId: string
  printingId: string | null
  // impression lisible (« LOB-EN005 », « BLB #280 ») ; null si inconnue
  printingLabel: string | null
  name: string
  via: 'setcode' | 'passcode' | 'name'
  score: number // 1 pour un code d'impression, similarité du nom sinon
  // langue lue dans la région du code d'impression (« LOB-FR005 » → fr) ;
  // null si pas de code lu (passcode et nom sont les mêmes dans toutes les langues)
  language: string | null
  // mention « 1st Edition » (ou équivalent) lue sur la carte
  firstEdition: boolean
}

export const NAME_THRESHOLD = 0.8

// zone d'une carte relue de près quand l'impression n'a pas été trouvée
// (numéro de collection, code d'impression : petit texte que l'OCR rate
// sur la carte entière). Fractions de la carte (0..1, portrait).
export interface ScanZone {
  x: number
  y: number
  w: number
  h: number
}
