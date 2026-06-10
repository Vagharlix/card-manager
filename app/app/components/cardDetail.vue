<template>
  <USlideover
    :open="open"
    :side="isMobile ? 'bottom' : 'right'"
    :title="detail?.name ?? 'Carte'"
    @update:open="$emit('update:open', $event)"
  >
    <template #body>
      <div v-if="loading" class="space-y-4">
        <USkeleton class="w-full aspect-[0.686] rounded-lg" />
        <USkeleton class="h-4 w-3/4" />
        <USkeleton class="h-4 w-1/2" />
      </div>

      <div v-else-if="detail" class="space-y-5">
        <!-- image en grand -->
        <div class="rounded-lg overflow-hidden ring-1 ring-default max-w-xs mx-auto">
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
          <span :class="owned > 0 ? 'text-success font-medium' : 'text-muted'">
            {{ owned }} dans ta collection
          </span>
        </div>

        <!-- ── ajout ── -->
        <div class="space-y-2">
          <div class="flex gap-2">
            <UButton
              block
              icon="i-lucide-plus"
              label="Ajouter"
              :loading="adding"
              class="flex-1"
              @click="quickAdd"
            />
            <UButton
              icon="i-lucide-sliders-horizontal"
              color="neutral"
              variant="soft"
              aria-label="Ajout détaillé"
              @click="showDetailedForm = !showDetailedForm"
            />
          </div>

          <!-- formulaire détaillé inline -->
          <div v-if="showDetailedForm" class="rounded-lg border border-default p-3 space-y-3">
            <div class="grid grid-cols-2 gap-2">
              <div>
                <p class="text-xs text-muted mb-1">Quantité</p>
                <UInput v-model.number="form.quantity" type="number" min="1" size="sm" />
              </div>
              <div>
                <p class="text-xs text-muted mb-1">État</p>
                <USelect v-model="form.condition" :items="CONDITIONS" size="sm" />
              </div>
              <div>
                <p class="text-xs text-muted mb-1">Langue</p>
                <USelect v-model="form.language" :items="LANGUAGES" size="sm" />
              </div>
              <div>
                <p class="text-xs text-muted mb-1">Printing</p>
                <USelect
                  v-model="form.printingId"
                  :items="printingItems"
                  placeholder="Aucun"
                  size="sm"
                />
              </div>
            </div>
            <div class="flex gap-4">
              <UCheckbox v-model="form.foil" label="Foil" size="sm" />
              <UCheckbox v-model="form.altered" label="Altered" size="sm" />
              <UCheckbox v-model="form.signed" label="Signed" size="sm" />
            </div>
            <UButton
              block
              icon="i-lucide-check"
              label="Ajouter avec ces détails"
              :loading="adding"
              @click="detailedAdd"
            />
          </div>
        </div>

        <!-- stats -->
        <div class="space-y-1 text-sm">
          <div v-if="detail.type" class="flex justify-between">
            <span class="text-muted">Type</span><span>{{ detail.type }}</span>
          </div>
          <div v-if="detail.attribute" class="flex justify-between">
            <span class="text-muted">Attribut</span><span>{{ detail.attribute }}</span>
          </div>
          <div v-if="detail.race" class="flex justify-between">
            <span class="text-muted">Race</span><span>{{ detail.race }}</span>
          </div>
          <div v-if="detail.level != null" class="flex justify-between">
            <span class="text-muted">Niveau</span><span>{{ detail.level }}</span>
          </div>
          <div v-if="detail.rank != null" class="flex justify-between">
            <span class="text-muted">Rang</span><span>{{ detail.rank }}</span>
          </div>
          <div v-if="detail.linkValue != null" class="flex justify-between">
            <span class="text-muted">Link</span><span>{{ detail.linkValue }}</span>
          </div>
          <div v-if="detail.scale != null" class="flex justify-between">
            <span class="text-muted">Échelle Pendule</span><span>{{ detail.scale }}</span>
          </div>
          <div v-if="detail.atk != null" class="flex justify-between">
            <span class="text-muted">ATK</span><span>{{ detail.atk }}</span>
          </div>
          <div v-if="detail.def != null" class="flex justify-between">
            <span class="text-muted">DEF</span><span>{{ detail.def }}</span>
          </div>
          <div v-if="detail.archetype" class="flex justify-between">
            <span class="text-muted">Archétype</span><span>{{ detail.archetype }}</span>
          </div>
        </div>

        <!-- texte d'effet -->
        <div
          v-if="detail.legalText"
          class="text-sm border-t border-default pt-4 whitespace-pre-line"
        >
          {{ detail.legalText }}
        </div>

        <!-- banlist -->
        <div v-if="detail.banlistTcg" class="flex items-center gap-2 text-sm">
          <UBadge color="error" variant="soft">{{ detail.banlistTcg }} (TCG)</UBadge>
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
  </USlideover>
</template>

<script setup lang="ts">
import { getCardDetail, type YgoCardDetail } from '~/services/card/detail'
import { addCard, ownedQuantity, type CardCondition } from '~/services/collection'

const props = defineProps<{
  open: boolean
  game: string
  cardId: string | null
}>()

const emit = defineEmits<{ 'update:open': [value: boolean]; added: [] }>()

const { isMobile } = useResponsive()
const toast = useToast()

const detail = ref<YgoCardDetail | null>(null)
const loading = ref(false)
const activeArtId = ref<string>('')
const owned = ref(0)

const adding = ref(false)
const showDetailedForm = ref(false)

const CONDITIONS: CardCondition[] = ['NM', 'LP', 'MP', 'HP', 'DMG']
const LANGUAGES = ['en', 'fr', 'de', 'it', 'pt', 'es', 'ja', 'ko']

const form = reactive({
  quantity: 1,
  condition: 'NM' as CardCondition,
  language: 'en',
  printingId: undefined as string | undefined,
  foil: false,
  altered: false,
  signed: false,
})

// printings → items du select
const printingItems = computed(() =>
  (detail.value?.printings ?? []).map((p) => ({
    label: `${p.setCode} · ${p.rarity ?? '?'}`,
    value: p.id,
  }))
)

// charge le détail + le nombre possédé quand la carte change
watch(
  () => props.cardId,
  async (id) => {
    if (!id) return
    loading.value = true
    detail.value = null
    showDetailedForm.value = false
    try {
      detail.value = await getCardDetail(props.game, id)
      activeArtId.value = id
      owned.value = await ownedQuantity(props.game, id)
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)

// le nombre possédé suit l'artwork sélectionné
watch(activeArtId, async (id) => {
  if (id) owned.value = await ownedQuantity(props.game, id)
})

const bigImage = useCardImage(() => activeArtId.value, 'full')

// ── ajout rapide (valeurs par défaut depuis settings) ──
async function quickAdd() {
  adding.value = true
  try {
    await addCard({ game: props.game, cardId: activeArtId.value })
    owned.value = await ownedQuantity(props.game, activeArtId.value)
    toast.add({ title: 'Carte ajoutée', icon: 'i-lucide-check', color: 'success' })
    emit('added')
  } catch (e) {
    toast.add({ title: "Échec de l'ajout", color: 'error' })
  } finally {
    adding.value = false
  }
}

// ── ajout détaillé ──
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
    })
    owned.value = await ownedQuantity(props.game, activeArtId.value)
    showDetailedForm.value = false
    toast.add({ title: 'Carte ajoutée', icon: 'i-lucide-check', color: 'success' })
    emit('added')
  } catch (e) {
    toast.add({ title: "Échec de l'ajout", color: 'error' })
  } finally {
    adding.value = false
  }
}
</script>
