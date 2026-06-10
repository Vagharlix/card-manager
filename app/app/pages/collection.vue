<template>
  <AppPage sidebar-label="Filtres">
    <template #sidebar>
      <p class="text-muted text-sm">filtres collection à venir</p>
    </template>

    <div class="flex flex-col h-full">
      <!-- barre d'outils -->
      <div class="flex items-center justify-between mb-4 shrink-0">
        <p class="text-sm text-muted">
          {{ cards.length }} cartes différentes · {{ totalQty }} au total
        </p>
        <UButtonGroup>
          <UButton
            :variant="view === 'grid' ? 'solid' : 'soft'"
            color="neutral"
            icon="i-lucide-layout-grid"
            @click="view = 'grid'"
          />
          <UButton
            :variant="view === 'list' ? 'solid' : 'soft'"
            color="neutral"
            icon="i-lucide-list"
            @click="view = 'list'"
          />
        </UButtonGroup>
      </div>

      <!-- contenu scrollable -->
      <div class="flex-1 min-h-0 overflow-y-auto">
        <!-- vide -->
        <div
          v-if="!loading && !cards.length"
          class="flex flex-col items-center justify-center text-center py-20 text-muted"
        >
          <UIcon name="i-lucide-layers" class="text-4xl mb-3" />
          <p>Ta collection est vide</p>
          <UButton
            to="/search"
            label="Parcourir les cartes"
            icon="i-lucide-search"
            variant="soft"
            class="mt-3"
          />
        </div>

        <!-- grille -->
        <div
          v-else-if="view === 'grid'"
          class="grid gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
        >
          <CardThumb
            v-for="c in cards"
            :key="c.rootId"
            :card="{ game: c.game, id: c.displayId, name: c.name, imageUrl: '' }"
            :quantity="c.totalQty"
            @select="openCard(c)"
          />
        </div>

        <!-- liste -->
        <div v-else class="space-y-1">
          <button
            v-for="c in cards"
            :key="c.rootId"
            class="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-elevated text-left"
            @click="openCard(c)"
          >
            <div class="w-10 shrink-0 rounded overflow-hidden">
              <ArtThumb :passcode="c.displayId" />
            </div>
            <span class="flex-1 truncate">{{ c.name }}</span>
            <UBadge color="neutral" variant="soft">×{{ c.totalQty }}</UBadge>
          </button>
        </div>
      </div>
    </div>

    <CardDetail v-model:open="detailOpen" game="ygo" :card-id="selectedId" @added="load" />
  </AppPage>
</template>

<script setup lang="ts">
import { listCollectionGrouped, type CollectionCard } from '~/services/collection'

const view = ref<'grid' | 'list'>('grid')
const cards = ref<CollectionCard[]>([])
const loading = ref(false)

const detailOpen = ref(false)
const selectedId = ref<string | null>(null)

const totalQty = computed(() => cards.value.reduce((s, c) => s + c.totalQty, 0))

async function load() {
  loading.value = true
  try {
    cards.value = await listCollectionGrouped('ygo')
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openCard(c: CollectionCard) {
  selectedId.value = c.displayId
  detailOpen.value = true
}
</script>
