<template>
  <!-- MOBILE : pas d'en-tête global (chaque page a son titre), onglets en bas -->
  <div
    v-if="isMobile"
    class="h-dvh flex flex-col overflow-hidden"
    :style="{ paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }"
  >
    <main class="flex-1 min-h-0" :style="mainStyle">
      <slot />
    </main>
    <MobileTabBar v-if="!fullscreen" />
  </div>

  <!-- DESKTOP (et tablettes, pliables dépliés) : marges système aussi
       (caméra incrustée ou encoche sur le côté d'une tablette en paysage) -->
  <div
    v-else
    class="h-dvh flex flex-col overflow-hidden"
    :style="{
      paddingTop: 'var(--safe-top)',
      paddingBottom: 'var(--safe-bottom)',
      paddingLeft: 'var(--safe-left)',
      paddingRight: 'var(--safe-right)',
    }"
  >
    <header class="border-b border-default bg-elevated shrink-0">
      <!-- double écran : le nom sur l'écran de gauche, la navigation sur celui
           de droite (rien sous la charnière) -->
      <div class="flex items-center justify-between px-4 h-14 w-full">
        <div
          class="font-medium"
          :class="dual ? 'shrink-0' : 'flex-1'"
          :style="
            dual ? { width: `${segments.leftWidth + segments.hingeWidth - 16}px` } : undefined
          "
        >
          card-manager
        </div>
        <nav class="flex text-sm" :class="dual ? 'flex-1 justify-center gap-4' : 'gap-6'">
          <NuxtLink
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            class="hover:text-primary"
            active-class="text-primary"
          >
            {{ item.label }}
          </NuxtLink>
        </nav>
        <div class="flex items-center gap-2 justify-end" :class="!dual && 'flex-1'">
          <GamePicker :compact="dual" />
          <UColorModeButton />
        </div>
      </div>
    </header>
    <main class="flex-1 min-h-0">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
const { isMobile } = useResponsive()
const route = useRoute()
// pages en plein écran sur mobile (scan : la caméra prend tout)
const fullscreen = computed(() => route.meta.fullscreen === true)

const { segments } = useViewportSegments()
const dual = computed(() => segments.value.columns && segments.value.leftWidth >= 280)

// mobile : sous la barre d'état / la caméra incrustée en haut ; en bas, la
// hauteur dont le bouton Scan dépasse de la barre d'onglets
const { raised } = useMobileTabs()
const mainStyle = computed(() =>
  fullscreen.value
    ? undefined
    : {
        paddingTop: 'var(--safe-top)',
        paddingBottom: raised.value ? RAISED_TAB_OVERLAP : undefined,
      }
)

const navItems = [
  { label: 'Collection', to: '/collection' },
  { label: 'Search', to: '/search' },
  { label: 'Decks', to: '/decks' },
  { label: 'Share', to: '/share' },
  { label: 'Settings', to: '/settings' },
]
</script>
