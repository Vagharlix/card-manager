<template>
  <div>
    <button
      type="button"
      class="card-thumb group relative block w-full text-left focus:outline-none"
      :data-card-id="card.id"
      @click="onClick"
    >
      <div
        class="aspect-[0.686] rounded-lg bg-elevated relative border-2 transition-colors"
        :class="
          selectable && selected
            ? 'border-primary'
            : 'border-transparent group-hover:border-primary'
        "
      >
        <!-- squelette tant que l'image n'est pas arrivée (puis retiré : une
             animation par vignette redessinerait la grille en continu) -->
        <USkeleton v-if="!loaded && !error" class="absolute inset-0 rounded-md" />
        <div v-if="error" class="w-full h-full flex items-center justify-center text-dimmed">
          <UIcon name="i-lucide-image-off" class="text-2xl" />
        </div>
        <img
          v-else
          :src="src"
          :alt="card.name"
          class="relative w-full h-full object-cover rounded-md"
          loading="lazy"
          decoding="async"
          @load="loaded = true"
          @error="error = true"
        />
        <!-- voile + coche en mode sélection -->
        <div
          v-if="selectable"
          class="absolute inset-0 rounded-md transition z-20"
          :class="selected ? 'bg-primary/20' : 'bg-black/0 group-hover:bg-black/10'"
        >
          <div
            class="absolute top-1.5 left-1.5 size-5 rounded-full border-2 flex items-center justify-center"
            :class="
              selected ? 'bg-primary border-primary text-inverted' : 'border-white/70 bg-black/30'
            "
          >
            <UIcon v-if="selected" name="i-lucide-check" class="text-xs" />
          </div>
        </div>
      </div>
      <!-- pastille "possédée" (masquée en mode sélection) -->
      <div
        v-if="owned && !selectable"
        class="absolute top-1.5 right-1.5 size-5 rounded-full bg-success text-inverted flex items-center justify-center shadow z-20"
      >
        <UIcon name="i-lucide-check" class="text-xs" />
      </div>
      <!-- badge quantité (masqué en mode sélection) -->
      <div
        v-if="quantity && !selectable"
        class="absolute top-1.5 left-1.5 min-w-5 h-5 px-1 rounded-full bg-primary text-inverted text-xs font-medium flex items-center justify-center shadow z-20"
      >
        ×{{ quantity }}
      </div>
      <!-- quantité en mode sélection : en bas à droite -->
      <div
        v-if="quantity && selectable"
        class="absolute bottom-1.5 right-1.5 min-w-5 h-5 px-1 rounded-full bg-primary text-inverted text-xs font-medium flex items-center justify-center shadow z-20"
      >
        ×{{ quantity }}
      </div>
      <p v-if="showName" class="mt-1 text-xs truncate text-muted">{{ card.name }}</p>
    </button>
  </div>
</template>
<script setup lang="ts">
import type { CardSearchResult } from '~/services/search'
const props = withDefaults(
  defineProps<{
    card: CardSearchResult
    owned?: boolean
    showName?: boolean
    quantity?: number
    selectable?: boolean
    selected?: boolean
  }>(),
  {
    owned: false,
    showName: false,
    selectable: false,
    selected: false,
  }
)
const emit = defineEmits<{
  select: [card: CardSearchResult]
  toggle: [card: CardSearchResult]
}>()
const { src } = useCardImage(
  () => props.card.id,
  'small',
  () => props.card.game
)
const loaded = ref(false)
const error = ref(false)
watch(src, () => {
  loaded.value = false
  error.value = false
})
function onClick() {
  if (props.selectable) emit('toggle', props.card)
  else emit('select', props.card)
}
</script>
