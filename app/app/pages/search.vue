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
        <!-- sélection multiple : cocher des cartes (sur plusieurs pages,
             plusieurs recherches) puis les ajouter d'un coup -->
        <UButton
          id="search-select-btn"
          :data-active="selectMode || undefined"
          :icon="selectMode ? 'i-lucide-x' : 'i-lucide-check-square'"
          :label="isMobile ? undefined : selectMode ? 'Done' : 'Select'"
          :aria-label="selectMode ? 'Stop selecting' : 'Select cards'"
          :variant="selectMode ? 'solid' : 'soft'"
          color="neutral"
          class="shrink-0"
          :size="isMobile ? 'lg' : 'md'"
          @click="toggleSelectMode"
        />
      </div>
      <!-- grille : prend l'espace restant et scrolle dedans -->
      <div id="search-results" class="flex-1 min-h-0 overflow-y-auto">
        <CardDataPending v-if="!results.length" :game="GAME" />
        <CardGrid
          v-if="results.length || !installing"
          :cards="results"
          :loading="loading"
          :owned-ids="ownedIds"
          :selectable="selectMode"
          :selected-ids="selectedIds"
          @select="onSelect"
          @toggle="toggleCard"
        />
      </div>
      <!-- barre de la sélection -->
      <div
        v-if="selectMode"
        id="search-selection-bar"
        :data-selected-count="selection.size"
        class="flex items-center gap-2 pt-3 shrink-0"
      >
        <p class="text-sm text-muted flex-1 min-w-0 truncate">
          {{ selection.size }} selected
        </p>
        <UButton
          v-if="selection.size"
          id="search-clear-selection"
          label="Clear"
          color="neutral"
          variant="ghost"
          @click="clearSelection"
        />
        <UButton
          id="search-add-selected"
          icon="i-lucide-plus"
          :label="`Add (${selection.size})`"
          :disabled="!selection.size"
          @click="openBatch"
        />
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

    <!-- ajout de la sélection : quantité par carte, rangement facultatif -->
    <UModal v-model:open="batchOpen" :title="`Add ${selection.size} card(s) to your collection`">
      <template #body>
        <div class="space-y-4">
          <div>
            <p class="text-sm text-muted mb-1.5">Copies of each card</p>
            <UInput
              id="search-batch-qty"
              v-model.number="batchQty"
              type="number"
              min="1"
              size="sm"
              class="w-32"
            />
          </div>
          <div>
            <p class="text-sm text-muted mb-1.5">Store them in (optional)</p>
            <USelect
              id="search-batch-storage"
              v-model="batchStorage"
              :items="storageItems"
              class="w-full"
            >
              <template #item="{ item }">
                <span :data-select-value="item.value">{{ item.label }}</span>
              </template>
            </USelect>
          </div>
          <p class="text-xs text-dimmed">Condition and language: your defaults for this game.</p>
        </div>
      </template>
      <template #footer="{ close }">
        <div class="flex gap-2 justify-end w-full">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="close" />
          <UButton
            id="search-batch-confirm"
            label="Add"
            icon="i-lucide-check"
            :loading="batchBusy"
            :disabled="!(batchQty >= 1)"
            @click="confirmBatch"
          />
        </div>
      </template>
    </UModal>
  </AppPage>
</template>
<script setup lang="ts">
import { searchCards, countCards, type CardSearchResult } from '~/services/search'
import { searchFilterPanel } from '~/utils/gameUi'
import { syncFirstInstall, syncingGame } from '~/services/cardData'
import { ownedCardIds, addCard } from '~/services/collection'
import {
  listContainersWithCapacity,
  assignCardToContainer,
  type ContainerWithCapacity,
} from '~/services/containers'

// jeu affiché (la page est remontée quand il change, cf. app.vue)
const GAME = useCurrentGame().game.value
// base du jeu en cours de 1re installation (message à la place de « rien trouvé »)
const installing = computed(() => syncFirstInstall.value && syncingGame.value === GAME)

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

// ── sélection multiple ──
// gardée en changeant de page ou de recherche (on peut composer une liste)
const toast = useToast()
const selectMode = ref(false)
const selection = shallowRef(new Map<string, CardSearchResult>())
const selectedIds = computed(() => new Set(selection.value.keys()))

function toggleSelectMode() {
  selectMode.value = !selectMode.value
  if (!selectMode.value) clearSelection()
}
function clearSelection() {
  selection.value = new Map()
}
function toggleCard(card: CardSearchResult) {
  const next = new Map(selection.value)
  if (next.has(card.id)) next.delete(card.id)
  else next.set(card.id, card)
  selection.value = next
}

const NO_STORAGE = '__none__'
const batchOpen = ref(false)
const batchQty = ref(1)
const batchStorage = ref(NO_STORAGE)
const batchBusy = ref(false)
const storages = ref<ContainerWithCapacity[]>([])
const storageItems = computed(() => [
  { label: 'None (unsorted)', value: NO_STORAGE },
  ...storages.value.map((c) => ({
    label: c.isFull ? `${c.name} (full)` : c.name,
    value: c.id,
    disabled: c.isFull,
  })),
])

async function openBatch() {
  if (!selection.value.size) return
  batchQty.value = 1
  batchStorage.value = NO_STORAGE
  storages.value = await listContainersWithCapacity(GAME) // rangements de ce jeu
  batchOpen.value = true
}

async function confirmBatch() {
  const qty = Math.max(1, Math.floor(batchQty.value || 1))
  const target = storages.value.find((c) => c.id === batchStorage.value) ?? null
  batchBusy.value = true
  let added = 0
  let stored = 0
  try {
    for (const card of selection.value.values()) {
      await addCard({ game: GAME, cardId: card.id, quantity: qty })
      added++
      if (target) {
        try {
          stored += await assignCardToContainer(GAME, card.id, target.id, target.type, qty)
        } catch {
          // rangement plein : les cartes restent non rangées
        }
      }
    }
    toast.add({
      title: target
        ? `${added} card(s) added · ${stored} cop${stored > 1 ? 'ies' : 'y'} stored in ${target.name}`
        : `${added} card(s) added`,
      icon: 'i-lucide-check',
      color: 'success',
    })
    batchOpen.value = false
    selectMode.value = false
    clearSelection()
  } catch {
    toast.add({
      title: added ? `Only ${added} card(s) added` : 'Could not add the cards',
      color: 'error',
    })
  } finally {
    batchBusy.value = false
    await refreshOwned()
  }
}
</script>
