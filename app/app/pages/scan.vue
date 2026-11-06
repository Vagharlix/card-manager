<template>
  <!-- ANDROID : caméra plein écran, réglages par-dessus, cartes ajoutées en bas -->
  <div v-if="android" id="scan-view" class="relative h-full bg-black text-white overflow-hidden">
    <video ref="videoEl" class="absolute inset-0 w-full h-full object-cover" playsinline muted />

    <!-- cadre de visée -->
    <div
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
        aria-label="Fermer le scan"
        @click="close"
      />
      <div class="flex-1" />
      <label
        class="h-11 px-3 rounded-full bg-black/50 flex items-center gap-2 text-sm font-semibold"
      >
        <USwitch id="scan-auto-add" v-model="autoAdd" />
        Ajout auto
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
          {{ current.name }}<span v-if="current.printingId"> · {{ current.printingId }}</span>
        </template>
        <template v-else>Place une carte dans le cadre</template>
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
        caméra : {{ camera.active() ? 'active' : 'inactive' }} · images : {{ debug.frames }} · OCR :
        {{ debug.lastMs }} ms · {{ debug.size }}
      </p>
      <p>résultat : {{ debug.result || '—' }}</p>
      <p v-if="debug.error" class="text-error">erreur : {{ debug.error }}</p>
      <p v-for="(l, i) in debug.lines" :key="i" class="truncate">« {{ l }} »</p>
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
          Ajoutées : {{ session.length }}
        </h2>
        <UButton
          v-if="!autoAdd"
          id="scan-add-btn"
          label="Ajouter"
          icon="i-lucide-plus"
          size="lg"
          :disabled="!pending"
          @click="addPending"
        />
        <UButton label="Terminer" variant="ghost" size="lg" @click="close" />
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto space-y-1.5">
        <p v-if="!session.length" class="text-sm text-muted py-2">
          Les cartes reconnues s'ajoutent ici, et à ta collection.
        </p>
        <div
          v-for="item in session"
          :key="item.entryId"
          :data-scan-entry="item.cardId"
          class="flex items-center gap-3 p-2 rounded-xl bg-elevated"
        >
          <div class="w-9 shrink-0 rounded overflow-hidden">
            <ArtThumb :passcode="item.cardId" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold truncate">{{ item.name }}</p>
            <p class="text-xs text-muted">{{ item.printingId ?? 'impression non détectée' }}</p>
          </div>
          <UButton
            :data-scan-undo="item.entryId"
            icon="i-lucide-undo-2"
            color="neutral"
            variant="ghost"
            size="lg"
            aria-label="Annuler l'ajout"
            @click="undo(item.entryId)"
          />
        </div>
      </div>
    </section>
  </div>

  <!-- AILLEURS (desktop, tests) : pas de caméra, mais la même chaîne de reconnaissance -->
  <AppPage v-else title="Scanner">
    <div id="scan-view" class="h-full flex flex-col gap-3 overflow-hidden max-w-md mx-auto w-full">
      <UAlert
        color="neutral"
        variant="soft"
        icon="i-lucide-smartphone"
        title="Le scan de cartes est disponible dans l'app Android"
      />
      <p class="text-sm" :data-scan-current="current?.cardId ?? ''">
        {{ current ? current.name : '' }}
      </p>
      <div class="flex items-center gap-3 shrink-0">
        <label class="flex items-center gap-2 text-sm flex-1">
          <USwitch id="scan-auto-add" v-model="autoAdd" size="sm" />
          Ajout automatique
        </label>
        <UButton
          v-if="!autoAdd"
          id="scan-add-btn"
          label="Ajouter"
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
          Ajoutées pendant ce scan : {{ session.length }}
        </p>
        <div class="space-y-1">
          <div
            v-for="item in session"
            :key="item.entryId"
            :data-scan-entry="item.cardId"
            class="flex items-center gap-3 p-2 rounded-lg bg-elevated"
          >
            <div class="w-8 shrink-0 rounded overflow-hidden">
              <ArtThumb :passcode="item.cardId" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm truncate">{{ item.name }}</p>
              <p class="text-xs text-muted">{{ item.printingId ?? 'impression non détectée' }}</p>
            </div>
            <UButton
              :data-scan-undo="item.entryId"
              icon="i-lucide-undo-2"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="Annuler l'ajout"
              @click="undo(item.entryId)"
            />
          </div>
        </div>
      </div>
    </div>
  </AppPage>
</template>

<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { addCard, removeCard } from '~/services/collection'
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
const router = useRouter()

function close() {
  if (window.history.length > 1) router.back()
  else router.push('/collection')
}
const toast = useToast()

const videoEl = ref<HTMLVideoElement | null>(null)
const camera = useRearCamera(videoEl)
const ocrError = ref('')

const autoAdd = ref(true)
const current = ref<Identified | null>(null) // lu sur l'image courante
const pending = ref<Identified | null>(null) // stable, en attente (mode manuel)

interface SessionItem {
  entryId: string
  cardId: string
  printingId: string | null
  name: string
}
const session = ref<SessionItem[]>([])
let stabilizer = new ScanStabilizer<Identified>()

async function add(card: Identified) {
  try {
    const entryId = await addCard({
      game: GAME,
      cardId: card.cardId,
      printingId: card.printingId,
    })
    session.value.unshift({ entryId, ...card })
    vibrate()
  } catch {
    toast.add({ title: "Échec de l'ajout", color: 'error' })
  }
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
    // haute résolution : le code d'impression est petit sur la carte
    const ctx = camera.grab(canvas, 1600)
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
    ocrError.value = 'Reconnaissance de texte indisponible'
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
  delete (window as unknown as { __scanFeed?: unknown }).__scanFeed
})
</script>
