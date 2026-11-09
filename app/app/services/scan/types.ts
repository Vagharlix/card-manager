// types communs du scan (tous jeux)

export interface Identified {
  cardId: string
  printingId: string | null
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
