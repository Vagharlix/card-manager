<template>
  <div class="flex flex-col">
    <!-- en-tête de zone avec compteur -->
    <div class="flex items-center gap-2 mb-2 sticky top-0 bg-default py-1 z-10">
      <h3 class="text-sm font-medium">{{ label }}</h3>
      <span class="text-xs px-1.5 py-0.5 rounded" :class="countClass">
        {{ count }}<template v-if="showMax"> / {{ max }}</template>
      </span>
    </div>

    <!-- cartes de la zone -->
    <div
      v-if="cards.length"
      class="grid gap-2 grid-cols-5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10"
    >
      <div v-for="c in cards" :key="c.cardId" class="relative">
        <button class="block w-full" @click="$emit('remove', c)">
          <div
            class="aspect-[0.686] rounded overflow-hidden border border-transparent hover:border-error transition-colors"
          >
            <ArtThumb :passcode="c.cardId" class="w-full h-full object-cover" />
          </div>
        </button>
        <!-- quantité -->
        <div
          v-if="c.quantity > 1"
          class="absolute bottom-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full bg-primary text-inverted text-[10px] font-medium flex items-center justify-center"
        >
          {{ c.quantity }}
        </div>
        <!-- non possédée -->
        <div
          v-if="c.owned < c.quantity"
          class="absolute top-0.5 left-0.5 size-4 rounded-full bg-warning text-inverted flex items-center justify-center"
          :title="`Tu possèdes ${c.owned} / ${c.quantity}`"
        >
          <UIcon name="i-lucide-alert-triangle" class="text-[10px]" />
        </div>
        <!-- bouton info + side -->
        <div
          class="absolute top-0.5 right-0.5 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 hover:opacity-100"
        >
          <UButton
            icon="i-lucide-info"
            color="neutral"
            variant="solid"
            size="2xs"
            @click.stop="$emit('info', c)"
          />
        </div>
      </div>
    </div>
    <p v-else class="text-xs text-dimmed italic py-2">Vide</p>
  </div>
</template>

<script setup lang="ts">
import type { DeckCard } from '~/services/decks'

const props = defineProps<{
  label: string
  cards: DeckCard[]
  min: number
  max: number
  showMax?: boolean
}>()

defineEmits<{ remove: [card: DeckCard]; info: [card: DeckCard] }>()

const count = computed(() => props.cards.reduce((s, c) => s + c.quantity, 0))

const countClass = computed(() => {
  const n = count.value
  if (n < props.min || n > props.max) return 'bg-error/15 text-error'
  return 'bg-elevated text-muted'
})
</script>
