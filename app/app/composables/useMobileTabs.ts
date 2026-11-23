import { canScan } from '~/services/scan'

// ============================================================
// Onglets de la barre du bas (mobile). Le scan (Android, jeu qui sait
// scanner) est un gros bouton central qui DÉPASSE au-dessus de la barre :
// `raised` permet à la mise en page de réserver cette hauteur (sinon il
// recouvre le bas des pages, ex. la pagination de la recherche).
// ============================================================

export interface MobileTab {
  id: string
  label: string
  to: string
  icon: string
  primary?: boolean
}

// hauteur dont le bouton central dépasse de la barre (cf. -mt-6 du bouton)
export const RAISED_TAB_OVERLAP = '1.5rem'

export function useMobileTabs() {
  const { game } = useCurrentGame()
  const tabs = computed<MobileTab[]>(() => [
    { id: 'collection', label: 'Collection', to: '/collection', icon: 'i-lucide-library' },
    { id: 'search', label: 'Search', to: '/search', icon: 'i-lucide-search' },
    ...(isAndroid() && canScan(game.value)
      ? [{ id: 'scan', label: 'Scan', to: '/scan', icon: 'i-lucide-scan-line', primary: true }]
      : []),
    { id: 'decks', label: 'Decks', to: '/decks', icon: 'i-lucide-layers' },
    { id: 'share', label: 'Share', to: '/share', icon: 'i-lucide-share-2' },
  ])
  const raised = computed(() => tabs.value.some((t) => t.primary))
  return { tabs, raised }
}
