import { gameModuleOrNull } from '~/services/game/modules'
import type { OcrLine } from './text'
import type { Identified } from './types'

// ============================================================
// SCAN — identification d'une carte à partir du texte OCR.
// Routeur : chaque jeu fournit (ou non) son moteur dans son module
// (services/game/modules). YGO : services/scan/ygo.ts.
// ============================================================

export {
  ScanStabilizer,
  extractPasscodes,
  extractSetCodes,
  nameSimilarity,
  parseSetCode,
  regionLanguage,
  detectFirstEdition,
} from './text'
export type { OcrLine, SetCodeRef } from './text'
export { NAME_THRESHOLD, type Identified } from './types'

export function canScan(game: string): boolean {
  return !!gameModuleOrNull(game)?.scan
}

export async function identifyCard(game: string, lines: OcrLine[]): Promise<Identified | null> {
  const scan = gameModuleOrNull(game)?.scan
  return scan ? scan(lines) : null
}
