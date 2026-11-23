import { useBreakpoints, useMediaQuery } from '@vueuse/core'

// ============================================================
// Mise en page mobile ou bureau.
// Mobile : écran étroit (< 768 px), OU téléphone en paysage (peu de hauteur
// et écran tactile : un A52s couché fait 915 × 412, la mise en page bureau
// y serait trop serrée en hauteur). Le reste (tablettes, pliables dépliés,
// doubles écrans, PC) prend la mise en page bureau, rendue utilisable au
// doigt (contrôles visibles sans survol : variante `touch:` de main.css).
// ============================================================

export function useResponsive() {
  const breakpoints = useBreakpoints({
    sm: 640,
    md: 768,
    lg: 1024,
    xl: 1280,
  })
  const narrow = breakpoints.smaller('md') // < 768px
  const short = useMediaQuery('(max-height: 519.98px)')
  const coarse = useMediaQuery('(pointer: coarse)')
  const landscapePhone = computed(() => short.value && (coarse.value || testFlag('__forceTouch')))
  const isMobile = computed(() => narrow.value || landscapePhone.value)

  return {
    isMobile,
    isTablet: breakpoints.between('md', 'lg'),
    isDesktop: breakpoints.greaterOrEqual('lg'),
    breakpoints,
  }
}
