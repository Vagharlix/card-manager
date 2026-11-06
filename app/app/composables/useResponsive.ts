import { useBreakpoints } from '@vueuse/core'

export function useResponsive() {
  const breakpoints = useBreakpoints({
    sm: 640,
    md: 768,
    lg: 1024,
    xl: 1280,
  })

  return {
    isMobile: breakpoints.smaller('md'), // < 768px
    isTablet: breakpoints.between('md', 'lg'),
    isDesktop: breakpoints.greaterOrEqual('lg'),
    breakpoints,
  }
}
