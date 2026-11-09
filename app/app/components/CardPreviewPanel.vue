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

        <div class="space-y-1 text-xs">
          <div v-if="detail.type" class="flex justify-between">
            <span class="text-muted">Type</span><span>{{ detail.type }}</span>
          </div>
          <div v-if="detail.attribute" class="flex justify-between">
            <span class="text-muted">Attribute</span><span>{{ detail.attribute }}</span>
          </div>
          <div v-if="detail.race" class="flex justify-between">
            <span class="text-muted">Monster type</span><span>{{ detail.race }}</span>
          </div>
          <div v-if="detail.level != null" class="flex justify-between">
            <span class="text-muted">Level</span><span>{{ detail.level }}</span>
          </div>
          <div v-if="detail.rank != null" class="flex justify-between">
            <span class="text-muted">Rank</span><span>{{ detail.rank }}</span>
          </div>
          <div v-if="detail.linkValue != null" class="flex justify-between">
            <span class="text-muted">Link</span><span>{{ detail.linkValue }}</span>
          </div>
          <div v-if="detail.atk != null" class="flex justify-between">
            <span class="text-muted">ATK</span><span>{{ detail.atk }}</span>
          </div>
          <div v-if="detail.def != null" class="flex justify-between">
            <span class="text-muted">DEF</span><span>{{ detail.def }}</span>
          </div>
        </div>

        <div v-if="detail.banlistTcg" class="flex">
          <UBadge color="error" variant="soft" size="xs">{{ detail.banlistTcg }} (TCG)</UBadge>
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
import { getCardDetail, type YgoCardDetail } from '~/services/card/detail'

const props = defineProps<{
  cardId: string | null
  game: string
}>()

defineEmits<{ close: [] }>()

const detail = ref<YgoCardDetail | null>(null)
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
