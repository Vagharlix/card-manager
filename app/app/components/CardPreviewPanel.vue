<template>
  <div class="w-72 shrink-0 border-l border-default flex flex-col h-full">
    <!-- en-tête avec bouton masquer -->
    <div class="flex items-center justify-between px-3 h-10 border-b border-default shrink-0">
      <span class="text-xs text-muted uppercase tracking-wide">Preview</span>
      <UButton
        icon="i-lucide-panel-right-close"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="$emit('close')"
      />
    </div>

    <!-- contenu -->
    <div class="flex-1 min-h-0 overflow-y-auto p-3">
      <div v-if="!cardId" class="text-center text-dimmed text-sm py-10">
        Click a card to see its details
      </div>

      <div v-else-if="loading" class="space-y-3">
        <USkeleton class="w-full aspect-[0.686] rounded-lg" />
        <USkeleton class="h-4 w-3/4" />
      </div>

      <div v-else-if="detail" class="space-y-3">
        <div class="rounded-lg overflow-hidden ring-1 ring-default">
          <img v-if="img.src.value" :src="img.src.value" :alt="detail.name" class="w-full" />
          <USkeleton v-else class="w-full aspect-[0.686]" />
        </div>

        <p class="font-medium text-sm">{{ detail.name }}</p>

        <div v-if="detail.facts.length" class="space-y-1 text-xs">
          <div v-for="f in detail.facts" :key="f.label" class="flex justify-between gap-3">
            <span class="text-muted">{{ f.label }}</span><span class="text-right">{{ f.value }}</span>
          </div>
        </div>

        <div v-if="detail.badges.length" class="flex flex-wrap gap-1">
          <UBadge
            v-for="b in detail.badges"
            :key="b.label"
            :color="b.color"
            variant="soft"
            size="xs"
          >
            {{ b.label }}
          </UBadge>
        </div>

        <div
          v-if="detail.legalText"
          class="text-xs whitespace-pre-line border-t border-default pt-2 text-muted"
        >
          {{ detail.legalText }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getCardDetail, type CardDetail } from '~/services/card/detail'

const props = defineProps<{
  cardId: string | null
  game: string
}>()

defineEmits<{ close: [] }>()

const detail = ref<CardDetail | null>(null)
const loading = ref(false)

const img = useCardImage(() => props.cardId ?? '', 'full')

watch(
  () => props.cardId,
  async (id) => {
    if (!id) {
      detail.value = null
      return
    }
    loading.value = true
    try {
      detail.value = await getCardDetail(props.game, id)
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)
</script>
