<template>
  <AppPage sidebar-label="Ajouter des cartes">
    <!-- panneau de recherche dans la sidebar -->
    <template #sidebar>
      <div class="flex flex-col h-full">
        <div class="flex gap-2 mb-3 shrink-0">
          <UInput
            v-model="query"
            placeholder="Nom de carte..."
            icon="i-lucide-search"
            class="flex-1"
            size="sm"
          />
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto">
          <div v-if="searching" class="text-center text-xs text-muted py-4">Recherche…</div>
          <div v-else-if="!results.length && query" class="text-center text-xs text-dimmed py-4">
            Aucun résultat
          </div>
          <div v-else class="grid grid-cols-3 gap-2">
            <div v-for="r in results" :key="r.id" class="relative group">
              <button class="block w-full" @click="addCard(r)">
                <div
                  class="aspect-[0.686] rounded overflow-hidden border border-transparent hover:border-primary transition-colors"
                >
                  <ArtThumb :passcode="r.id" class="w-full h-full object-cover" />
                </div>
              </button>
              <div
                v-if="ownedIds.has(r.id)"
                class="absolute top-0.5 left-0.5 size-4 rounded-full bg-success text-inverted flex items-center justify-center"
                title="Tu possèdes cette carte"
              >
                <UIcon name="i-lucide-check" class="text-[10px]" />
              </div>
              <UButton
                icon="i-lucide-info"
                color="neutral"
                variant="solid"
                size="2xs"
                class="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition"
                @click.stop="openInfo(r.id)"
              />
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- zones du deck -->
    <div class="flex flex-col h-full">
      <div class="flex items-center gap-2 mb-4 shrink-0">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="router.push('/decks')"
        />
        <div>
          <h2 class="font-medium">{{ deck?.name ?? 'Deck' }}</h2>
          <p class="text-xs text-muted">{{ totalCards }} cartes</p>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto space-y-5">
        <DeckBoard
          label="Main Deck"
          :cards="contents.main"
          :min="40"
          :max="60"
          show-max
          @remove="(c) => removeCard(c, 'main')"
          @info="(c) => openInfo(c.cardId)"
        />
        <DeckBoard
          label="Extra Deck"
          :cards="contents.extra"
          :min="0"
          :max="15"
          show-max
          @remove="(c) => removeCard(c, 'extra')"
          @info="(c) => openInfo(c.cardId)"
        />
        <DeckBoard
          label="Side Deck"
          :cards="contents.side"
          :min="0"
          :max="15"
          show-max
          @remove="(c) => removeCard(c, 'side')"
          @info="(c) => openInfo(c.cardId)"
        />
      </div>
    </div>

    <CardDetail
      v-model:open="detailOpen"
      game="ygo"
      :card-id="detailCardId"
      @added="refreshOwned"
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
  type Deck,
  type DeckContents,
  type DeckCard,
} from '~/services/decks'
import type { Board } from '~/services/deck/types'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const deckId = computed(() => route.params.id as string)

const deck = ref<Deck | null>(null)
const contents = ref<DeckContents>({ main: [], extra: [], side: [] })
const ownedIds = ref<Set<string>>(new Set())

const query = ref('')
const results = ref<CardSearchResult[]>([])
const searching = ref(false)

const detailOpen = ref(false)
const detailCardId = ref<string | null>(null)

const totalCards = computed(() =>
  [...contents.value.main, ...contents.value.extra, ...contents.value.side].reduce(
    (s, c) => s + c.quantity,
    0
  )
)

async function loadDeck() {
  deck.value = await getDeck(deckId.value)
  if (!deck.value) {
    toast.add({ title: 'Deck introuvable', color: 'error' })
    router.push('/decks')
    return
  }
  await refreshContents()
}

async function refreshContents() {
  contents.value = await getDeckContents(deckId.value, 'ygo')
}

async function refreshOwned() {
  ownedIds.value = await ownedCardIds('ygo')
  await refreshContents()
}

// recherche debouncée
watchDebounced(
  query,
  async () => {
    if (!query.value.trim()) {
      results.value = []
      return
    }
    searching.value = true
    try {
      results.value = await searchCards('ygo', { query: query.value, field: 'name', limit: 30 })
    } finally {
      searching.value = false
    }
  },
  { debounce: 300 }
)

async function addCard(r: CardSearchResult) {
  // on a besoin du type pour le placement auto → on le récupère via la recherche
  // (le type n'est pas dans CardSearchResult ; on le lit à l'ajout côté service
  //  qui interroge ygo_details — mais ici addCardToDeck attend le type.)
  const type = await fetchType(r.id)
  const ok = await addCardToDeck(deckId.value, 'ygo', r.id, type)
  if (!ok) {
    toast.add({ title: 'Limite de 3 exemplaires atteinte', color: 'warning' })
    return
  }
  await refreshContents()
}

async function removeCard(c: DeckCard, board: Board) {
  await removeCardFromDeck(deckId.value, c.cardId, board)
  await refreshContents()
}

function openInfo(cardId: string) {
  detailCardId.value = cardId
  detailOpen.value = true
}

// récupère le type d'une carte (pour le placement auto)
async function fetchType(cardId: string): Promise<string | null> {
  const { ygo } = await useDatabase()
  const rows = await ygo.select<{ type: string | null }[]>(
    `SELECT type FROM ygo_details WHERE card_id = ?`,
    [cardId]
  )
  return rows[0]?.type ?? null
}

onMounted(async () => {
  ownedIds.value = await ownedCardIds('ygo')
  await loadDeck()
})
</script>
