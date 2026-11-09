<template>
  <AppPage
    v-model:sidebar-open="searchOpen"
    sidebar-label="Add cards"
    :title="deck?.name ?? 'Deck'"
    :subtitle="`${totalCards} cards`"
    :sidebar-button="false"
  >
    <template #leading>
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        size="lg"
        to="/decks"
        aria-label="Back to decks"
      />
    </template>
    <template #actions>
      <UButton
        icon="i-lucide-package"
        color="neutral"
        variant="soft"
        size="lg"
        :aria-label="currentBox ? currentBox.name : 'Store'"
        data-mobile-range-btn
        @click="openRange"
      />
    </template>
    <!-- panneau de recherche dans la sidebar -->
    <template #sidebar>
      <div class="flex flex-col h-full">
        <div class="flex gap-2 mb-3 shrink-0">
          <UInput
            id="deck-search-input"
            v-model="query"
            placeholder="Card name…"
            icon="i-lucide-search"
            class="flex-1"
            size="sm"
          />
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto">
          <div v-if="searching" class="text-center text-xs text-muted py-4">Searching…</div>
          <div v-else-if="!results.length && query" class="text-center text-xs text-dimmed py-4">
            No results
          </div>
          <div v-else class="grid grid-cols-3 gap-2">
            <div v-for="r in results" :key="r.id" class="relative group">
              <button
                :data-search-card-id="r.id"
                class="deck-search-result block w-full"
                @click="addCard(r)"
                @contextmenu.prevent="showInfo(r.id)"
              >
                <div
                  class="aspect-[0.686] rounded overflow-hidden border border-transparent group-hover:border-primary transition-colors"
                >
                  <ArtThumb :passcode="r.id" class="w-full h-full object-cover" />
                </div>
              </button>
              <div
                v-if="ownedIds.has(r.id)"
                class="absolute top-0.5 left-0.5 size-4 rounded-full bg-success text-inverted flex items-center justify-center"
                title="You own this card"
              >
                <UIcon name="i-lucide-check" class="text-[10px]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- zones du deck + panneau d'aperçu -->
    <div class="flex h-full">
      <div class="flex-1 min-w-0 flex flex-col">
        <div class="flex items-center gap-2 mb-4 shrink-0" :class="isMobile && 'flex-wrap'">
          <UButton
            v-if="!isMobile"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            size="sm"
            to="/decks"
          />
          <div v-if="!isMobile" class="flex-1">
            <h2 class="font-medium">{{ deck?.name ?? 'Deck' }}</h2>
            <p class="text-xs text-muted" :data-total-cards="totalCards">{{ totalCards }} cards</p>
          </div>
          <!-- sélecteur de format -->
          <USelect
            id="deck-format-select"
            v-model="format"
            :items="formatItems"
            :size="isMobile ? 'md' : 'sm'"
            :class="isMobile ? 'flex-1' : 'w-40'"
            @update:model-value="onFormatChange"
          >
            <template #item="{ item }">
              <span :data-select-value="(item as any).value" class="block w-full">{{
                item.label
              }}</span>
            </template>
          </USelect>
          <!-- ranger dans un deckbox -->
          <UButton
            v-if="!isMobile"
            id="deck-range-btn"
            icon="i-lucide-package"
            color="neutral"
            variant="soft"
            size="sm"
            :label="currentBox ? currentBox.name : 'Store'"
            @click="openRange"
          />
          <!-- bouton ré-afficher le panneau si masqué (desktop) -->
          <UButton
            v-if="!isMobile && !showPreview"
            icon="i-lucide-panel-right-open"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="openPreview"
          />
        </div>

        <!-- MOBILE : une zone à la fois -->
        <div
          v-if="isMobile"
          role="tablist"
          class="grid mb-3 border-b border-default shrink-0"
          :style="{ gridTemplateColumns: `repeat(${boardTabs.length}, minmax(0, 1fr))` }"
        >
          <button
            v-for="b in boardTabs"
            :key="b.id"
            role="tab"
            :aria-selected="mobileBoard === b.id"
            :data-mobile-board="b.id"
            class="h-11 text-sm border-b-2 -mb-px transition"
            :class="
              mobileBoard === b.id
                ? 'border-primary font-semibold'
                : 'border-transparent text-muted'
            "
            @click="mobileBoard = b.id"
          >
            {{ b.label }} · {{ boardCount(b.id) }}
          </button>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto space-y-5 pr-1">
          <!-- bandeau récapitulatif des infractions banlist -->
          <UAlert
            v-if="!validation.valid"
            color="error"
            variant="soft"
            icon="i-lucide-ban"
            data-banlist-alert
            :title="`${validation.violations.length} card(s) over the ${format.toUpperCase()} banlist`"
          >
            <template #description>
              <ul class="text-xs mt-1 space-y-0.5">
                <li v-for="v in validation.violations" :key="v.rootId">
                  {{ v.name }} — {{ v.quantity }} in deck, {{ statusLabel(v) }}
                </li>
              </ul>
            </template>
          </UAlert>

          <!-- une zone par board du moteur de deck du jeu -->
          <template v-for="b in engine.rules.boards" :key="b.id">
            <DeckBoard
              v-if="!isMobile || mobileBoard === b.id"
              :label="b.label"
              :board="b.id"
              :cards="contents[b.id] ?? []"
              :flagged="validation.flagged"
              :min="b.min"
              :max="b.max"
              show-max
              :is-side="b.id === SIDE"
              @info="(c) => onCardClick(c.cardId)"
              @remove="(c) => removeCard(c, b.id)"
              @move="(c) => (b.id === SIDE ? moveFromSide(c) : moveToSide(c, b.id))"
              @add="(c) => addExisting(c, b.id === SIDE ? SIDE : undefined)"
            />
          </template>
        </div>

        <!-- MOBILE : ajout de cartes à portée de pouce -->
        <div v-if="isMobile" class="shrink-0 py-3">
          <UButton
            block
            size="xl"
            icon="i-lucide-plus"
            label="Add cards"
            data-mobile-deck-add
            @click="openSearch"
          />
        </div>
      </div>

      <!-- panneau d'aperçu : desktop uniquement, masquable -->
      <CardPreviewPanel
        v-if="!isMobile && showPreview"
        :card-id="previewCardId"
        :game="GAME"
        @close="showPreview = false"
      />
    </div>

    <!-- détail slideover : utilisé sur mobile -->
    <CardDetail
      v-model:open="detailOpen"
      :game="GAME"
      :card-id="detailCardId"
      @added="refreshOwned"
    />

    <!-- ranger le deck dans un deckbox -->
    <DeckboxRangeModal
      v-model:open="rangeOpen"
      :deck-id="deckId"
      :applying="rangeApplying"
      @confirm="onRangeConfirm"
    />
  </AppPage>
