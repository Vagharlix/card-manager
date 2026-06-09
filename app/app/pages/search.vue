<template>
  <AppPage sidebar-label="Filtres">
    <template #sidebar>
      <p class="text-muted text-sm">filtres à venir</p>
    </template>

    <div>
      <UInput
        v-model="query"
        placeholder="Nom de carte..."
        icon="i-lucide-search"
        class="mb-4 w-full"
      />

      <CardGrid :cards="results" :loading="loading && !results.length" @select="onSelect" />

      <!-- sentinelle de scroll + indicateur de chargement du lot suivant -->
      <div ref="scrollAnchor" class="h-10" />
      <div v-if="loadingMore" class="flex justify-center py-4">
        <UIcon name="i-lucide-loader-circle" class="animate-spin text-muted text-xl" />
      </div>
    </div>

    <CardDetail v-model:open="detailOpen" game="ygo" :card-id="selectedId" />
  </AppPage>
</template>

<script setup lang="ts">
import { searchCards, type CardSearchResult } from '~/services/search'

const PAGE_SIZE = 48

const query = ref('')
const results = ref<CardSearchResult[]>([])
const loading = ref(false) // chargement initial (nouvelle recherche)
const loadingMore = ref(false) // chargement d'un lot suivant
const reachedEnd = ref(false) // plus de résultats à charger

const detailOpen = ref(false)
const selectedId = ref<string | null>(null)

const scrollAnchor = ref<HTMLElement | null>(null)

// une recherche fraîche : on remet tout à zéro
async function runSearch() {
  loading.value = true
  reachedEnd.value = false
  try {
    const batch = await searchCards('ygo', {
      query: query.value,
      field: 'name',
      limit: PAGE_SIZE,
      offset: 0,
    })
    results.value = batch
    reachedEnd.value = batch.length < PAGE_SIZE
  } finally {
    loading.value = false
  }
}

// charge le lot suivant et l'ajoute aux résultats existants
async function loadMore() {
  if (loadingMore.value || reachedEnd.value || loading.value) return
  loadingMore.value = true
  try {
    const batch = await searchCards('ygo', {
      query: query.value,
      field: 'name',
      limit: PAGE_SIZE,
      offset: results.value.length,
    })
    results.value.push(...batch)
    if (batch.length < PAGE_SIZE) reachedEnd.value = true
  } finally {
    loadingMore.value = false
  }
}

// relance une recherche fraîche quand la query change
watchDebounced(query, runSearch, { debounce: 300, immediate: true })

// observe la sentinelle : quand elle entre dans le viewport, charge plus
useIntersectionObserver(scrollAnchor, ([entry]) => {
  if (entry?.isIntersecting) loadMore()
})

function onSelect(card: CardSearchResult) {
  selectedId.value = card.id
  detailOpen.value = true
}
</script>
