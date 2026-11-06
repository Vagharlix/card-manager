<template>
  <!-- MOBILE : pas d'en-tête global (chaque page a son titre), onglets en bas -->
  <div
    v-if="isMobile"
    class="h-dvh flex flex-col overflow-hidden"
    :style="{ paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }"
  >
    <main
      class="flex-1 min-h-0"
      :style="fullscreen ? undefined : { paddingTop: 'var(--safe-top)' }"
    >
      <slot />
    </main>
    <MobileTabBar v-if="!fullscreen" />
  </div>

  <!-- DESKTOP -->
  <div v-else class="h-screen flex flex-col overflow-hidden">
    <header class="border-b border-default bg-elevated shrink-0">
      <div class="flex items-center justify-between px-4 h-14 w-full">
        <div class="font-medium flex-1">card-manager</div>
        <nav class="flex gap-6 text-sm">
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
        <div class="flex items-center gap-2 flex-1 justify-end">
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

const navItems = [
  { label: 'Collection', to: '/collection' },
  { label: 'Recherche', to: '/search' },
  { label: 'Decks', to: '/decks' },
  { label: 'Partage', to: '/share' },
  { label: 'Réglages', to: '/settings' },
]
</script>
