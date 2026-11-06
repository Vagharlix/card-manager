<template>
  <AppPage>
    <div id="scan-view" class="h-full flex flex-col gap-3 overflow-hidden">
      <!-- caméra + cadre de visée -->
      <div
        v-if="android"
        class="relative w-full max-w-md mx-auto aspect-[3/4] rounded-xl overflow-hidden bg-black shrink-0"
      >
        <video ref="videoEl" class="w-full h-full object-cover" playsinline muted />
        <div
          class="absolute inset-y-[8%] left-1/2 -translate-x-1/2 aspect-[0.686] border-2 rounded-lg pointer-events-none transition-colors"
          :class="current ? 'border-success' : 'border-white/70'"
        />
        <div
          class="absolute bottom-2 inset-x-2 rounded-md bg-black/60 px-3 py-1.5 text-sm text-white text-center"
          :data-scan-current="current?.cardId ?? ''"
        >
          <template v-if="current">
            {{ current.name }}
            <span v-if="current.printingId" class="text-white/70">· {{ current.printingId }}</span>
          </template>
          <template v-else>Place une carte dans le cadre…</template>
        </div>
      </div>
      <UAlert
        v-else
        color="neutral"
        variant="soft"
        icon="i-lucide-smartphone"
        title="Le scan de cartes est disponible dans l'app Android"
        class="max-w-md mx-auto w-full"
      />
      <UAlert
        v-if="camera.error.value || ocrError"
        color="error"
        variant="soft"
        icon="i-lucide-camera-off"
        :title="camera.error.value || ocrError"
        class="max-w-md mx-auto w-full"
      />

      <!-- réglages de la session -->
      <div class="flex items-center gap-3 max-w-md mx-auto w-full shrink-0">
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
        <label class="flex items-center gap-2 text-sm">
          <USwitch id="scan-debug-toggle" v-model="showDebug" size="sm" />
          Diagnostic
        </label>
      </div>

      <!-- diagnostic : ce que voit réellement le scan (pour comprendre un échec) -->
      <div
        v-if="showDebug"
        id="scan-debug"
        class="max-w-md mx-auto w-full shrink-0 rounded-lg border border-default p-2 text-xs font-mono space-y-1 max-h-48 overflow-y-auto"
      >
        <p>
          caméra : {{ camera.active() ? 'active' : 'inactive' }} · images analysées :
          {{ debug.frames }} · OCR : {{ debug.lastMs }} ms · image {{ debug.size }}
        </p>
        <p>résultat : {{ debug.result || '—' }}</p>
        <p v-if="debug.error" class="text-error">erreur : {{ debug.error }}</p>
        <p class="text-muted">texte lu ({{ debug.lines.length }} lignes) :</p>
        <p v-for="(l, i) in debug.lines" :key="i" class="truncate">« {{ l }} »</p>
      </div>

      <!-- cartes ajoutées pendant la session -->
      <div class="flex-1 min-h-0 overflow-y-auto max-w-md mx-auto w-full">
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
              <p class="text-xs text-muted">
                {{ item.printingId ?? 'impression non détectée' }}
              </p>
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

const GAME = 'ygo'
const android = isAndroid()
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
