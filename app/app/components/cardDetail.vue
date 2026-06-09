<template>
  <USlideover
    :open="open"
    :side="isMobile ? 'bottom' : 'right'"
    :title="detail?.name ?? 'Carte'"
    @update:open="$emit('update:open', $event)"
  >
    <template #body>
      <div v-if="loading" class="space-y-4">
        <USkeleton class="w-full aspect-[0.686] rounded-lg" />
        <USkeleton class="h-4 w-3/4" />
        <USkeleton class="h-4 w-1/2" />
      </div>

      <div v-else-if="detail" class="space-y-5">
        <div class="rounded-lg overflow-hidden ring-1 ring-default max-w-xs mx-auto">
          <img
            v-if="bigImage.src.value"
            :src="bigImage.src.value"
            :alt="detail.name"
            class="w-full"
          />
          <USkeleton v-else class="w-full aspect-[0.686]" />
        </div>

        <div v-if="detail.artworks.length > 1" class="flex gap-2 flex-wrap justify-center">
          <button
            v-for="art in detail.artworks"
            :key="art.id"
            class="size-12 rounded overflow-hidden ring-2 transition"
            :class="
              art.id === activeArtId
                ? 'ring-primary'
                : 'ring-transparent opacity-60 hover:opacity-100'
            "
            @click="activeArtId = art.id"
          >
            <ArtThumb :passcode="art.id" />
          </button>
        </div>

        <div class="flex items-center gap-2 text-sm">
          <UIcon name="i-lucide-layers" class="text-muted" />
          <span class="text-muted">0 dans ta collection</span>
        </div>

        <div class="space-y-1 text-sm">
          <div v-if="detail.type" class="flex justify-between">
            <span class="text-muted">Type</span><span>{{ detail.type }}</span>
          </div>
          <div v-if="detail.attribute" class="flex justify-between">
            <span class="text-muted">Attribut</span><span>{{ detail.attribute }}</span>
          </div>
          <div v-if="detail.race" class="flex justify-between">
            <span class="text-muted">Race</span><span>{{ detail.race }}</span>
          </div>
          <div v-if="detail.level != null" class="flex justify-between">
            <span class="text-muted">Niveau</span><span>{{ detail.level }}</span>
          </div>
          <div v-if="detail.rank != null" class="flex justify-between">
            <span class="text-muted">Rang</span><span>{{ detail.rank }}</span>
          </div>
          <div v-if="detail.linkValue != null" class="flex justify-between">
            <span class="text-muted">Link</span><span>{{ detail.linkValue }}</span>
          </div>
          <div v-if="detail.scale != null" class="flex justify-between">
            <span class="text-muted">Échelle Pendule</span><span>{{ detail.scale }}</span>
          </div>
          <div v-if="detail.atk != null" class="flex justify-between">
            <span class="text-muted">ATK</span><span>{{ detail.atk }}</span>
          </div>
          <div v-if="detail.def != null" class="flex justify-between">
            <span class="text-muted">DEF</span><span>{{ detail.def }}</span>
          </div>
          <div v-if="detail.archetype" class="flex justify-between">
            <span class="text-muted">Archétype</span><span>{{ detail.archetype }}</span>
          </div>
        </div>

        <div
          v-if="detail.legalText"
          class="text-sm border-t border-default pt-4 whitespace-pre-line"
        >
          {{ detail.legalText }}
        </div>

        <div v-if="detail.banlistTcg" class="flex items-center gap-2 text-sm">
          <UBadge color="error" variant="soft">{{ detail.banlistTcg }} (TCG)</UBadge>
        </div>

        <div v-if="detail.printings.length" class="border-t border-default pt-4">
          <p class="text-muted text-xs mb-2">PRINTINGS ({{ detail.printings.length }})</p>
          <div class="space-y-1 text-sm max-h-48 overflow-y-auto">
            <div v-for="p in detail.printings" :key="p.id" class="flex justify-between gap-2">
              <span class="truncate">{{ p.setName }}</span>
              <span class="text-muted shrink-0">{{ p.setCode }} · {{ p.rarity }}</span>
            </div>
          </div>
        </div>

        <UButton block icon="i-lucide-plus" label="Ajouter à ma collection" disabled />
      </div>
    </template>
  </USlideover>
</template>

<script setup lang="ts">
import { getCardDetail, type YgoCardDetail } from '~/services/card/detail'

const props = defineProps<{
  open: boolean
  game: string
  cardId: string | null
}>()

defineEmits<{ 'update:open': [value: boolean] }>()

const { isMobile } = useResponsive()

const detail = ref<YgoCardDetail | null>(null)
const loading = ref(false)
const activeArtId = ref<string>('')

watch(
  () => props.cardId,
  async (id) => {
    if (!id) return
    loading.value = true
    detail.value = null
    try {
      detail.value = await getCardDetail(props.game, id)
      activeArtId.value = id
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)

const bigImage = useCardImage(() => activeArtId.value, 'full')
</script>
