<template>
  <nav
    id="mobile-tabbar"
    aria-label="Main navigation"
    class="shrink-0 border-t border-default bg-elevated/95 backdrop-blur"
    :style="{ paddingBottom: 'var(--safe-bottom)' }"
  >
    <div
      class="grid h-16 short:h-12"
      :style="{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }"
    >
      <template v-for="tab in tabs" :key="tab.to">
        <!-- scan : gros bouton central, l'action la plus fréquente au téléphone -->
        <NuxtLink
          v-if="tab.primary"
          :to="tab.to"
          :data-tab="tab.id"
          :aria-label="tab.label"
          class="justify-self-center -mt-6 size-15 short:-mt-4 short:size-12 rounded-full bg-primary text-inverted flex items-center justify-center shadow-lg ring-4 ring-(--ui-bg)"
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
          <UIcon :name="tab.icon" class="size-6 short:size-5" />
          <span class="short:hidden">{{ tab.label }}</span>
        </NuxtLink>
      </template>
    </div>
  </nav>
</template>

<script setup lang="ts">
const route = useRoute()

// le scan n'existe que dans l'app Android, et pour un jeu qui sait scanner
const { tabs } = useMobileTabs()

function isActive(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>
