<template>
  <AppPage sidebar-label="Partage">
    <template #sidebar>
      <nav class="flex flex-col gap-1">
        <button
          v-for="s in sections"
          :key="s.id"
          :data-share-section="s.id"
          class="text-left px-3 py-2 rounded-md text-sm flex items-center gap-2"
          :class="active === s.id ? 'bg-elevated text-primary' : 'hover:bg-elevated'"
          @click="openSection(s.id)"
        >
          <UIcon :name="s.icon" />
          {{ s.label }}
        </button>
      </nav>

      <p class="text-xs text-muted uppercase tracking-wide mt-6 mb-2">Collections reçues</p>
      <div v-if="saved.length" class="space-y-0.5">
        <button
          v-for="s in saved"
          :key="s.id"
          :data-saved-share-id="s.id"
          class="w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2"
          :class="viewingId === s.id ? 'bg-elevated text-primary' : 'hover:bg-elevated'"
          @click="openSaved(s.id)"
        >
          <UIcon name="i-lucide-user" class="shrink-0" />
          <span class="flex-1 truncate">{{ s.owner }}</span>
          <span class="text-xs text-muted shrink-0">{{ s.cardCount }}</span>
        </button>
      </div>
      <p v-else class="text-xs text-dimmed italic px-3">Aucune pour l'instant</p>
    </template>

    <div class="h-full overflow-y-auto">
      <!-- ── Partager ma collection ── -->
      <div v-if="active === 'mine'" class="space-y-5 max-w-md">
        <div>
          <h2 class="text-lg font-medium">Partager ma collection</h2>
          <p class="text-xs text-muted">
            L'autre joueur scanne le QR code (ou colle le code) pour voir tes cartes et celles que
            tu proposes à l'échange.
          </p>
        </div>

        <div class="space-y-1">
          <p class="text-sm font-medium">Ton nom</p>
          <UInput
            id="share-owner-input"
            v-model="ownerName"
            placeholder="Affiché chez l'autre joueur"
            size="sm"
            class="w-64"
          />
        </div>

        <label class="flex items-center gap-2 text-sm">
          <USwitch id="share-only-trade" v-model="onlyTrade" size="sm" />
          Seulement les cartes à l'échange
        </label>

        <UButton
          id="share-generate-btn"
          label="Générer le partage"
          icon="i-lucide-qr-code"
          :loading="generating"
          @click="generate"
        />

        <div v-if="myCode" class="space-y-3">
          <p class="text-xs text-muted" :data-share-card-count="myCardCount">
            {{ myCardCount }} carte(s) différente(s) · {{ myCode.length }} caractères
          </p>
          <div
            v-if="qrFrames.length"
            id="share-qr"
            :data-qr-frames="qrFrames.length"
            class="space-y-1"
          >
            <img
              :src="qrFrames[qrIndex]"
              alt="QR code de partage"
              class="w-72 max-w-full rounded-lg bg-white p-2"
            />
            <p v-if="qrFrames.length > 1" class="text-xs text-muted">
              QR animé : image {{ qrIndex + 1 }} / {{ qrFrames.length }}. L'autre appareil le scanne
              en continu jusqu'à la fin.
            </p>
          </div>
          <p class="text-xs text-muted">À distance : copie le code et envoie-le par message.</p>
          <UTextarea
            id="share-code"
            :model-value="myCode"
            :data-share-code="myCode"
            readonly
            :rows="3"
            class="w-full font-mono text-xs"
          />
          <UButton
            id="share-copy-btn"
            label="Copier le code"
            icon="i-lucide-copy"
            color="neutral"
            variant="soft"
            size="sm"
            @click="copyCode"
          />
        </div>
      </div>

      <!-- ── Recevoir ── -->
      <div v-else-if="active === 'receive'" class="space-y-5 max-w-md">
        <div>
          <h2 class="text-lg font-medium">Voir la collection d'un joueur</h2>
          <p class="text-xs text-muted">
            Scanne son QR code ou colle le code qu'il t'a envoyé. La collection est enregistrée pour
            pouvoir la revoir.
          </p>
        </div>

        <UButton
          v-if="canScan"
          id="share-scan-btn"
          label="Scanner un QR code"
          icon="i-lucide-scan-line"
          @click="openScanner"
        />

        <div class="space-y-2">
          <UTextarea
            id="share-import-input"
            v-model="importText"
            placeholder="CMSHARE1:…"
            :rows="4"
            class="w-full font-mono text-xs"
          />
          <UButton
            id="share-import-btn"
            label="Ouvrir"
            icon="i-lucide-folder-open"
            :disabled="!importText.trim()"
            :loading="importing"
            @click="importCode(importText)"
          />
        </div>
      </div>

      <!-- ── Collection reçue ── -->
      <div v-else-if="active === 'view' && viewing" id="shared-view" class="space-y-4">
        <div class="flex items-start gap-3">
          <div class="flex-1">
            <h2 class="text-lg font-medium">Collection de {{ viewing.owner || 'Sans nom' }}</h2>
            <p class="text-xs text-muted">
              Partagée le {{ formatDate(viewing.createdAt) }} · {{ viewCards.length }} carte(s)
              différente(s) · {{ tradeTotal }} à l'échange
            </p>
          </div>
          <UButton
            id="shared-delete-btn"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="sm"
            aria-label="Supprimer cette collection"
            @click="removeSaved"
          />
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <UInput
            id="shared-search"
            v-model="viewFilters.search"
            icon="i-lucide-search"
            placeholder="Rechercher par nom"
            size="sm"
            class="w-56"
          />
          <label class="flex items-center gap-2 text-sm">
            <USwitch id="shared-only-trade" v-model="viewFilters.onlyTrade" size="sm" />
            À l'échange
          </label>
          <label class="flex items-center gap-2 text-sm">
            <USwitch id="shared-only-missing" v-model="viewFilters.onlyMissing" size="sm" />
            Qui me manquent
          </label>
        </div>

        <div
          v-if="!filteredCards.length"
          class="flex flex-col items-center py-16 text-muted text-center"
        >
          <UIcon name="i-lucide-inbox" class="text-4xl mb-3" />
          <p>Aucune carte ne correspond</p>
        </div>
        <div
          v-else
          class="grid gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
        >
          <div
            v-for="c in filteredCards"
            :key="c.rootId"
            :data-shared-card-id="c.displayId"
            :data-shared-qty="c.qty"
            :data-shared-trade="c.trade"
            :data-shared-mine="c.mine"
            class="shared-card relative"
          >
            <CardThumb
              :card="{ game: viewing.game, id: c.displayId, name: c.name, imageUrl: '' }"
              :quantity="c.qty"
              @select="openCard(c.displayId)"
            />
            <UBadge
              v-if="c.trade"
              icon="i-lucide-repeat"
              color="primary"
              variant="solid"
              size="sm"
              class="absolute bottom-1.5 left-1.5 z-20"
              :label="String(c.trade)"
            />
            <UBadge
              :color="c.mine ? 'success' : 'warning'"
              variant="solid"
              size="sm"
              class="absolute top-1.5 left-1.5 z-20"
              :icon="c.mine ? 'i-lucide-check' : 'i-lucide-circle-dashed'"
              :label="c.mine ? `×${c.mine}` : ''"
            />
          </div>
        </div>
      </div>
    </div>

    <CardDetail v-model:open="detailOpen" game="ygo" :card-id="detailCardId" />
    <QrScanner v-model:open="scannerOpen" @code="importCode" />
  </AppPage>
