<template>
  <AppPage sidebar-label="Sections">
    <template #sidebar>
      <nav class="flex flex-col gap-1">
        <button
          v-for="section in sections"
          :key="section.id"
          class="text-left px-3 py-2 rounded-md text-sm"
          :class="active === section.id ? 'bg-elevated text-primary' : 'hover:bg-elevated'"
          @click="active = section.id"
        >
          {{ section.label }}
        </button>
      </nav>
    </template>

    <!-- Exemple de settings en gros -->
    <div v-if="active === 'games'">
      <h2 class="text-lg font-medium mb-4">Jeux</h2>
    </div>
    <div v-else-if="active === 'sync'">
      <h2 class="text-lg font-medium mb-4">Synchronisation</h2>
    </div>
    <div v-else-if="active === 'appearance'">
      <h2 class="text-lg font-medium mb-4">Apparence</h2>
    </div>
  </AppPage>
</template>

<script setup lang="ts">
const sections = [
  { id: 'games', label: 'Jeux' },
  { id: 'sync', label: 'Synchronisation' },
  { id: 'appearance', label: 'Apparence' },
]

const active = ref('games')
</script>
