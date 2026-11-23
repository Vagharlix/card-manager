// Calcul pur des segments d'écran (doubles écrans / pliables), testé
// (test/unit/segments.test.ts). Lecture des segments : useViewportSegments.

export interface Segments {
  // deux écrans côte à côte (charnière verticale)
  columns: boolean
  leftWidth: number // largeur de l'écran de gauche (px CSS)
  hingeWidth: number // largeur de la charnière (0 pour un pliable sans trou)
}

export type RectLike = { left: number; top: number; width: number; height: number }

export function computeSegments(rects: RectLike[]): Segments {
  const none = { columns: false, leftWidth: 0, hingeWidth: 0 }
  if (rects.length !== 2) return none
  const [a, b] = [...rects].sort((x, y) => x.left - y.left || x.top - y.top) as [RectLike, RectLike]
  // côte à côte : même hauteur de départ, le second commence à droite du premier
  if (Math.abs(a.top - b.top) < 1 && b.left >= a.left + a.width - 1) {
    return {
      columns: true,
      leftWidth: a.width,
      hingeWidth: Math.max(0, b.left - (a.left + a.width)),
    }
  }
  return none
}
