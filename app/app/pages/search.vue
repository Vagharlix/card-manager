<template>
  <AppPage sidebar-label="Filtres">
    <template #sidebar>
      <SearchFilters v-model="filters" :options="filterOptions" />
    </template>
    <div class="flex flex-col h-full">
      <!-- barre de recherche : fixe -->
      <div class="flex gap-2 mb-4 shrink-0">
        <UInput
          id="search-card-input"
          v-model="query"
          placeholder="Nom de carte..."
          icon="i-lucide-search"
          class="flex-1"
        />
        <USelect v-model="field" :items="fieldItems" class="w-32" />
      </div>
      <!-- grille : prend l'espace restant et scrolle dedans -->
      <div id="search-results" class="flex-1 min-h-0 overflow-y-auto">
        <CardGrid :cards="results" :loading="loading" :owned-ids="ownedIds" @select="onSelect" />
      </div>
      <!-- pagination : fixe en bas -->
      <div
        v-if="total > 0"
        class="flex items-center justify-between gap-4 pt-4 shrink-0 border-t border-default"
      >
        <p class="text-sm text-muted">{{ total }} cartes</p>
        <UPagination v-model:page="page" :total="total" :items-per-page="perPage" />
        <USelect v-model="perPage" :items="perPageItems" class="w-28" size="sm" />
      </div>
    </div>
    <CardDetail v-model:open="detailOpen" game="ygo" :card-id="selectedId" @added="refreshOwned" />
  </AppPage>
</template>
<script setup lang="ts">
import {
  searchCards,
  countCards,
  getYgoFilterOptions,
  type CardSearchResult,
  type YgoFilters,
  type YgoFilterOptions,
} from '~/services/search'
import { ownedCardIds } from '~/services/collection'
const query = ref('')
const field = ref<'name' | 'effect'>('name')
const filters = ref<YgoFilters>({})
const fieldItems = [
  { label: 'Nom', value: 'name' },
  { label: 'Effet', value: 'effect' },
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
const filterOptions = ref<YgoFilterOptions>({
  attributes: [],
  races: [],
  archetypes: [],
  monsterTypes: [],
  spellTrapTypes: [],
})
onMounted(async () => {
  filterOptions.value = await getYgoFilterOptions()
  await refreshOwned()
})
async function refreshOwned() {
  ownedIds.value = await ownedCardIds('ygo')
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
    const [batch, count] = await Promise.all([
      searchCards('ygo', params),
      countCards('ygo', params),
    ])
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