</template>

<script setup lang="ts">
import QRCode from 'qrcode'
import {
  shareCode,
  saveShare,
  listSavedShares,
  loadSavedShare,
  deleteSavedShare,
  resolveShare,
  decodeShare,
  toFrames,
  ShareCodeError,
  type SavedShare,
  type SharePayload,
  type SharedCardView,
} from '~/services/share'
import { getShareOwnerName, setShareOwnerName } from '~/services/settings'

const GAME = 'ygo'
const toast = useToast()

const sections = [
  { id: 'mine', label: 'Partager ma collection', icon: 'i-lucide-qr-code' },
  { id: 'receive', label: 'Voir une collection', icon: 'i-lucide-scan-line' },
]
const active = ref<'mine' | 'receive' | 'view'>('mine')
function openSection(id: string) {
  active.value = id as 'mine' | 'receive'
  viewingId.value = null
}

// ── partager ──
const ownerName = ref('')
const onlyTrade = ref(false)
const generating = ref(false)
const myCode = ref('')
const myCardCount = ref(0)

// QR animé : une image par morceau, affichées en boucle (4 par seconde)
const qrFrames = ref<string[]>([])
const qrIndex = ref(0)
let qrTimer: ReturnType<typeof setInterval> | null = null

function stopQrLoop() {
  if (qrTimer) clearInterval(qrTimer)
  qrTimer = null
}