</template>

<script setup lang="ts">
import { searchCards, type CardSearchResult } from '~/services/search'
import { ownedCardIds } from '~/services/collection'
import {
  getDeck,
  getDeckContents,
  addCardToDeck,
  removeCardFromDeck,
  updateDeckMeta,
  deckEngine,
  validateDeck,
  moveCardBoard,
  type Deck,
  type DeckContents,
  type DeckCard,
  type DeckValidation,
} from '~/services/decks'
import {
  deckCurrentDeckbox,
  applyDeckToDeckbox,
  type CurrentDeckbox,
  type DeckLinkPlan,
} from '~/services/deckLink'
import type { Board } from '~/services/deck/types'
import { cardMetaOf } from '~/services/card/meta'

// jeu affiché (la page est remontée quand il change, cf. app.vue)
const GAME = useCurrentGame().game.value
// règles de deck du jeu (zones, formats, limites)
const engine = deckEngine(GAME)

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { isMobile } = useResponsive()

// mobile : recherche dans un panneau du bas, une zone du deck à la fois
const searchOpen = ref(false)
function openSearch() {
  searchOpen.value = true
}
const SIDE: Board = 'side'
const boardTabs = engine.rules.boards.map((b) => ({ id: b.id, label: b.shortLabel ?? b.label }))
const mobileBoard = ref<Board>(engine.rules.boards[0]?.id ?? 'main')
function boardCount(b: Board) {
  return (contents.value[b] ?? []).reduce((s, c) => s + c.quantity, 0)
}

const deckId = computed(() => route.params.id as string)

const deck = ref<Deck | null>(null)
const contents = ref<DeckContents>({ main: [], extra: [], side: [] })
const ownedIds = ref<Set<string>>(new Set())
const validation = ref<DeckValidation>({ valid: true, violations: [], flagged: new Set() })

// format du deck
const format = ref<string>(engine.rules.defaultFormat)
const formatItems = engine.rules.formats.map((f) => ({ label: f.label, value: f.id }))

const query = ref('')
const results = ref<CardSearchResult[]>([])
const searching = ref(false)

// aperçu desktop
const showPreview = ref(true)
function openPreview() {
  showPreview.value = true
}
const previewCardId = ref<string | null>(null)

// détail slideover (mobile)
const detailOpen = ref(false)
const detailCardId = ref<string | null>(null)

// ranger dans un deckbox
const rangeOpen = ref(false)
function openRange() {
  rangeOpen.value = true
}
const rangeApplying = ref(false)
const currentBox = ref<CurrentDeckbox | null>(null)

const totalCards = computed(() =>
  [...contents.value.main, ...contents.value.extra, ...contents.value.side].reduce(
    (s, c) => s + c.quantity,
    0
  )
)

async function loadDeck() {
  deck.value = await getDeck(deckId.value)
  if (!deck.value) {
    toast.add({ title: 'Deck not found', color: 'error' })
    router.push('/decks')
    return
  }
  format.value = deck.value.format ?? engine.rules.defaultFormat
  currentBox.value = await deckCurrentDeckbox(deckId.value)
  await refreshContents()
}

