<template>
  <div class="h-screen flex flex-col overflow-hidden">
    <header class="border-b border-default bg-elevated shrink-0">
      <div class="flex items-center justify-between px-4 h-14 w-full">
        <div class="font-medium flex-1">card-manager</div>
        <nav v-if="!isMobile" class="flex gap-6 text-sm">
          <NuxtLink
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            class="hover:text-primary"
          >
            {{ item.label }}
          </NuxtLink>
        </nav>
        <div class="flex items-center gap-2 flex-1 justify-end">
          <UColorModeButton />
          <UButton
            v-if="isMobile"
            icon="i-lucide-menu"
            color="neutral"
            variant="ghost"
            aria-label="Menu"
            @click="openMenu"
          />
        </div>
      </div>
    </header>

    <!-- menu de navigation : slideover par la DROITE -->
    <USlideover v-if="isMobile" v-model:open="menuOpen" side="right" title="Menu">
      <template #body>
        <nav class="flex flex-col gap-1">
          <NuxtLink
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            class="px-3 py-2 rounded-md hover:bg-elevated"
            @click="menuOpen = false"
          >
            {{ item.label }}
          </NuxtLink>
        </nav>
      </template>
    </USlideover>

    <main class="flex-1 min-h-0">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
const { isMobile } = useResponsive()
const menuOpen = ref(false)
function openMenu() {
  menuOpen.value = true
}
const navItems = [
  { label: 'Collection', to: '/collection' },
  { label: 'Decks', to: '/decks' },
  { label: 'Partage', to: '/share' },
  { label: 'Search', to: '/search' },
  { label: 'Settings', to: '/settings' },
]
watch(isMobile, (mobile) => {
  if (!mobile) menuOpen.value = false
})
</script>
