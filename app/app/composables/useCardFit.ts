import type { CSSProperties } from 'vue'

// ============================================================
// Carte imprimée dans l'autre sens que sa case (champ de bataille Riftbound,
// en paysage, dans une grille de cartes en portrait) : l'image est tournée
// d'un quart de tour pour remplir la case, comme la carte posée dans un
// classeur. Rien n'est à connaître d'avance : on compare, au chargement,
// l'orientation de l'image à celle de sa case (le parent, positionné).
// Une case carrée ou de même orientation : image affichée telle quelle.
// ============================================================

export function useCardFit(
  src: MaybeRefOrGetter<string | undefined>,
  enabled: MaybeRefOrGetter<boolean> = true
) {
  const style = shallowRef<CSSProperties | undefined>()
  watch(
    () => toValue(src),
    () => (style.value = undefined)
  )

  function onLoad(e: Event) {
    const img = e.target as HTMLImageElement
    const box = img.parentElement
    if (!toValue(enabled) || !box) return
    style.value = fitStyle(img.naturalWidth, img.naturalHeight, box.clientWidth, box.clientHeight)
  }
  return { style, onLoad }
}

// style d'une image (iw × ih) dans une case (bw × bh) : quart de tour si les
// orientations diffèrent nettement, sinon rien (exporté pour les tests)
export function fitStyle(iw: number, ih: number, bw: number, bh: number): CSSProperties | undefined {
  if (!iw || !ih || !bw || !bh) return undefined
  const landscape = (w: number, h: number) => w > h * 1.05
  const portrait = (w: number, h: number) => h > w * 1.05
  const crossed =
    (landscape(iw, ih) && portrait(bw, bh)) || (portrait(iw, ih) && landscape(bw, bh))
  if (!crossed) return undefined
  // tournée, l'image occupe la case : sa largeur = hauteur de la case, et
  // inversement (en % de la case, qui garde ses proportions au redimensionnement)
  const r = bw / bh
  return {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: `${(100 / r).toFixed(3)}%`,
    height: `${(100 * r).toFixed(3)}%`,
    maxWidth: 'none',
    transform: 'translate(-50%, -50%) rotate(90deg)',
  }
}
