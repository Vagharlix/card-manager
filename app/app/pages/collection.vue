<template>
  <AppPage sidebar-label="Storage" title="Collection" :subtitle="subtitle" :mobile-sidebar="false">
    <template #actions>
      <GamePicker size="lg" compact />
      <UButton
        id="mobile-settings-btn"
        to="/settings"
        icon="i-lucide-settings"
        color="neutral"
        variant="soft"
        size="lg"
        aria-label="Settings"
      />
    </template>
    <template #sidebar>
      <ContainerTree
        :containers="containers"
        :unranged-count="unrangedCount"
        :total-count="collectionCount"
        :selected-id="selectedId"
        @select="selectContainer"
        @create="openCreate"
        @changed="onContainerChanged"
      />
    </template>

    <div class="flex flex-col h-full">
      <!-- MOBILE : bascule cartes / rangements (remplace la sidebar) -->
      <div
        v-if="isMobile"
        class="grid grid-cols-2 p-1 mb-3 rounded-xl bg-elevated border border-default shrink-0"
      >
        <button
          v-for="t in mobileTabs"
          :key="t.id"
          :data-mobile-segment="t.id"
          class="h-9 rounded-lg text-sm font-semibold transition"
          :class="mobileTab === t.id ? 'bg-primary text-inverted' : 'text-muted'"
          @click="mobileTab = t.id"
        >
          {{ t.label }}
        </button>
      </div>

      <div v-if="isMobile && mobileTab === 'containers'" class="flex-1 min-h-0 overflow-y-auto">
        <ContainerTree
          :containers="containers"
          :unranged-count="unrangedCount"
          :total-count="collectionCount"
          :selected-id="selectedId"
          @select="selectFromMobileList"
          @create="openCreate"
          @changed="onContainerChanged"
        />
      </div>

      <template v-else>
        <!-- MOBILE : rangement ouvert → retour à toute la collection -->
        <div v-if="isMobile && !isAll" class="flex items-center gap-2 mb-3 shrink-0">
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="soft"
            :aria-label="'My whole collection'"
            data-mobile-back-all
            @click="selectContainer(ALL_ID)"
          />
          <div class="min-w-0">
            <p class="font-semibold truncate">{{ currentTitle }}</p>
            <p class="text-xs text-muted">{{ countLabel }}</p>
          </div>
        </div>

        <!-- barre d'outils -->
        <div
          v-if="!isMobile || (isUnranged && cards.length)"
          class="flex items-center gap-2 mb-4 shrink-0"
        >
          <div v-if="!isMobile">
            <h2 class="font-medium">{{ currentTitle }}</h2>
            <p class="text-xs text-muted">{{ countLabel }}</p>
          </div>
          <div class="flex-1" />

          <template v-if="isUnranged && cards.length">
            <UButton
              v-if="!selectMode"
              icon="i-lucide-check-square"
              color="neutral"
              variant="soft"
              label="Select"
              @click="enterSelectMode"
            />
            <template v-else>
              <UButton color="neutral" variant="ghost" label="Cancel" @click="exitSelectMode" />
              <UButton
                icon="i-lucide-folder-input"
                :label="`Store (${selectedCards.size})`"
                :disabled="selectedCards.size === 0"
                @click="openBatchPicker"
              />
            </template>
          </template>

          <UButton
            v-if="android && !selectMode && !isMobile"
            id="scan-open-btn"
            icon="i-lucide-scan-line"
            label="Scan"
            to="/scan"
            variant="soft"
          />

          <UButtonGroup v-if="!selectMode && !isBinder && !isMobile">
            <UButton
              :variant="view === 'grid' ? 'solid' : 'soft'"
              color="neutral"
              icon="i-lucide-layout-grid"
              @click="setView('grid')"
            />
            <UButton
              :variant="view === 'list' ? 'solid' : 'soft'"
              color="neutral"
              icon="i-lucide-list"
              @click="setView('list')"
            />
          </UButtonGroup>
        </div>

        <!-- MOBILE : recherche + filtres en puces -->
        <div v-if="isAll && isMobile" class="space-y-2 mb-3 shrink-0">
          <UInput
            v-model="filters.search"
            icon="i-lucide-search"
            placeholder="Search my collection"
            size="lg"
            class="w-full"
            data-mobile-collection-search
          />
          <div class="flex gap-2 overflow-x-auto no-scrollbar">
            <UButton
              :variant="filters.onlyTrade ? 'solid' : 'outline'"
              color="neutral"
              icon="i-lucide-repeat"
              label="For trade"
              class="rounded-full shrink-0"
              data-mobile-only-trade
              @click="toggleOnlyTrade"
            />
            <UButton
              variant="outline"
              color="neutral"
              icon="i-lucide-inbox"
              :label="`Unsorted · ${unrangedCount}`"
              class="rounded-full shrink-0"
              @click="selectContainer(UNRANGED_ID)"
            />
            <USelect
              v-model="filters.sort"
              :items="sortItems"
              icon="i-lucide-arrow-up-down"
              variant="outline"
              class="rounded-full shrink-0 w-40"
            />
          </div>
        </div>

        <!-- filtres de « toute ma collection » -->
        <div v-if="isAll && !isMobile" class="flex flex-wrap items-center gap-2 mb-4 shrink-0">
          <UInput
            id="collection-search"
            v-model="filters.search"
            icon="i-lucide-search"
            placeholder="Search by name"
            size="sm"
            class="w-56"
          />
          <USelect
            id="collection-sort"
            v-model="filters.sort"
            :items="sortItems"
            size="sm"
            class="w-44"
          >
            <template #item="{ item }">
              <span :data-select-value="item.value">{{ item.label }}</span>
            </template>
          </USelect>
          <label class="flex items-center gap-2 text-sm">
            <USwitch id="collection-only-trade" v-model="filters.onlyTrade" size="sm" />
            For trade only
          </label>
        </div>

        <!-- contenu -->
        <div id="container-content" class="flex-1 min-h-0 overflow-hidden">
          <!-- vue binder positionnelle -->
          <BinderView
            v-if="isBinder"
            :slots="binderSlots"
            :page-count="binderLayout.pageCount"
            :rows-per-page="binderLayout.rowsPerPage"
            :cols-per-page="binderLayout.colsPerPage"
            @open="openBinderCard"
            @clear="clearBinderCard"
            @add="onBinderSlotClick"
          />

          <!-- vue grille / liste (non rangées + deckbox + bulk box) -->
          <div v-else class="h-full overflow-y-auto">
            <div
              v-if="!loading && !cards.length"
              class="flex flex-col items-center justify-center text-center py-20 text-muted"
            >
              <UIcon name="i-lucide-inbox" class="text-4xl mb-3" />
              <p>{{ emptyMessage }}</p>
            </div>

            <div
              v-else-if="view === 'grid'"
              class="grid gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
            >
              <CollectionCard
                v-for="c in cards"
                :key="c.rootId"
                view="grid"
                :game="c.game"
                :display-id="c.displayId"
                :name="c.name"
                :total-qty="c.totalQty"
                :trade-qty="c.tradeQty"
                :select-mode="selectMode"
                :selected="selectedCards.has(c.displayId)"
                :removable="!isVirtual"
                :always-show-actions="isMobile"
                @open="openCard(c)"
                @toggle="toggleCard(c)"
                @unassign="askUnassign(c)"
              />
            </div>

            <div v-else class="space-y-1">
              <CollectionCard
                v-for="c in cards"
                :key="c.rootId"
                view="list"
                :game="c.game"
                :display-id="c.displayId"
                :name="c.name"
                :total-qty="c.totalQty"
                :trade-qty="c.tradeQty"
                :select-mode="false"
                :selected="false"
                :removable="!isVirtual"
                :always-show-actions="isMobile"
                @open="openCard(c)"
                @unassign="askUnassign(c)"
              />
            </div>
          </div>
        </div>
      </template>
    </div>

    <CardDetail v-model:open="detailOpen" :game="GAME" :card-id="selectedCardId" @added="reload" />
    <ContainerCreateModal v-model:open="createOpen" @created="onContainerCreated" />

    <ContainerPicker
      v-model:open="batchPickerOpen"
      :containers="containersWithCap"
      :max-quantity="null"
      :busy="batchBusy"
      title="Store the selection in…"
      @confirm="onBatchRange"
    />

    <!-- sélecteur de carte non rangée pour un slot de binder -->
    <unrangedCardPicker v-model:open="binderPickerOpen" :game="GAME" @pick="onBinderCardPick" />

    <UModal v-model:open="unassignOpen" title="Remove from this storage?">
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-muted">
            Remove “{{ pendingUnassign?.name }}” from this storage. The card(s) will become unsorted
            again.
          </p>
          <div v-if="(pendingUnassign?.totalQty ?? 0) > 1">
            <p class="text-sm text-muted mb-1">Quantity to remove</p>
            <UInput
              v-model.number="unassignQty"
              type="number"
              min="1"
              :max="pendingUnassign?.totalQty"
              size="sm"
              class="w-32"
            />
          </div>
        </div>
      </template>
      <template #footer="{ close }">
        <div class="flex gap-2 justify-end w-full">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="close" />
          <UButton
            id="unassign-confirm"
            label="Remove"
            color="error"
            icon="i-lucide-folder-minus"
            :loading="unassignBusy"
            @click="confirmUnassign"
          />
        </div>
      </template>
    </UModal>
  </AppPage>
