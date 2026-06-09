<template>
  <div>
    <div v-if="loading" class="grid gap-3" :class="gridCols">
      <USkeleton v-for="i in skeletonCount" :key="i" class="aspect-[0.686] rounded-lg" />
    </div>

    <div
      v-else-if="!cards.length"
      class="flex flex-col items-center justify-center text-center py-20 text-muted"
    >
      <UIcon name="i-lucide-search-x" class="text-4xl mb-3" />
      <p>{{ emptyMessage }}</p>
    </div>

    <div v-else class="grid gap-3" :class="gridCols">
      <CardThumb
        v-for="card in cards"
        :key="card.id"
        :card="card"
        :owned="ownedIds?.has(card.id)"
        :show-name="showNames"
        @select="$emit('select', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CardSearchResult } from '~/services/search'

const props = withDefaults(
  defineProps<{
    cards: CardSearchResult[]
    loading?: boolean
    ownedIds?: Set<string>
    showNames?: boolean
    emptyMessage?: string
  }>(),
  {
    loading: false,
    showNames: false,
    emptyMessage: 'Aucune carte trouvée',
  }
)

defineEmits<{ select: [card: CardSearchResult] }>()

const gridCols = 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8'

const skeletonCount = computed(() => 24)
</script>
