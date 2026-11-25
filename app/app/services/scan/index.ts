import { gameModuleOrNull } from '~/services/game/modules'
import type { OcrLine } from './text'
import type { Identified, ScanZone } from './types'

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
export { NAME_THRESHOLD, type Identified, type ScanZone } from './types'

export function canScan(game: string): boolean {
  return !!gameModuleOrNull(game)?.scan
}

// zones de la carte à relire de près pour trouver l'impression (aucune = rien)
export function scanZones(game: string): ScanZone[] {
  return gameModuleOrNull(game)?.scanZones ?? []
}

// lignes d'une 2e lecture (zone agrandie) ajoutées sous celles de la carte
// entière : elles ne passent jamais pour le nom (lu en haut de la carte)
export function withZoneLines(lines: OcrLine[], zoneLines: OcrLine[]): OcrLine[] {
  const bottom = Math.max(0, ...lines.map((l) => (l.y ?? 0) + (l.h ?? 0)))
  return [...lines, ...zoneLines.map((l) => ({ ...l, y: bottom + 1 + (l.y ?? 0) }))]
}

export async function identifyCard(game: string, lines: OcrLine[]): Promise<Identified | null> {
  const scan = gameModuleOrNull(game)?.scan
  return scan ? scan(lines) : null
}