</template>

<script setup lang="ts">
import {
  listContainers,
  listContainersWithCapacity,
  unrangedCount as fetchUnranged,
  listUnrangedCards,
  listContainerCards,
  listBinderSlots,
  clearBinderSlotById,
  assignCardToBinderSlot,
  assignCardToContainer,
  unassignCardFromContainer,
  type ContainerListItem,
  type ContainerWithCapacity,
  type ContainerCard,
  type ContainerType,
  type BinderSlotCard,
} from '~/services/containers'
import { listCollectionCards, collectionTotal, type CollectionSort } from '~/services/collection'
import { canScan } from '~/services/scan'

// jeu affiché (la page est remontée quand il change, cf. app.vue)
const GAME = useCurrentGame().game.value

const toast = useToast()
const android = isAndroid() && canScan(GAME) // scan de cartes : app mobile, jeu qui sait scanner
const { isMobile } = useResponsive()

// mobile : la sidebar des conteneurs devient un onglet « Rangements »
type MobileTab = 'cards' | 'containers'
const mobileTabs: { id: MobileTab; label: string }[] = [
  { id: 'cards', label: 'Cards' },
  { id: 'containers', label: 'Storage' },
]
const mobileTab = ref<MobileTab>('cards')
function selectFromMobileList(id: string) {
  mobileTab.value = 'cards'
  selectContainer(id)
}
function toggleOnlyTrade() {
  filters.onlyTrade = !filters.onlyTrade
}

