<template>
  <nav
    id="mobile-tabbar"
    aria-label="Navigation principale"
    class="shrink-0 border-t border-default bg-elevated/95 backdrop-blur"
    :style="{ paddingBottom: 'var(--safe-bottom)' }"
  >
    <div
      class="grid h-16"
      :style="{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }"
    >
      <template v-for="tab in tabs" :key="tab.to">
        <!-- scan : gros bouton central, l'action la plus fréquente au téléphone -->
        <NuxtLink
          v-if="tab.primary"
          :to="tab.to"
          :data-tab="tab.id"
          :aria-label="tab.label"
          class="justify-self-center -mt-6 size-15 rounded-full bg-primary text-inverted flex items-center justify-center shadow-lg ring-4 ring-(--ui-bg)"
        >
          <UIcon :name="tab.icon" class="size-7" />
        </NuxtLink>
        <NuxtLink
          v-else
          :to="tab.to"
          :data-tab="tab.id"
          :data-active="isActive(tab.to) || undefined"
          class="flex flex-col items-center justify-center gap-1 text-[11px] font-medium"
          :class="isActive(tab.to) ? 'text-primary' : 'text-muted'"
        >
          <UIcon :name="tab.icon" class="size-6" />
          {{ tab.label }}
        </NuxtLink>
      </template>
    </div>
  </nav>
</template>

<script setup lang="ts">
const route = useRoute()

interface Tab {
  id: string
  label: string
  to: string
  icon: string
  primary?: boolean
}

// le scan n'existe que dans l'app Android
const tabs: Tab[] = [
  { id: 'collection', label: 'Collection', to: '/collection', icon: 'i-lucide-library' },
  { id: 'search', label: 'Recherche', to: '/search', icon: 'i-lucide-search' },
  ...(isAndroid()
    ? [{ id: 'scan', label: 'Scanner', to: '/scan', icon: 'i-lucide-scan-line', primary: true }]
    : []),
  { id: 'decks', label: 'Decks', to: '/decks', icon: 'i-lucide-layers' },
  { id: 'share', label: 'Partage', to: '/share', icon: 'i-lucide-share-2' },
]

function isActive(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>
