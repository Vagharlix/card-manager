<template>
  <!-- mobile : panneau qui monte du bas (glisser pour fermer) ; desktop : panneau à droite -->
  <component
    :is="isMobile ? UDrawer : USlideover"
    :open="open"
    v-bind="isMobile ? {} : { side: 'right' }"
    :title="detail?.name ?? 'Card'"
    @update:open="$emit('update:open', $event)"
  >
    <template #body>
      <div v-if="loading" class="space-y-4">
        <USkeleton class="w-full aspect-[0.686] rounded-lg" />
        <USkeleton class="h-4 w-3/4" />
        <USkeleton class="h-4 w-1/2" />
      </div>

      <div v-else-if="detail" id="card-detail" class="space-y-5">
        <!-- image en grand -->
        <div
          class="rounded-lg overflow-hidden ring-1 ring-default mx-auto"
          :class="isMobile ? 'max-w-[60%]' : 'max-w-xs'"
        >
          <img
            v-if="bigImage.src.value"
            :src="bigImage.src.value"
            :alt="detail.name"
            class="w-full"
          />
          <USkeleton v-else class="w-full aspect-[0.686]" />
        </div>

        <!-- sélecteur d'art alternatif -->
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

        <!-- statut possédée -->
        <div class="flex items-center gap-2 text-sm">
          <UIcon name="i-lucide-layers" class="text-muted" />
          <span
            id="card-detail-owned"
            :data-owned-count="owned"
            :class="owned > 0 ? 'text-success font-medium' : 'text-muted'"
          >
            {{ owned }} in your collection
          </span>
        </div>

        <!-- ── ajout ── -->
        <div class="space-y-2">
          <div class="flex gap-2">
            <UButton
              id="btn-quick-add"
              block
              icon="i-lucide-plus"
              label="Add"
              :loading="adding"
              :size="isMobile ? 'xl' : 'md'"
              class="flex-1"
              @click="quickAdd"
            />
            <UButton
              id="btn-toggle-detailed"
              icon="i-lucide-sliders-horizontal"
              color="neutral"
              variant="soft"
              aria-label="Detailed add"
              :size="isMobile ? 'xl' : 'md'"
              @click="toggleDetailedForm"
            />
          </div>

          <div v-if="showDetailedForm" class="rounded-lg border border-default p-3 space-y-3">
            <div class="grid grid-cols-2 gap-2">
              <div>
                <p class="text-xs text-muted mb-1">Quantity</p>
                <UInput v-model.number="form.quantity" type="number" min="1" size="sm" />
              </div>
              <div>
                <p class="text-xs text-muted mb-1">Condition</p>
                <USelect v-model="form.condition" :items="conditionItems" size="sm" />
              </div>
              <div>
                <p class="text-xs text-muted mb-1">Language</p>
                <USelect v-model="form.language" :items="languageItems" size="sm" />
              </div>
              <div>
                <p class="text-xs text-muted mb-1">Printing</p>
                <USelect
                  v-model="form.printingId"
                  :items="printingItems"
                  placeholder="None"
                  size="sm"
                />
              </div>
              <div>
                <p class="text-xs text-muted mb-1">Rarity</p>
                <USelect
                  id="add-rarity-select"
                  v-model="form.rarity"
                  :items="rarityItems(form.printingId)"
                  :disabled="!rarityItems(form.printingId).length"
                  placeholder="Not set"
                  size="sm"
                />
              </div>
            </div>
            <div class="flex gap-4">
              <UCheckbox v-model="form.firstEdition" label="1st edition" size="sm" />
              <UCheckbox v-model="form.foil" label="Foil" size="sm" />
              <UCheckbox v-model="form.altered" label="Altered" size="sm" />
              <UCheckbox v-model="form.signed" label="Signed" size="sm" />
            </div>
            <UButton
              id="btn-detailed-add"
              block
              icon="i-lucide-check"
              label="Add with these details"
              :loading="adding"
              @click="detailedAdd"
            />
          </div>
        </div>

        <!-- ranger dans un conteneur (flux A) -->
        <UButton
          id="btn-range-card"
          v-if="unrangedForCard > 0"
          block
          icon="i-lucide-folder-input"
          color="neutral"
          variant="soft"
          :label="`Store (${unrangedForCard} unsorted)`"
          @click="openPicker"
        />

        <!-- ── où est cette carte ── -->
        <div v-if="locations.length" class="border-t border-default pt-4">
          <p class="text-muted text-xs mb-2">STORAGE</p>
          <div class="space-y-1.5">
            <div
              v-for="(loc, i) in locations"
              :key="i"
              class="flex items-center gap-2 text-sm rounded-lg border border-default p-2"
            >
              <UIcon :name="locationIcon(loc.locationType)" class="text-muted shrink-0" />
              <span class="flex-1 truncate">{{ loc.locationName }}</span>
              <span
                v-if="loc.locationType === 'binder' && loc.page !== null"
                class="text-xs text-muted"
              >
                p.{{ loc.page + 1 }} · L{{ (loc.row ?? 0) + 1 }}C{{ (loc.col ?? 0) + 1 }}
              </span>
              <span
                v-else-if="loc.locationType === 'deck' && loc.extraInfo"
                class="text-xs text-muted"
              >
                {{ loc.extraInfo }}
              </span>
              <UBadge v-if="loc.locationType !== 'binder'" color="neutral" variant="soft" size="xs"
                >×{{ loc.quantity }}</UBadge
              >
            </div>
          </div>
        </div>

        <!-- ── mes exemplaires ── -->
        <div v-if="entries.length" class="border-t border-default pt-4">
          <p class="text-muted text-xs mb-2">MY COPIES ({{ entries.length }})</p>
          <div class="space-y-1.5">
            <div v-for="entry in entries" :key="entry.id" class="rounded-lg border border-default">
              <div class="flex items-center gap-2 p-2">
                <UBadge color="neutral" variant="soft">×{{ entry.quantity }}</UBadge>
                <span class="text-sm">{{ entry.condition }}</span>
                <span class="text-sm text-muted uppercase">{{ entry.language }}</span>
                <UBadge
                  v-if="entry.rarity"
                  :data-entry-rarity="entry.rarity"
                  color="neutral"
                  variant="outline"
                  size="xs"
                  >{{ entry.rarity }}</UBadge
                >
                <UBadge
                  v-if="entry.firstEdition"
                  data-entry-first-edition
                  color="info"
                  variant="soft"
                  size="xs"
                  >1st ed.</UBadge
                >
                <UBadge v-if="entry.foil" color="warning" variant="soft" size="xs">Foil</UBadge>
                <UBadge
                  v-if="entry.tradeQty"
                  :data-entry-trade-qty="entry.tradeQty"
                  icon="i-lucide-repeat"
                  color="primary"
                  variant="soft"
                  size="xs"
                  :label="`${entry.tradeQty} for trade`"
                />
                <span v-if="entry.printingId" class="text-xs text-muted truncate">{{
                  entry.printingId
                }}</span>
                <div class="flex-1" />
                <UButton
                  :data-entry-edit="entry.id"
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  :size="isMobile ? 'lg' : 'xs'"
                  @click="toggleEdit(entry.id)"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  :size="isMobile ? 'lg' : 'xs'"
                  @click="askRemove(entry.id)"
                />
              </div>

              <div v-if="editingId === entry.id" class="border-t border-default p-2 space-y-2">
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <p class="text-xs text-muted mb-1">Quantity</p>
                    <UInput v-model.number="editForm.quantity" type="number" min="1" size="sm" />
                  </div>
                  <div>
                    <p class="text-xs text-muted mb-1">Condition</p>
                    <USelect v-model="editForm.condition" :items="conditionItems" size="sm" />
                  </div>
                  <div>
                    <p class="text-xs text-muted mb-1">Language</p>
                    <USelect v-model="editForm.language" :items="languageItems" size="sm" />
                  </div>
                  <div>
                    <p class="text-xs text-muted mb-1">Printing</p>
                    <USelect
                      v-model="editForm.printingId"
                      :items="printingItems"
                      placeholder="None"
                      size="sm"
                    />
                  </div>
                  <div>
                    <p class="text-xs text-muted mb-1">Rarity</p>
                    <USelect
                      id="entry-rarity-select"
                      v-model="editForm.rarity"
                      :items="rarityItems(editForm.printingId)"
                      :disabled="!rarityItems(editForm.printingId).length"
                      placeholder="Not set"
                      size="sm"
                    />
                  </div>
                  <div>
                    <p class="text-xs text-muted mb-1">For trade</p>
                    <UInput
                      id="entry-trade-qty-input"
                      v-model.number="editForm.tradeQty"
                      type="number"
                      min="0"
                      :max="editForm.quantity"
                      size="sm"
                    />
                  </div>
                </div>
                <div class="flex gap-4">
                  <UCheckbox
                    id="entry-first-edition"
                    v-model="editForm.firstEdition"
                    label="1st edition"
                    size="sm"
                  />
                  <UCheckbox v-model="editForm.foil" label="Foil" size="sm" />
                  <UCheckbox v-model="editForm.altered" label="Altered" size="sm" />
                  <UCheckbox v-model="editForm.signed" label="Signed" size="sm" />
                </div>
                <div class="flex gap-2">
                  <UButton
                    id="entry-save-btn"
                    size="sm"
                    label="Save"
                    icon="i-lucide-check"
                    :loading="savingEdit"
                    @click="saveEdit(entry.id)"
                  />
                  <UButton
                    size="sm"
                    label="Cancel"
                    color="neutral"
                    variant="ghost"
                    @click="cancelEdit"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- caractéristiques (fournies par le module du jeu) -->
        <div v-if="detail.facts.length" class="space-y-1 text-sm border-t border-default pt-4">
          <div
            v-for="f in detail.facts"
            :key="f.label"
            class="flex justify-between gap-4"
            :data-card-fact="f.label"
          >
            <span class="text-muted">{{ f.label }}</span><span class="text-right">{{ f.value }}</span>
          </div>
        </div>

        <!-- texte d'effet -->
        <div
          v-if="detail.legalText"
          class="text-sm border-t border-default pt-4 whitespace-pre-line"
        >
          {{ detail.legalText }}
        </div>

        <!-- mentions (ex. banlist) -->
        <div v-if="detail.badges.length" class="flex flex-wrap items-center gap-2 text-sm">
          <UBadge v-for="b in detail.badges" :key="b.label" :color="b.color" variant="soft">
            {{ b.label }}
          </UBadge>
        </div>

        <!-- printings -->
        <div v-if="detail.printings.length" class="border-t border-default pt-4">
          <p class="text-muted text-xs mb-2">PRINTINGS ({{ detail.printings.length }})</p>
          <div class="space-y-1 text-sm max-h-48 overflow-y-auto">
            <div v-for="p in detail.printings" :key="p.id" class="flex justify-between gap-2">
              <span class="truncate">{{ p.setName }}</span>
              <span class="text-muted shrink-0">{{ p.setCode }} · {{ p.rarity }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </component>

  <!-- confirmation de suppression (hors slideover pour le z-index) -->
  <UModal v-model:open="confirmOpen" title="Delete this copy?">
    <template #body>
      <p class="text-sm text-muted">
        This removes the copy from your collection. You can add it again later.
      </p>
    </template>
    <template #footer="{ close }">
      <div class="flex gap-2 justify-end w-full">
        <UButton label="Cancel" color="neutral" variant="ghost" @click="close" />
        <UButton
          label="Delete"
          color="error"
          icon="i-lucide-trash-2"
          :loading="deletingId !== null"
          @click="confirmRemove"
        />
      </div>
    </template>
  </UModal>

  <!-- sélecteur de conteneur (flux A) -->
  <ContainerPicker
    v-model:open="pickerOpen"
    :containers="containers"
    :max-quantity="unrangedForCard"
    :busy="ranging"
    @confirm="onRange"
  />
</template>

<script setup lang="ts">
import { getCardDetail, type CardDetail } from '~/services/card/detail'
import {
  addCard,
  updateCard,
  removeCard,
  ownedQuantity,
  entriesForCard,
  type CardCondition,
  type CollectionEntry,
} from '~/services/collection'
import {
  listContainersWithCapacity,
  assignCardToContainer,
  cardLocations,
  type ContainerWithCapacity,
  type ContainerType,
  type CardLocation,
} from '~/services/containers'
import { useDatabase } from '~/composables/useDatabase'
import { gameDef } from '~/services/game'

const props = defineProps<{
  open: boolean
  game: string
  cardId: string | null
}>()

const emit = defineEmits<{ 'update:open': [value: boolean]; added: [] }>()

const { isMobile } = useResponsive()
const UDrawer = resolveComponent('UDrawer')
const USlideover = resolveComponent('USlideover')
const toast = useToast()

const detail = ref<CardDetail | null>(null)
const loading = ref(false)
const activeArtId = ref<string>('')
const owned = ref(0)
const entries = ref<CollectionEntry[]>([])

const adding = ref(false)
const showDetailedForm = ref(false)
const editingId = ref<string | null>(null)
function toggleDetailedForm() {
  showDetailedForm.value = !showDetailedForm.value
}
function cancelEdit() {
  editingId.value = null
}
const savingEdit = ref(false)
const deletingId = ref<string | null>(null)

const confirmOpen = ref(false)
const pendingDeleteId = ref<string | null>(null)

// rangement dans un conteneur
const containers = ref<ContainerWithCapacity[]>([])
const pickerOpen = ref(false)
const ranging = ref(false)
const unrangedForCard = ref(0)

// où est cette carte
const locations = ref<CardLocation[]>([])

const conditionItems = computed(() =>
  gameDef(props.game).conditions.map((c) => ({ label: c.label, value: c.id }))
)
const languageItems = computed(() =>
  gameDef(props.game).languages.map((l) => ({ label: l.label, value: l.id }))
)

const form = reactive({
  quantity: 1,
  condition: 'NM' as CardCondition,
  language: 'en',
  printingId: undefined as string | undefined,
  rarity: undefined as string | undefined,
  firstEdition: false,
  foil: false,
  altered: false,
  signed: false,
})

const editForm = reactive({
  quantity: 1,
  condition: 'NM' as CardCondition,
  language: 'en',
  printingId: undefined as string | undefined,
  rarity: undefined as string | undefined,
  firstEdition: false,
  foil: false,
  altered: false,
  signed: false,
  tradeQty: 0,
})

const printingItems = computed(() =>
  (detail.value?.printings ?? []).map((p) => ({
    label: `${p.setCode} · ${p.setName}`,
    value: p.id,
  }))
)

// raretés possibles de l'impression choisie (un code peut en avoir plusieurs)
function rarityItems(printingId: string | undefined) {
  const p = detail.value?.printings.find((x) => x.id === printingId)
  return (p?.rarities ?? []).map((r) => ({ label: r, value: r }))
}

// changement d'impression : rareté remise d'accord (seule possible, sinon vide)
function syncRarity(f: { printingId?: string; rarity?: string }) {
  const items = rarityItems(f.printingId).map((i) => i.value)
  if (f.rarity && items.includes(f.rarity)) return
  f.rarity = items.length === 1 ? items[0] : undefined
}
watch(
  () => form.printingId,
  () => syncRarity(form)
)
watch(
  () => editForm.printingId,
  () => syncRarity(editForm)
)

function locationIcon(type: string): string {
  return type === 'deckbox'
    ? 'i-lucide-box'
    : type === 'binder'
      ? 'i-lucide-notebook'
      : type === 'bulk_box'
        ? 'i-lucide-archive'
        : 'i-lucide-layers' // deck
}

// quantité non rangée de l'artwork actif
async function refreshUnrangedForCard() {
  const { user } = await useDatabase()
  const rows = await user.select<{ n: number }[]>(
    `SELECT COALESCE(SUM(c.quantity - COALESCE(a.qty, 0)), 0) AS n
     FROM collection c
     LEFT JOIN (
        SELECT collection_id, SUM(qty) AS qty FROM (
            SELECT dc.collection_id, dc.quantity AS qty
              FROM deckbox_cards dc
              JOIN containers ct ON ct.id = dc.deckbox_id AND ct.deleted_at IS NULL
            UNION ALL
            SELECT bs.collection_id, 1 AS qty
              FROM binder_slots bs
              JOIN containers ct ON ct.id = bs.container_id AND ct.deleted_at IS NULL
            UNION ALL
            SELECT bb.collection_id, bb.quantity AS qty
              FROM bulk_box_contents bb
              JOIN containers ct ON ct.id = bb.container_id AND ct.deleted_at IS NULL
        ) GROUP BY collection_id
     ) a ON a.collection_id = c.id
     WHERE c.deleted_at IS NULL AND c.game = ? AND c.card_id = ?`,
    [props.game, activeArtId.value]
  )
  unrangedForCard.value = rows[0]?.n ?? 0
}

async function refreshLocations() {
  locations.value = await cardLocations(props.game, activeArtId.value)
}

async function refreshOwned() {
  owned.value = await ownedQuantity(props.game, activeArtId.value)
  entries.value = await entriesForCard(props.game, activeArtId.value)
  await refreshUnrangedForCard()
  await refreshLocations()
}

async function refreshContainers() {
  containers.value = await listContainersWithCapacity()
}

async function openPicker() {
  await refreshContainers()
  pickerOpen.value = true
}

watch(
  () => props.cardId,
  async (id) => {
    if (!id) return
    loading.value = true
    detail.value = null
    showDetailedForm.value = false
    editingId.value = null
    try {
      detail.value = await getCardDetail(props.game, id)
      activeArtId.value = id
      await refreshOwned()
      await refreshContainers()
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)

watch(activeArtId, async (id) => {
  if (id) await refreshOwned()
})

const bigImage = useCardImage(() => activeArtId.value, 'full')

async function quickAdd() {
  adding.value = true
  try {
    await addCard({ game: props.game, cardId: activeArtId.value })
    await refreshOwned()
    toast.add({ title: 'Card added', icon: 'i-lucide-check', color: 'success' })
    emit('added')
  } catch {
    toast.add({ title: 'Could not add the card', color: 'error' })
  } finally {
    adding.value = false
  }
}

async function detailedAdd() {
  adding.value = true
  try {
    await addCard({
      game: props.game,
      cardId: activeArtId.value,
      printingId: form.printingId ?? null,
      quantity: form.quantity,
      condition: form.condition,
      language: form.language,
      foil: form.foil,
      altered: form.altered,
      signed: form.signed,
      rarity: form.rarity ?? null,
      firstEdition: form.firstEdition,
    })
    await refreshOwned()
    showDetailedForm.value = false
    toast.add({ title: 'Card added', icon: 'i-lucide-check', color: 'success' })
    emit('added')
  } catch {
    toast.add({ title: 'Could not add the card', color: 'error' })
  } finally {
    adding.value = false
  }
}

function toggleEdit(id: string) {
  if (editingId.value === id) {
    editingId.value = null
    return
  }
  const e = entries.value.find((x) => x.id === id)
  if (!e) return
  editForm.quantity = e.quantity
  editForm.condition = e.condition
  editForm.language = e.language
  editForm.printingId = e.printingId ?? undefined
  editForm.rarity = e.rarity ?? undefined
  editForm.firstEdition = e.firstEdition
  editForm.foil = e.foil
  editForm.altered = e.altered
  editForm.signed = e.signed
  editForm.tradeQty = e.tradeQty
  editingId.value = id
}

async function saveEdit(id: string) {
  savingEdit.value = true
  try {
    await updateCard(id, {
      quantity: editForm.quantity,
      condition: editForm.condition,
      language: editForm.language,
      printingId: editForm.printingId ?? null,
      foil: editForm.foil,
      altered: editForm.altered,
      signed: editForm.signed,
      tradeQty: Math.min(editForm.tradeQty || 0, editForm.quantity),
      rarity: editForm.rarity ?? null,
      firstEdition: editForm.firstEdition,
    })
    await refreshOwned()
    editingId.value = null
    toast.add({ title: 'Copy updated', icon: 'i-lucide-check', color: 'success' })
    emit('added')
  } catch (e) {
    const belowAssigned = e instanceof Error && e.message === 'QUANTITY_BELOW_ASSIGNED'
    toast.add({
      title: belowAssigned ? 'Some copies are still stored' : 'Could not save the changes',
      description: belowAssigned ? 'Remove the extra copies from their storage first.' : undefined,
      color: 'error',
    })
  } finally {
    savingEdit.value = false
  }
}

function askRemove(id: string) {
  pendingDeleteId.value = id
  confirmOpen.value = true
}

async function confirmRemove() {
  const id = pendingDeleteId.value
  if (!id) return
  deletingId.value = id
  try {
    await removeCard(id)
    await refreshOwned()
    toast.add({ title: 'Copy deleted', icon: 'i-lucide-check', color: 'success' })
    emit('added')
  } catch {
    toast.add({ title: 'Could not delete', color: 'error' })
  } finally {
    deletingId.value = null
    confirmOpen.value = false
    pendingDeleteId.value = null
  }
}

async function onRange(payload: { containerId: string; type: ContainerType; quantity: number }) {
  ranging.value = true
  try {
    const placed = await assignCardToContainer(
      props.game,
      activeArtId.value,
      payload.containerId,
      payload.type,
      payload.quantity
    )
    pickerOpen.value = false
    toast.add({
      title: placed > 0 ? `${placed} card(s) stored` : 'Nothing to store',
      icon: 'i-lucide-check',
      color: placed > 0 ? 'success' : 'warning',
    })
    await refreshOwned()
    await refreshContainers()
    emit('added')
  } catch (e: any) {
    toast.add({
      title: e?.message === 'BINDER_FULL' ? 'The binder is full' : 'Could not store the cards',
      color: 'error',
    })
  } finally {
    ranging.value = false
  }
}
</script>
