<template>
  <div class="flex flex-1">
    <aside
      v-if="!isMobile && $slots.sidebar"
      class="w-64 shrink-0 border-r border-default overflow-y-auto p-4"
    >
      <slot name="sidebar" />
    </aside>

    <USlideover v-if="isMobile && $slots.sidebar" v-model:open="sidebarOpen" title="Filtres">
      <template #body>
        <slot name="sidebar" />
      </template>
    </USlideover>

    <div class="flex-1 overflow-y-auto p-4">
      <UButton
        v-if="isMobile && $slots.sidebar"
        icon="i-lucide-filter"
        variant="soft"
        :label="sidebarLabel ?? 'Filtres'"
        class="mb-4"
        @click="sidebarOpen = true"
      />
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
const { isMobile } = useResponsive()
const sidebarOpen = ref(false)
const props = defineProps<{ sidebarLabel?: string }>()
</script>
