<template>
  <AppPage sidebar-label="Filters" title="Search">
    <template #sidebar>
      <component :is="filterPanel" v-if="filterPanel" v-model="filters" />
    </template>
    <div class="flex flex-col h-full">
      <!-- barre de recherche : fixe -->
      <div class="flex gap-2 mb-4 shrink-0">
        <UInput
          id="search-card-input"
          v-model="query"
          placeholder="Card name…"
          icon="i-lucide-search"
          class="flex-1 min-w-0"
          :size="isMobile ? 'lg' : 'md'"
        />
        <USelect
          v-model="field"
          :items="fieldItems"
          :class="isMobile ? 'w-28 shrink-0' : 'w-32'"
          :size="isMobile ? 'lg' : 'md'"
        />
      </div>
      <!-- grille : prend l'espace restant et scrolle dedans -->
      <div id="search-results" class="flex-1 min-h-0 overflow-y-auto">
        <CardGrid :cards="results" :loading="loading" :owned-ids="ownedIds" @select="onSelect" />
      </div>
      <!-- pagination : fixe en bas -->
      <div
        v-if="total > 0"
        class="flex items-center gap-4 pt-4 shrink-0 border-t border-default"
        :class="isMobile ? 'justify-center pb-2' : 'justify-between'"
        data-search-pagination
      >
        <p v-if="!isMobile" class="text-sm text-muted">{{ total }} cards</p>
        <UPagination
          v-model:page="page"
          :total="total"
          :items-per-page="perPage"
          :sibling-count="isMobile ? 0 : 2"
          :show-edges="!isMobile"
        />
        <USelect v-if="!isMobile" v-model="perPage" :items="perPageItems" class="w-28" size="sm" />
      </div>
    </div>
    <CardDetail
      v-model:open="detailOpen"
      :game="GAME"
      :card-id="selectedId"
      @added="refreshOwned"
    />
  </AppPage>
</template>
<script setup lang="ts">
import { searchCards, countCards, type CardSearchResult } from '~/services/search'
import { searchFilterPanel } from '~/utils/gameUi'
import { ownedCardIds } from '~/services/collection'

// jeu affiché (la page est remontée quand il change, cf. app.vue)
const GAME = useCurrentGame().game.value

const { isMobile } = useResponsive()
const query = ref('')
const field = ref<'name' | 'effect'>('name')
// filtres propres au jeu (panneau fourni par utils/gameUi.ts, ou aucun)
const filterPanel = searchFilterPanel(GAME)
const filters = ref<Record<string, unknown>>({})
const fieldItems = [
  { label: 'Name', value: 'name' },
  { label: 'Effect', value: 'effect' },
]
const page = ref(1)
const perPage = ref(48)
const perPageItems = [24, 48, 96, 120]
const results = ref<CardSearchResult[]>([])
const total = ref(0)
const loading = ref(false)
const ownedIds = ref<Set<string>>(new Set())
const detailOpen = ref(false)
const selectedId = ref<string | null>(null)
onMounted(async () => {
  await refreshOwned()
})
async function refreshOwned() {
  ownedIds.value = await ownedCardIds(GAME)
}
async function load() {
  loading.value = true
  try {
    const params = {
      query: query.value,
      field: field.value,
      filters: filters.value,
      limit: perPage.value,
      offset: (page.value - 1) * perPage.value,
    }
    const [batch, count] = await Promise.all([searchCards(GAME, params), countCards(GAME, params)])
    results.value = batch
    total.value = count
  } finally {
    loading.value = false
  }
}
watchDebounced(
  [query, field, filters, perPage],
  () => {
    page.value = 1
    load()
  },
  { debounce: 300, deep: true, immediate: true }
)
watch(page, load)
function onSelect(card: CardSearchResult) {
  selectedId.value = card.id
  detailOpen.value = true
}
</script>
