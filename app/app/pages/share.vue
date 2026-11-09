<template>
  <AppPage sidebar-label="Share" title="Share" :mobile-sidebar="false">
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

      <p class="text-xs text-muted uppercase tracking-wide mt-6 mb-2">Received collections</p>
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
      <p v-else class="text-xs text-dimmed italic px-3">None yet</p>
    </template>

    <div class="h-full overflow-y-auto" :class="isMobile && 'pb-6'">
      <!-- MOBILE : les deux sections en bascule (remplace la sidebar) -->
      <div
        v-if="isMobile && active !== 'view'"
        class="grid grid-cols-2 p-1 mb-4 rounded-xl bg-elevated border border-default"
      >
        <button
          v-for="s in mobileSections"
          :key="s.id"
          :data-mobile-share-section="s.id"
          class="h-9 rounded-lg text-sm font-semibold transition"
          :class="active === s.id ? 'bg-primary text-inverted' : 'text-muted'"
          @click="openSection(s.id)"
        >
          {{ s.label }}
        </button>
      </div>
      <UButton
        v-if="isMobile && active === 'view'"
        icon="i-lucide-arrow-left"
        label="Received collections"
        color="neutral"
        variant="ghost"
        class="mb-2 -ml-2"
        @click="openSection('receive')"
      />

      <!-- ── Partager ma collection ── -->
      <div v-if="active === 'mine'" class="space-y-5 max-w-md">
        <div>
          <h2 v-if="!isMobile" class="text-lg font-medium">Share my collection</h2>
          <p class="text-xs text-muted">
            The other player scans the QR code (or pastes the code) to see your cards and the ones
            you offer for trade.
          </p>
        </div>

        <div class="space-y-1">
          <p class="text-sm font-medium">Your name</p>
          <UInput
            id="share-owner-input"
            v-model="ownerName"
            placeholder="Shown to the other player"
            :class="isMobile ? 'w-full' : 'w-64'"
            :size="isMobile ? 'lg' : 'sm'"
          />
        </div>

        <label class="flex items-center gap-2 text-sm">
          <USwitch id="share-only-trade" v-model="onlyTrade" size="sm" />
          Only cards for trade
        </label>

        <UButton
          id="share-generate-btn"
          label="Create share"
          icon="i-lucide-qr-code"
          :loading="generating"
          :block="isMobile"
          :size="isMobile ? 'xl' : 'md'"
          @click="generate"
        />

        <div v-if="myCode" class="space-y-3">
          <p class="text-xs text-muted" :data-share-card-count="myCardCount">
            {{ myCardCount }} distinct card(s) · {{ myCode.length }} characters
          </p>
          <div
            v-if="qrFrames.length"
            id="share-qr"
            :data-qr-frames="qrFrames.length"
            class="space-y-1"
            :class="isMobile && 'flex flex-col items-center text-center'"
          >
            <img
              :src="qrFrames[qrIndex]"
              alt="Share QR code"
              class="max-w-full rounded-xl bg-white p-2"
              :class="isMobile ? 'w-full' : 'w-72'"
            />
            <p v-if="qrFrames.length > 1" class="text-xs text-muted">
              Animated QR: frame {{ qrIndex + 1 }} / {{ qrFrames.length }}. The other device keeps
              scanning until the end.
            </p>
          </div>
          <p class="text-xs text-muted">Far away? Copy the code and send it in a message.</p>
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
            label="Copy code"
            icon="i-lucide-copy"
            color="neutral"
            variant="soft"
            :size="isMobile ? 'xl' : 'sm'"
            :block="isMobile"
            @click="copyCode"
          />
        </div>
      </div>

      <!-- ── Recevoir ── -->
      <div v-else-if="active === 'receive'" class="space-y-5 max-w-md">
        <div>
          <h2 v-if="!isMobile" class="text-lg font-medium">View a player's collection</h2>
          <p class="text-xs text-muted">
            Scan their QR code or paste the code they sent you. The collection is saved so you can
            see it again.
          </p>
        </div>

        <UButton
          v-if="canScan"
          id="share-scan-btn"
          label="Scan a QR code"
          icon="i-lucide-scan-line"
          :block="isMobile"
          :size="isMobile ? 'xl' : 'md'"
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
            label="Open"
            icon="i-lucide-folder-open"
            :disabled="!importText.trim()"
            :loading="importing"
            :block="isMobile"
            :size="isMobile ? 'lg' : 'md'"
            @click="importCode(importText)"
          />
        </div>

        <!-- MOBILE : collections déjà reçues (dans la sidebar sur desktop) -->
        <div v-if="isMobile" class="space-y-2">
          <p class="text-xs font-semibold text-muted uppercase tracking-wide">
            Received collections
          </p>
          <p v-if="!saved.length" class="text-sm text-dimmed italic">None yet</p>
          <button
            v-for="sv in saved"
            :key="sv.id"
            :data-saved-share-id="sv.id"
            class="w-full flex items-center gap-3 p-3 rounded-xl bg-elevated border border-default text-left"
            @click="openSaved(sv.id)"
          >
            <span
              class="size-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0"
            >
              <UIcon name="i-lucide-user" class="size-5" />
            </span>
            <span class="flex-1 min-w-0 font-semibold truncate">{{ sv.owner || 'No name' }}</span>
            <span class="text-sm text-muted">{{ sv.cardCount }} cards</span>
            <UIcon name="i-lucide-chevron-right" class="text-muted" />
          </button>
        </div>
      </div>

      <!-- ── Collection reçue ── -->
      <div v-else-if="active === 'view' && viewing" id="shared-view" class="space-y-4">
        <div class="flex items-start gap-3">
          <div class="flex-1">
            <h2 class="text-lg font-medium">{{ viewing.owner || 'No name' }}'s collection</h2>
            <p class="text-xs text-muted">
              Shared on {{ formatDate(viewing.createdAt) }} · {{ viewCards.length }} distinct
              card(s) · {{ tradeTotal }} for trade
            </p>
          </div>
          <UButton
            id="shared-delete-btn"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="sm"
            aria-label="Delete this collection"
            @click="removeSaved"
          />
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <UInput
            id="shared-search"
            v-model="viewFilters.search"
            icon="i-lucide-search"
            placeholder="Search by name"
            size="sm"
            class="w-56"
          />
          <label class="flex items-center gap-2 text-sm">
            <USwitch id="shared-only-trade" v-model="viewFilters.onlyTrade" size="sm" />
            For trade
          </label>
          <label class="flex items-center gap-2 text-sm">
            <USwitch id="shared-only-missing" v-model="viewFilters.onlyMissing" size="sm" />
            Missing from mine
          </label>
        </div>

        <div
          v-if="!filteredCards.length"
          class="flex flex-col items-center py-16 text-muted text-center"
        >
          <UIcon name="i-lucide-inbox" class="text-4xl mb-3" />
          <p>No matching cards</p>
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
const { isMobile } = useResponsive()

const sections = [
  { id: 'mine', label: 'Share my collection', icon: 'i-lucide-qr-code' },
  { id: 'receive', label: 'View a collection', icon: 'i-lucide-scan-line' },
]
const mobileSections = [
  { id: 'mine', label: 'Show mine' },
  { id: 'receive', label: 'Receive' },
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
    toast.add({ title: 'Could not create the share', color: 'error' })
  } finally {
    generating.value = false
  }
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(myCode.value)
    toast.add({ title: 'Code copied', icon: 'i-lucide-check', color: 'success' })
  } catch {
    toast.add({ title: 'Could not copy: select the code by hand', color: 'warning' })
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
      title: unsupported ? 'Code made by a newer version of the app' : 'Invalid code',
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
