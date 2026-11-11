// ============================================================
// Écrans doubles et pliables à charnière (Surface Duo, Galaxy Fold en
// mode « flex », Huawei Mate X, Oppo Find N…) : quand l'appli s'étale
// sur deux écrans, le système expose deux « segments » de fenêtre séparés
// par la charnière. On les lit (API Viewport Segments : window.viewport.
// segments ; ancienne API window.getWindowSegments) pour ne rien poser sous
// la charnière : la page met son panneau latéral sur l'écran de gauche et
// son contenu sur celui de droite (cf. appPage.vue).
// En E2E, window.__testSegments simule un appareil.
// ============================================================

import { computeSegments, type RectLike, type Segments } from '~/utils/segments'

function readSegments(): RectLike[] {
  const w = window as unknown as {
    __testSegments?: RectLike[]
    viewport?: { segments?: RectLike[] | null }
    getWindowSegments?: () => RectLike[]
  }
  if (import.meta.env.VITE_TEST_MODE === 'true' && w.__testSegments) return w.__testSegments
  return w.viewport?.segments ?? w.getWindowSegments?.() ?? []
}

export const useViewportSegments = createGlobalState(() => {
  const segments = ref<Segments>({ columns: false, leftWidth: 0, hingeWidth: 0 })
  const update = () => {
    segments.value = computeSegments(readSegments())
  }
  if (typeof window !== 'undefined') {
    update()
    window.addEventListener('resize', update)
    // la posture d'un pliable peut changer sans redimensionner la fenêtre
    ;(window as unknown as { viewport?: EventTarget }).viewport?.addEventListener?.(
      'segmentschange',
      update
    )
  }
  return { segments, update }
})