async function onFormatChange(value: string) {
  format.value = value
  await updateDeckMeta(deckId.value, { format: value })
  // un changement de format peut rendre le deck invalide → revalider
  validation.value = await validateDeck(deckId.value, GAME)
  toast.add({ title: `Format : ${value.toUpperCase()}`, icon: 'i-lucide-check', color: 'success' })
}

async function refreshContents() {
  contents.value = await getDeckContents(deckId.value, GAME)
  validation.value = await validateDeck(deckId.value, GAME)
}

async function refreshOwned() {
  ownedIds.value = await ownedCardIds(GAME)
  await refreshContents()
}

watchDebounced(
  query,
  async () => {
    if (!query.value.trim()) {
      results.value = []
      return
    }
    searching.value = true
    try {
      results.value = await searchCards(GAME, { query: query.value, field: 'name', limit: 30 })
    } finally {
      searching.value = false
    }
  },
  { debounce: 300 }
)

// clic gauche sur une carte (deck ou recherche) :
// desktop → panneau d'aperçu ; mobile → slideover détail
function onCardClick(cardId: string) {
  if (isMobile.value) {
    detailCardId.value = cardId
    detailOpen.value = true
  } else {
    showPreview.value = true
    previewCardId.value = cardId
  }
}

// clic droit / bouton info explicite → toujours le détail complet
function showInfo(cardId: string) {
  onCardClick(cardId)
}

// libellé de la limite pour une infraction
function statusLabel(v: { status: string; limit: number }): string {
  if (v.status === 'Forbidden') return 'forbidden (0)'
  if (v.status === 'Limited') return 'limited to 1'
  if (v.status === 'Semi-Limited') return 'semi-limited (2)'
  return `max ${v.limit}`
}

async function addCard(r: CardSearchResult) {
  const type = await fetchType(r.id)
  const res = await addCardToDeck(deckId.value, GAME, r.id, type)
  if (!res.ok) {
    const msg =
      res.reason === 'forbidden'
        ? 'Card forbidden in this format'
        : res.reason === 'limited'
          ? 'Card limited to 1 copy'
          : res.reason === 'semi'
            ? 'Card semi-limited (2 max)'
            : `${res.limit}-copy limit reached`
    toast.add({ title: msg, color: 'warning', icon: 'i-lucide-ban' })
    return
  }
  // alimente l'aperçu desktop avec la carte ajoutée
  onCardClick(r.id)
  await refreshContents()
}

async function removeCard(c: DeckCard, board: Board) {
  await removeCardFromDeck(deckId.value, c.cardId, board)
  await refreshContents()
}

// envoie une carte du Main/Extra vers le Side
async function moveToSide(c: DeckCard, from: Board) {
  await moveCardBoard(deckId.value, GAME, c.cardId, c.type, from, 'side')
  await refreshContents()
}

// renvoie une carte du Side vers le deck (Main ou Extra selon son type)
async function moveFromSide(c: DeckCard) {
  const target = engine.boardForCard({ cardId: c.cardId, type: c.type })
  await moveCardBoard(deckId.value, GAME, c.cardId, c.type, 'side', target)
  await refreshContents()
}

// +1 d'une carte déjà dans le deck (menu mobile). board explicite pour le Side.
async function addExisting(c: DeckCard, board?: Board) {
  const res = await addCardToDeck(deckId.value, GAME, c.cardId, c.type, board)
  if (!res.ok) {
    const msg =
      res.reason === 'forbidden'
        ? 'Card forbidden in this format'
        : res.reason === 'limited'
          ? 'Card limited to 1 copy'
          : res.reason === 'semi'
            ? 'Card semi-limited (2 max)'
            : `${res.limit}-copy limit reached`
    toast.add({ title: msg, color: 'warning', icon: 'i-lucide-ban' })
    return
  }
  await refreshContents()
}

async function fetchType(cardId: string): Promise<string | null> {
  return (await cardMetaOf(GAME, [cardId])).get(cardId)?.type ?? null
}

// applique le rangement du deck dans le deckbox choisi
async function onRangeConfirm(plan: DeckLinkPlan) {
  rangeApplying.value = true
  try {
    await applyDeckToDeckbox(deckId.value, plan.deckboxId, GAME)
    rangeOpen.value = false
    currentBox.value = await deckCurrentDeckbox(deckId.value)
    toast.add({
      title: `Deck stored in “${plan.deckboxName}”`,
      icon: 'i-lucide-check',
      color: 'success',
    })
    await refreshOwned()
  } catch {
    toast.add({ title: 'Could not store the deck', color: 'error' })
  } finally {
    rangeApplying.value = false
  }
}

onMounted(async () => {
  ownedIds.value = await ownedCardIds(GAME)
  await loadDeck()
})
</script>
