<template>
  <AppPage sidebar-label="Conteneurs">
    <template #sidebar>
      <ContainerTree
        :containers="containers"
        :unranged-count="unrangedCount"
        :selected-id="selectedId"
        @select="selectContainer"
        @create="openCreate"
        @changed="onContainerChanged"
      />
    </template>

    <div class="flex flex-col h-full">
      <!-- barre d'outils -->
      <div class="flex items-center gap-2 mb-4 shrink-0">
        <div>
          <h2 class="font-medium">{{ currentTitle }}</h2>
          <p class="text-xs text-muted">
            <template v-if="isBinder">{{ binderSlots.length }} cartes placées</template>
            <template v-else
              >{{ cards.length }} cartes différentes · {{ totalQty }} au total</template
            >
          </p>
        </div>
        <div class="flex-1" />

        <template v-if="isUnranged && cards.length">
          <UButton
            v-if="!selectMode"
            icon="i-lucide-check-square"
            color="neutral"
            variant="soft"
            label="Sélectionner"
            @click="enterSelectMode"
          />
          <template v-else>
            <UButton color="neutral" variant="ghost" label="Annuler" @click="exitSelectMode" />
            <UButton
              icon="i-lucide-folder-input"
              :label="`Ranger (${selectedCards.size})`"
              :disabled="selectedCards.size === 0"
              @click="openBatchPicker"
            />
          </template>
        </template>

        <UButtonGroup v-if="!selectMode && !isBinder">
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
            <div
              v-for="c in cards"
              :key="c.rootId"
              :data-content-card-id="c.displayId"
              class="container-card group relative"
            >
              <CardThumb
                :card="{ game: c.game, id: c.displayId, name: c.name, imageUrl: '' }"
                :quantity="c.totalQty"
                :selectable="selectMode"
                :selected="selectedCards.has(c.displayId)"
                @select="openCard(c)"
                @toggle="toggleCard(c)"
              />
              <UButton
                v-if="!isUnranged && !selectMode"
                :data-unassign="c.displayId"
                icon="i-lucide-folder-minus"
                color="error"
                variant="solid"
                size="xs"
                class="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition z-30"
                @click="askUnassign(c)"
              />
            </div>
          </div>

          <div v-else class="space-y-1">
            <div
              v-for="c in cards"
              :key="c.rootId"
              :data-content-card-id="c.displayId"
              class="container-card group w-full flex items-center gap-3 p-2 rounded-lg hover:bg-elevated"
            >
              <button class="flex items-center gap-3 flex-1 text-left min-w-0" @click="openCard(c)">
                <div class="w-10 shrink-0 rounded overflow-hidden">
                  <ArtThumb :passcode="c.displayId" />
                </div>
                <span class="flex-1 truncate">{{ c.name }}</span>
              </button>
              <UBadge color="neutral" variant="soft">×{{ c.totalQty }}</UBadge>
              <UButton
                v-if="!isUnranged"
                :data-unassign="c.displayId"
                icon="i-lucide-folder-minus"
                color="error"
                variant="ghost"
                size="xs"
                class="opacity-0 group-hover:opacity-100 transition"
                @click="askUnassign(c)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <CardDetail v-model:open="detailOpen" game="ygo" :card-id="selectedCardId" @added="reload" />
    <ContainerCreateModal v-model:open="createOpen" @created="onContainerCreated" />

    <ContainerPicker
      v-model:open="batchPickerOpen"
      :containers="containersWithCap"
      :max-quantity="null"
      :busy="batchBusy"
      title="Ranger la sélection dans..."
      @confirm="onBatchRange"
    />

    <!-- sélecteur de carte non rangée pour un slot de binder -->
    <unrangedCardPicker v-model:open="binderPickerOpen" game="ygo" @pick="onBinderCardPick" />

    <UModal v-model:open="unassignOpen" title="Retirer du conteneur ?">
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-muted">
            Retirer « {{ pendingUnassign?.name }} » de ce conteneur. La/les carte(s) redeviendront «
            non rangées ».
          </p>
          <div v-if="(pendingUnassign?.totalQty ?? 0) > 1">
            <p class="text-sm text-muted mb-1">Quantité à retirer</p>
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
          <UButton label="Annuler" color="neutral" variant="ghost" @click="close" />
          <UButton
            id="unassign-confirm"
            label="Retirer"
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