const view = ref<'grid' | 'list'>('grid')
function setView(v: 'grid' | 'list') {
  view.value = v
}
const loading = ref(false)

const containers = ref<ContainerListItem[]>([])
const unrangedCount = ref(0)
const collectionCount = ref(0)
const selectedId = ref<string>(ALL_ID)

// tradeQty n'est renseigné que dans la vue « toute ma collection »
// shallowRef : la liste est remplacée d'un bloc, jamais modifiée sur place
// (pas de proxys réactifs sur des milliers d'objets)
const cards = shallowRef<(ContainerCard & { tradeQty?: number })[]>([])

// filtres de la vue « toute ma collection »
const filters = reactive({ search: '', sort: 'name' as CollectionSort, onlyTrade: false })
const sortItems = [
  { label: 'Name', value: 'name' },
  { label: 'Quantity', value: 'quantity' },
  { label: 'Recently added', value: 'recent' },
]
const binderSlots = shallowRef<BinderSlotCard[]>([])

const detailOpen = ref(false)
const selectedCardId = ref<string | null>(null)
const createOpen = ref(false)

// flux C
const selectMode = ref(false)
const selectedCards = ref<Set<string>>(new Set())
const batchPickerOpen = ref(false)
const batchBusy = ref(false)
const containersWithCap = ref<ContainerWithCapacity[]>([])