async function buildQr(code: string) {
  stopQrLoop()
  qrIndex.value = 0
  qrFrames.value = await Promise.all(
    toFrames(code).map((f) =>
      QRCode.toDataURL(f, { errorCorrectionLevel: 'M', margin: 1, width: 640 })
    )
  )
  if (qrFrames.value.length > 1) {
    qrTimer = setInterval(() => {
      qrIndex.value = (qrIndex.value + 1) % qrFrames.value.length
    }, 250)
  }
}
onBeforeUnmount(stopQrLoop)

async function generate() {
  generating.value = true
  try {
    await setShareOwnerName(ownerName.value)
    myCode.value = await shareCode(GAME, { owner: ownerName.value, onlyTrade: onlyTrade.value })
    myCardCount.value = decodeShare(myCode.value).cards.length
    await buildQr(myCode.value)
  } catch {
    toast.add({ title: 'Échec de la génération du partage', color: 'error' })
  } finally {
    generating.value = false
  }
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(myCode.value)
    toast.add({ title: 'Code copié', icon: 'i-lucide-check', color: 'success' })
  } catch {
    toast.add({ title: 'Copie impossible : sélectionne le code à la main', color: 'warning' })
  }
}

// ── recevoir ──
const importText = ref('')
const importing = ref(false)
// le scan QR (caméra) n'existe que dans l'app mobile ; sur PC on colle le code
const canScan = isAndroid()
const scannerOpen = ref(false)
function openScanner() {
  scannerOpen.value = true
}

async function importCode(code: string) {
  importing.value = true
  try {
    const saved = await saveShare(code)
    importText.value = ''
    await refreshSaved()
    await openSaved(saved.id)
  } catch (e) {
    const unsupported = e instanceof ShareCodeError && e.message === 'UNSUPPORTED_VERSION'
    toast.add({
      title: unsupported ? 'Code créé par une version plus récente de l’app' : 'Code invalide',
      color: 'error',
    })
  } finally {
    importing.value = false
  }
}

// ── collections reçues ──
const saved = ref<SavedShare[]>([])
const viewingId = ref<string | null>(null)
const viewing = ref<SharePayload | null>(null)
const viewCards = ref<SharedCardView[]>([])
const viewFilters = reactive({ search: '', onlyTrade: false, onlyMissing: false })

async function refreshSaved() {
  saved.value = await listSavedShares()
}

async function openSaved(id: string) {
  const payload = await loadSavedShare(id)
  if (!payload) return
  viewingId.value = id
  viewing.value = payload
  viewCards.value = await resolveShare(payload)
  active.value = 'view'
}

async function removeSaved() {
  if (!viewingId.value) return
  await deleteSavedShare(viewingId.value)
  viewing.value = null
  await refreshSaved()
  openSection('receive')
}

const tradeTotal = computed(() => viewCards.value.reduce((s, c) => s + c.trade, 0))
const filteredCards = computed(() => {
  const q = viewFilters.search.trim().toLowerCase()
  return viewCards.value.filter(
    (c) =>
      (!q || c.name.toLowerCase().includes(q)) &&
      (!viewFilters.onlyTrade || c.trade > 0) &&
      (!viewFilters.onlyMissing || c.mine === 0)
  )
})

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString()
}

// ── fiche carte ──
const detailOpen = ref(false)
const detailCardId = ref<string | null>(null)
function openCard(id: string) {
  detailCardId.value = id
  detailOpen.value = true
}

onMounted(async () => {
  ownerName.value = await getShareOwnerName()
  await refreshSaved()
})
</script>