const toast = useToast()

const view = ref<'grid' | 'list'>('grid')
function setView(v: 'grid' | 'list') {
  view.value = v
}
const loading = ref(false)

const containers = ref<ContainerListItem[]>([])
const unrangedCount = ref(0)
const selectedId = ref<string>(UNRANGED_ID)

const cards = ref<ContainerCard[]>([])
const binderSlots = ref<BinderSlotCard[]>([])

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

const currentTitle = computed(() => {
  if (isUnranged.value) return 'Non rangées'
  return currentContainer.value?.name ?? 'Conteneur'
})

const emptyMessage = computed(() =>
  isUnranged.value ? 'Toutes tes cartes sont rangées' : 'Ce conteneur est vide'
)

async function loadSidebar() {
  const [list, unranged] = await Promise.all([listContainers(), fetchUnranged('ygo')])
  containers.value = list
  unrangedCount.value = unranged
}

async function loadContent() {
  loading.value = true
  try {
    if (isUnranged.value) {
      cards.value = await listUnrangedCards('ygo')
      binderSlots.value = []
    } else if (isBinder.value) {
      binderSlots.value = await listBinderSlots(selectedId.value, 'ygo')
      cards.value = []
    } else if (currentContainer.value) {
      cards.value = await listContainerCards(
        currentContainer.value.id,
        currentContainer.value.type,
        'ygo'
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
  await loadSidebar()
  await loadContent()
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
  if (
    selectedId.value !== UNRANGED_ID &&
    !containers.value.find((c) => c.id === selectedId.value)
  ) {
    selectedId.value = UNRANGED_ID
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
        'ygo',
        c.displayId,
        payload.containerId,
        payload.type,
        c.totalQty
      )
    }
    batchPickerOpen.value = false
    exitSelectMode()
    toast.add({
      title: totalPlaced > 0 ? `${totalPlaced} carte(s) rangée(s)` : 'Rien à ranger',
      icon: 'i-lucide-check',
      color: totalPlaced > 0 ? 'success' : 'warning',
    })
    await reload()
  } catch (e: any) {
    toast.add({
      title: e?.message === 'BINDER_FULL' ? 'Le classeur est plein' : 'Échec du rangement',
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
      'ygo',
      c.displayId,
      selectedId.value,
      currentType.value,
      unassignQty.value
    )
    unassignOpen.value = false
    toast.add({
      title: removed > 0 ? `${removed} carte(s) retirée(s)` : 'Rien à retirer',
      icon: 'i-lucide-check',
      color: removed > 0 ? 'success' : 'warning',
    })
    await reload()
  } catch {
    toast.add({ title: 'Échec du retrait', color: 'error' })
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
    toast.add({ title: 'Carte retirée du classeur', icon: 'i-lucide-check', color: 'success' })
    await reload()
  } catch {
    toast.add({ title: 'Échec du retrait', color: 'error' })
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
    await assignCardToBinderSlot(
      'ygo',
      card.displayId,
      selectedId.value,
      pos.page,
      pos.row,
      pos.col
    )
    binderPickerOpen.value = false
    toast.add({ title: 'Carte placée', icon: 'i-lucide-check', color: 'success' })
    await reload()
  } catch (e: any) {
    const msg =
      e?.message === 'SLOT_TAKEN'
        ? 'Cet emplacement est déjà occupé'
        : e?.message === 'NO_COPY'
          ? "Plus d'exemplaire non rangé disponible"
          : 'Échec du placement'
    toast.add({ title: msg, color: 'error' })
  } finally {
    pendingSlot.value = null
  }
}

onMounted(reload)
</script>
