<template>
  <div class="flex flex-1 h-full overflow-hidden">
    <!-- DESKTOP : sidebar fixe -->
    <aside
      v-if="!isMobile && $slots.sidebar"
      class="w-80 shrink-0 border-r border-default overflow-y-auto p-4"
    >
      <slot name="sidebar" />
    </aside>

    <!-- MOBILE : sidebar en slideover -->
    <USlideover v-if="isMobile && $slots.sidebar" v-model:open="sidebarOpen" :title="sidebarLabel">
      <template #body>
        <slot name="sidebar" />
      </template>
    </USlideover>

    <!-- contenu : hauteur contrainte, pas de scroll ici (la page gère son scroll interne) -->
    <div class="flex-1 min-h-0 overflow-hidden p-4 flex flex-col">
      <UButton
        v-if="isMobile && $slots.sidebar"
        icon="i-lucide-filter"
        variant="soft"
        :label="sidebarLabel"
        class="mb-4 shrink-0 self-start"
        @click="sidebarOpen = true"
      />
      <div class="flex-1 min-h-0">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ sidebarLabel?: string }>(), {
  sidebarLabel: 'Filtres',
})

const { isMobile } = useResponsive()
const sidebarOpen = ref(false)
</script>
