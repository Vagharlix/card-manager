<template>
  <!-- ANDROID : caméra plein écran, réglages par-dessus, cartes ajoutées en bas -->
  <div v-if="android" id="scan-view" class="relative h-full bg-black text-white overflow-hidden">
    <video ref="videoEl" class="absolute inset-0 w-full h-full object-cover" playsinline muted />

    <!-- cadre de visée (l'OCR ne lit que cette zone, avec une marge) -->
    <div
      ref="frameEl"
      class="absolute left-1/2 -translate-x-1/2 w-[64%] aspect-[0.686] rounded-2xl border-[3px] pointer-events-none transition-colors shadow-[0_0_0_200vmax_rgba(0,0,0,0.35)]"
      :class="current ? 'border-success' : 'border-white/70'"
      :style="{ top: 'calc(var(--safe-top) + 5rem)' }"
    />

    <!-- barre du haut -->
    <div
      class="absolute inset-x-0 top-0 px-4 flex items-center gap-2"
      :style="{ paddingTop: 'calc(var(--safe-top) + 0.75rem)' }"
    >
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="soft"
        size="xl"
        class="rounded-full bg-black/50 text-white"
        aria-label="Close scanner"
        @click="close"
      />
      <div class="flex-1" />
      <label
        class="h-11 px-3 rounded-full bg-black/50 flex items-center gap-2 text-sm font-semibold"
      >
        <USwitch id="scan-auto-add" v-model="autoAdd" />
        Auto add
      </label>
      <UButton
        icon="i-lucide-bug"
        color="neutral"
        variant="soft"
        size="xl"
        class="rounded-full text-white"
        :class="showDebug ? 'bg-primary/70' : 'bg-black/50'"
        aria-label="Diagnostic"
        @click="toggleDebug"
      />
    </div>

    <!-- carte lue -->
    <div
      class="absolute inset-x-4 flex justify-center pointer-events-none"
      :style="{ top: 'calc(var(--safe-top) + 5rem + 64vw / 0.686 + 1rem)' }"
    >
      <div
        class="px-4 py-2 rounded-full text-sm font-semibold max-w-full truncate"
        :class="current ? 'bg-success text-black' : 'bg-black/60 text-white'"
        :data-scan-current="current?.cardId ?? ''"
      >
        <template v-if="current">
          {{ current.name }}<span v-if="current.printingId"> · {{ current.printingId }}</span
          ><span v-if="current.language"> · {{ languageLabel(current.language) }}</span
          ><span v-if="current.firstEdition"> · 1st ed.</span>
        </template>
        <template v-else>Place a card in the frame</template>
      </div>
    </div>

    <!-- diagnostic : ce que voit réellement le scan (pour comprendre un échec) -->
    <div
      v-if="showDebug"
      id="scan-debug"
      class="absolute inset-x-4 rounded-lg bg-black/80 p-2 text-[11px] font-mono space-y-0.5 max-h-48 overflow-y-auto"
      :style="{ top: 'calc(var(--safe-top) + 4.5rem)' }"
    >
      <p>
        camera: {{ camera.active() ? 'on' : 'off' }} · frames: {{ debug.frames }} · OCR:
        {{ debug.lastMs }} ms · {{ debug.size }}
      </p>
      <p>result: {{ debug.result || '—' }}</p>
      <p v-if="debug.error" class="text-error">error: {{ debug.error }}</p>
      <p v-for="(l, i) in debug.lines" :key="i" class="truncate">“{{ l }}”</p>
    </div>

    <!-- panneau du bas : erreurs, ajout manuel, cartes ajoutées -->
    <section
      class="absolute inset-x-0 bottom-0 max-h-[38%] flex flex-col rounded-t-3xl bg-default text-default px-4 pt-3"
      :style="{ paddingBottom: 'calc(var(--safe-bottom) + 0.75rem)' }"
    >
      <div class="mx-auto w-10 h-1.5 rounded-full bg-accented mb-3 shrink-0" />
      <UAlert
        v-if="camera.error.value || ocrError"
        color="error"
        variant="soft"
        icon="i-lucide-camera-off"
        :title="camera.error.value || ocrError"
        class="mb-2 shrink-0"
      />
      <div class="flex items-center gap-2 mb-2 shrink-0">
        <h2 class="flex-1 text-lg font-bold" :data-scan-count="session.length">
          Added: {{ session.length }}
        </h2>
        <UButton
          v-if="!autoAdd"
          id="scan-add-btn"
          label="Add"
          icon="i-lucide-plus"
          size="lg"
          :disabled="!pending"
          @click="addPending"
        />
        <UButton label="Done" variant="ghost" size="lg" @click="close" />
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto space-y-1.5">
        <p v-if="!session.length" class="text-sm text-muted py-2">
          Recognized cards show up here and in your collection.
        </p>
        <ScanSessionItem
          v-for="item in session"
          :key="item.entryId"
          :item="item"
          :language-label="item.language ? languageLabel(item.language) : undefined"
          large
          @undo="undo(item.entryId)"
          @rarity="(r) => setRarity(item, r)"
          @first-edition="(v) => setFirstEdition(item, v)"
        />
      </div>
    </section>
  </div>

  <!-- AILLEURS (desktop, tests) : pas de caméra, mais la même chaîne de reconnaissance -->
  <AppPage v-else title="Scan">
    <div id="scan-view" class="h-full flex flex-col gap-3 overflow-hidden max-w-md mx-auto w-full">
      <UAlert
        color="neutral"
        variant="soft"
        icon="i-lucide-smartphone"
        title="Card scanning is available in the Android app"
      />
      <p class="text-sm" :data-scan-current="current?.cardId ?? ''">
        {{ current ? current.name : '' }}
      </p>
      <div class="flex items-center gap-3 shrink-0">
        <label class="flex items-center gap-2 text-sm flex-1">
          <USwitch id="scan-auto-add" v-model="autoAdd" size="sm" />
          Auto add
        </label>
        <UButton
          v-if="!autoAdd"
          id="scan-add-btn"
          label="Add"
          icon="i-lucide-plus"
          size="sm"
          :disabled="!pending"
          @click="addPending"
        />
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <p
          class="text-xs text-muted uppercase tracking-wide mb-2"
          :data-scan-count="session.length"
        >
          Added in this session: {{ session.length }}
        </p>
        <div class="space-y-1">
          <ScanSessionItem
            v-for="item in session"
            :key="item.entryId"
            :item="item"
            :language-label="item.language ? languageLabel(item.language) : undefined"
            @undo="undo(item.entryId)"
            @rarity="(r) => setRarity(item, r)"
            @first-edition="(v) => setFirstEdition(item, v)"
          />
        </div>
      </div>
    </div>
  </AppPage>
</template>

<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { addCard, removeCard, updateCard } from '~/services/collection'
import { printingRarities } from '~/services/card/detail'
import type { ScanSessionEntry } from '~/components/ScanSessionItem.vue'
import { gameDef } from '~/services/game'
import { identifyCard, ScanStabilizer, type Identified, type OcrLine } from '~/services/scan'

// ============================================================
// Scan de cartes (Android) : caméra → ML Kit (plugin card-scanner)
// → identification (code d'impression, sinon nom) → stabilisation
// sur 2 images → ajout à la collection. Une carte n'est ré-ajoutée
// qu'après avoir quitté l'image (plusieurs exemplaires à la suite).
// ============================================================

definePageMeta({ fullscreen: true }) // mobile : ni onglets ni marge du haut

const GAME = 'ygo'
const android = isAndroid()
const languages = gameDef(GAME).languages
function languageLabel(id: string) {
  return languages.find((l) => l.id === id)?.label ?? id
}
const router = useRouter()

function close() {
  if (window.history.length > 1) router.back()
  else router.push('/collection')
}
const toast = useToast()

const videoEl = ref<HTMLVideoElement | null>(null)
const frameEl = ref<HTMLElement | null>(null)
const camera = useRearCamera(videoEl)
const ocrError = ref('')

const autoAdd = ref(true)
const current = ref<Identified | null>(null) // lu sur l'image courante
const pending = ref<Identified | null>(null) // stable, en attente (mode manuel)

const session = ref<ScanSessionEntry[]>([])
let stabilizer = new ScanStabilizer<Identified>()

// la mention « 1st Edition » est petite : elle n'est pas lue sur toutes les
// images. Une carte vue avec la mention sur une des dernières images la garde.
const RECENT = 4
let recentFirstEdition: (string | null)[] = []
function rememberFirstEdition(found: Identified | null) {
  recentFirstEdition.push(found?.firstEdition ? found.cardId : null)
  if (recentFirstEdition.length > RECENT) recentFirstEdition.shift()
}

async function add(card: Identified) {
  try {
    // un code d'impression peut exister en plusieurs raretés : s'il n'y en a
    // qu'une, elle est enregistrée ; sinon l'utilisateur choisit dans la liste
    const rarities = card.printingId ? await printingRarities(GAME, card.printingId) : []
    const rarity = rarities.length === 1 ? rarities[0]! : null
    const firstEdition = card.firstEdition || recentFirstEdition.includes(card.cardId)
    const entryId = await addCard({
      game: GAME,
      cardId: card.cardId,
      printingId: card.printingId,
      // langue lue dans le code d'impression, sinon la langue par défaut du jeu
      language: card.language ?? undefined,
      rarity,
      firstEdition,
    })
    session.value.unshift({
      entryId,
      cardId: card.cardId,
      printingId: card.printingId,
      name: card.name,
      language: card.language,
      firstEdition,
      rarity,
      rarities,
    })
    vibrate()
  } catch {
    toast.add({ title: 'Could not add the card', color: 'error' })
  }
}

async function setRarity(item: ScanSessionEntry, rarity: string) {
  await updateCard(item.entryId, { rarity })
  item.rarity = rarity
}

async function setFirstEdition(item: ScanSessionEntry, value: boolean) {
  await updateCard(item.entryId, { firstEdition: value })
  item.firstEdition = value
}

async function addPending() {
  if (!pending.value) return
  const card = pending.value
  pending.value = null
  await add(card)
}

async function undo(entryId: string) {
  await removeCard(entryId)
  session.value = session.value.filter((i) => i.entryId !== entryId)
}

// pipeline commun aux images réelles et au hook de test
async function processLines(lines: OcrLine[]) {
  const found = await identifyCard(GAME, lines)
  current.value = found
  rememberFirstEdition(found)
  debug.lines = lines.slice(0, 12).map((l) => l.text)
  debug.result = found ? `${found.name} (${found.via}, ${found.score.toFixed(2)})` : ''
  const stable = stabilizer.push(found)
  if (!stable) return
  if (autoAdd.value) await add(stable)
  else pending.value = stable
}

async function vibrate() {
  try {
    // commande Kotlin du plugin barcode-scanner (non exposée par son API JS)
    await invoke('plugin:barcode-scanner|vibrate')
  } catch {
    navigator.vibrate?.(50)
  }
}

// Zone du cadre de visée dans l'image de la caméra, en fractions. La vidéo
// est affichée en object-cover (agrandie puis rognée) : on refait le calcul
// inverse. Marge de 15 % : la carte n'est jamais parfaitement dans le cadre.
function frameCrop() {
  const v = videoEl.value
  const f = frameEl.value
  if (!v || !f || !v.videoWidth || !v.videoHeight) return undefined
  const vr = v.getBoundingClientRect()
  const fr = f.getBoundingClientRect()
  const scale = Math.max(vr.width / v.videoWidth, vr.height / v.videoHeight)
  const offX = (vr.width - v.videoWidth * scale) / 2
  const offY = (vr.height - v.videoHeight * scale) / 2
  const m = 0.15
  const toX = (px: number) => (px - vr.left - offX) / scale / v.videoWidth
  const toY = (py: number) => (py - vr.top - offY) / scale / v.videoHeight
  const x0 = Math.max(0, toX(fr.left - fr.width * m))
  const y0 = Math.max(0, toY(fr.top - fr.height * m))
  const x1 = Math.min(1, toX(fr.right + fr.width * m))
  const y1 = Math.min(1, toY(fr.bottom + fr.height * m))
  if (x1 - x0 < 0.1 || y1 - y0 < 0.1) return undefined
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

// ── boucle caméra → OCR ──
const canvas = document.createElement('canvas')
const showDebug = ref(false)
function toggleDebug() {
  showDebug.value = !showDebug.value
}
const debug = reactive({
  frames: 0,
  lastMs: 0,
  size: '',
  lines: [] as string[],
  result: '',
  error: '',
})
let timer: ReturnType<typeof setTimeout> | null = null
let running = false

async function tick() {
  if (!running) return
  try {
    // haute résolution sur la seule zone du cadre : le code d'impression et
    // la mention « 1st Edition » sont petits sur la carte
    const ctx = camera.grab(canvas, 1600, frameCrop())
    if (ctx) {
      const image = canvas.toDataURL('image/jpeg', 0.9).split(',')[1] ?? ''
      const t0 = performance.now()
      const res = await invoke<{ lines: OcrLine[] }>('plugin:card-scanner|recognize', { image })
      debug.lastMs = Math.round(performance.now() - t0)
      debug.frames++
      debug.size = `${canvas.width}×${canvas.height}`
      debug.error = ''
      ocrError.value = ''
      await processLines(res.lines)
    }
  } catch (e) {
    debug.error = e instanceof Error ? e.message : String(e)
    ocrError.value = 'Text recognition unavailable'
  }
  if (running) timer = setTimeout(tick, 250)
}

onMounted(async () => {
  if (import.meta.env.VITE_TEST_MODE === 'true') {
    ;(window as unknown as { __scanFeed?: (l: OcrLine[]) => Promise<void> }).__scanFeed =
      processLines
  }
  if (!android) return
  if (await camera.start()) {
    running = true
    tick()
  }
})

onBeforeUnmount(() => {
  running = false
  if (timer) clearTimeout(timer)
  camera.stop()
  stabilizer = new ScanStabilizer<Identified>()
  recentFirstEdition = []
  delete (window as unknown as { __scanFeed?: unknown }).__scanFeed
})
</script>
