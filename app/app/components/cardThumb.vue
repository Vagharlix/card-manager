<template>
  <div class="[content-visibility:auto] [contain-intrinsic-size:auto_180px]">
    <button
      type="button"
      class="group relative block w-full text-left focus:outline-none"
      @click="$emit('select', card)"
    >
      <div
        class="aspect-[0.686] overflow-hidden bg-elevated border border-default transition group-hover:border-primary group-hover:shadow-lg"
      >
        <USkeleton v-if="loading" class="w-full h-full" />
        <div v-else-if="error" class="w-full h-full flex items-center justify-center text-dimmed">
          <UIcon name="i-lucide-image-off" class="text-2xl" />
        </div>
        <img v-else :src="src" :alt="card.name" class="w-full h-full object-cover" loading="lazy" />
      </div>

      <div
        v-if="owned"
        class="absolute top-1.5 right-1.5 size-5 rounded-full bg-success text-inverted flex items-center justify-center shadow z-10"
      >
        <UIcon name="i-lucide-check" class="text-xs" />
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
  }>(),
  {
    owned: false,
    showName: false,
  }
)

defineEmits<{ select: [card: CardSearchResult] }>()

const { src, loading, error } = useCardImage(() => props.card.id, 'small')
</script>
