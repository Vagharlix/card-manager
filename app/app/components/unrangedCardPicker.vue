<template>
  <UModal :open="open" title="Pick a card" @update:open="$emit('update:open', $event)">
    <template #body>
      <div class="space-y-3">
        <UInput
          id="unranged-picker-search"
          v-model="query"
          placeholder="Search by name…"
          icon="i-lucide-search"
          class="w-full"
          autofocus
        />
        <div v-if="loading" class="py-8 text-center text-muted text-sm">Loading…</div>
        <div v-else-if="!filtered.length" class="py-8 text-center text-dimmed text-sm">
          {{ query ? 'No matching cards' : 'No unsorted cards' }}
        </div>
        <!-- seules les lignes visibles sont dessinées (des milliers de cartes possibles) -->
        <VirtualGrid
          v-else
          :key="query"
          class="max-h-80"
          :items="filtered"
          :item-key="(c) => c.rootId"
          :columns="{ base: 4, sm: 5 }"
          :gap="8"
        >
          <template #default="{ item: c }">
            <button
              :data-picker-card-id="c.displayId"
              class="unranged-picker-card group relative text-left"
              @click="$emit('pick', c)"
            >
              <div
                class="aspect-[0.686] rounded-md overflow-hidden border-2 border-transparent group-hover:border-primary transition-colors"
              >
                <ArtThumb :passcode="c.displayId" :game="c.game" class="w-full h-full object-cover" />
              </div>
              <div
                class="absolute bottom-1 right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-inverted text-[10px] font-medium flex items-center justify-center shadow"
              >
                {{ c.totalQty }}
              </div>
            </button>
          </template>
        </VirtualGrid>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { listUnrangedCards, type ContainerCard } from '~/services/containers'

const props = defineProps<{
  open: boolean
  game?: string
}>()

defineEmits<{ 'update:open': [value: boolean]; pick: [card: ContainerCard] }>()

const query = ref('')
const loading = ref(false)
const items = shallowRef<ContainerCard[]>([])

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter((c) => c.name.toLowerCase().includes(q))
})

async function load() {
  loading.value = true
  try {
    items.value = await listUnrangedCards(props.game ?? useCurrentGame().game.value)
  } finally {
    loading.value = false
  }
}

// recharge à chaque ouverture (les non rangées ont pu changer)
watch(
  () => props.open,
  (o) => {
    if (o) {
      query.value = ''
      load()
    }
  }
)
</script>
