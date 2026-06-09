<template>
  <AppPage>
    <UInput v-model="query" placeholder="Nom de carte..." class="mb-4" />
    <div class="grid grid-cols-4 gap-3">
      <div v-for="card in results" :key="card.id" class="text-xs">
        <CardImageTest :passcode="card.id" />
        <p class="mt-1 truncate">{{ card.name }}</p>
      </div>
    </div>
  </AppPage>
</template>

<script setup lang="ts">
import { searchCards } from '~/services/search'

const query = ref('')
const results = ref<any[]>([])

watchDebounced(
  query,
  async (q) => {
    results.value = await searchCards('ygo', { query: q, field: 'name', limit: 24 })
  },
  { debounce: 100 }
)
</script>