// retrait
const unassignOpen = ref(false)
const pendingUnassign = ref<ContainerCard | null>(null)
const unassignQty = ref(1)
const unassignBusy = ref(false)

// placement dans un slot de binder
const binderPickerOpen = ref(false)
const pendingSlot = ref<{ page: number; row: number; col: number } | null>(null)

const isUnranged = computed(() => selectedId.value === UNRANGED_ID)
const isAll = computed(() => selectedId.value === ALL_ID)
const isVirtual = computed(() => isUnranged.value || isAll.value) // pas un vrai conteneur
const currentContainer = computed(
  () => containers.value.find((c) => c.id === selectedId.value) ?? null
)
const currentType = computed<ContainerType | null>(() => currentContainer.value?.type ?? null)
const isBinder = computed(() => currentType.value === 'binder')

const binderLayout = computed(() => ({
  pageCount: currentContainer.value?.pageCount ?? 0,
  rowsPerPage: currentContainer.value?.rowsPerPage ?? 3,
  colsPerPage: currentContainer.value?.colsPerPage ?? 3,
}))

const totalQty = computed(() => cards.value.reduce((s, c) => s + c.totalQty, 0))

const countLabel = computed(() =>
  isBinder.value
    ? `${binderSlots.value.length} cards placed`
    : `${cards.value.length} distinct cards · ${totalQty.value} in total`
)
const subtitle = computed(() => `${collectionCount.value} cards in total`)

const currentTitle = computed(() => {
  if (isAll.value) return 'My whole collection'
  if (isUnranged.value) return 'Unsorted'
  return currentContainer.value?.name ?? 'Storage'
})

const emptyMessage = computed(() => {
  if (isAll.value) {
    return filters.search || filters.onlyTrade
      ? 'No matching cards'
      : 'Your collection is empty: add cards from Search'
  }
  return isUnranged.value ? 'All your cards are stored' : 'This storage is empty'
})

async function loadSidebar() {
  const [list, unranged, total] = await Promise.all([
    listContainers(),
    fetchUnranged(GAME),
    collectionTotal(GAME),
  ])
  containers.value = list
  unrangedCount.value = unranged
  collectionCount.value = total
}

async function loadContent() {
  loading.value = true
  try {
    if (isAll.value) {
      cards.value = await listCollectionCards(GAME, { ...filters })
      binderSlots.value = []
    } else if (isUnranged.value) {
      cards.value = await listUnrangedCards(GAME)
      binderSlots.value = []
    } else if (isBinder.value) {
      binderSlots.value = await listBinderSlots(selectedId.value, GAME)
      cards.value = []
    } else if (currentContainer.value) {
      cards.value = await listContainerCards(
        currentContainer.value.id,
        currentContainer.value.type,
        GAME
      )
      binderSlots.value = []
    } else {
      cards.value = []
      binderSlots.value = []
    }
  } finally {
    loading.value = false
  }
}

async function reload() {
  await Promise.all([loadSidebar(), loadContent()])
}

function selectContainer(id: string) {
  selectedId.value = id
  exitSelectMode()
  loadContent()
}

function openCard(c: ContainerCard) {
  selectedCardId.value = c.displayId
  detailOpen.value = true
}

function openCreate() {
  createOpen.value = true
}

async function onContainerCreated(id: string) {
  await loadSidebar()
  selectContainer(id)
}

async function onContainerChanged() {
  await loadSidebar()
  if (!isVirtual.value && !containers.value.find((c) => c.id === selectedId.value)) {
    selectedId.value = ALL_ID
  }
  await loadContent()
}

// ── flux C ──
function enterSelectMode() {
  selectMode.value = true
  selectedCards.value = new Set()
}

function exitSelectMode() {
  selectMode.value = false
  selectedCards.value = new Set()
}

function toggleCard(c: ContainerCard) {
  const next = new Set(selectedCards.value)
  if (next.has(c.displayId)) next.delete(c.displayId)
  else next.add(c.displayId)
  selectedCards.value = next
}

async function openBatchPicker() {
  if (selectedCards.value.size === 0) return
  containersWithCap.value = await listContainersWithCapacity()
  batchPickerOpen.value = true
}

async function onBatchRange(payload: {
  containerId: string
  type: ContainerType
  quantity: number
}) {
  batchBusy.value = true
  try {
    const selected = cards.value.filter((c) => selectedCards.value.has(c.displayId))
    let totalPlaced = 0
    for (const c of selected) {
      totalPlaced += await assignCardToContainer(
        GAME,
        c.displayId,
        payload.containerId,
        payload.type,
        c.totalQty
      )
    }
    batchPickerOpen.value = false
    exitSelectMode()
    toast.add({
      title: totalPlaced > 0 ? `${totalPlaced} card(s) stored` : 'Nothing to store',
      icon: 'i-lucide-check',
      color: totalPlaced > 0 ? 'success' : 'warning',
    })
    await reload()
  } catch (e: any) {
    toast.add({
      title: e?.message === 'BINDER_FULL' ? 'The binder is full' : 'Could not store the cards',
      color: 'error',
    })
  } finally {
    batchBusy.value = false
  }
}

// ── retrait (deckbox / bulk box) ──
function askUnassign(c: ContainerCard) {
  pendingUnassign.value = c
  unassignQty.value = c.totalQty
  unassignOpen.value = true
}

async function confirmUnassign() {
  const c = pendingUnassign.value
  if (!c || !currentType.value) return
  unassignBusy.value = true
  try {
    const removed = await unassignCardFromContainer(
      GAME,
      c.displayId,
      selectedId.value,
      currentType.value,
      unassignQty.value
    )
    unassignOpen.value = false
    toast.add({
      title: removed > 0 ? `${removed} card(s) removed` : 'Nothing to remove',
      icon: 'i-lucide-check',
      color: removed > 0 ? 'success' : 'warning',
    })
    await reload()
  } catch {
    toast.add({ title: 'Could not remove the card', color: 'error' })
  } finally {
    unassignBusy.value = false
    pendingUnassign.value = null
  }
}

// ── binder ──
function openBinderCard(slot: BinderSlotCard) {
  selectedCardId.value = slot.cardId
  detailOpen.value = true
}

async function clearBinderCard(slot: BinderSlotCard) {
  try {
    await clearBinderSlotById(slot.slotId)
    toast.add({ title: 'Card removed from the binder', icon: 'i-lucide-check', color: 'success' })
    await reload()
  } catch {
    toast.add({ title: 'Could not remove the card', color: 'error' })
  }
}

function onBinderSlotClick(pos: { page: number; row: number; col: number }) {
  pendingSlot.value = pos
  binderPickerOpen.value = true
}

async function onBinderCardPick(card: ContainerCard) {
  const pos = pendingSlot.value
  if (!pos) return
  try {
    await assignCardToBinderSlot(GAME, card.displayId, selectedId.value, pos.page, pos.row, pos.col)
    binderPickerOpen.value = false
    toast.add({ title: 'Card placed', icon: 'i-lucide-check', color: 'success' })
    await reload()
  } catch (e: any) {
    const msg =
      e?.message === 'SLOT_TAKEN'
        ? 'This slot is already taken'
        : e?.message === 'NO_COPY'
          ? 'No unsorted copy left'
          : 'Could not place the card'
    toast.add({ title: msg, color: 'error' })
  } finally {
    pendingSlot.value = null
  }
}

// recherche tapée : debounce ; tri / filtre : immédiat (même watcher, 250 ms)
watchDebounced(
  () => [filters.search, filters.sort, filters.onlyTrade],
  () => {
    if (isAll.value) loadContent()
  },
  { debounce: 250 }
)

onMounted(reload)
</script>
