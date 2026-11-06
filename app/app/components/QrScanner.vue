<template>
  <UModal
    :open="open"
    fullscreen
    title="Scanner le partage"
    @update:open="(v: boolean) => !v && close()"
  >
    <template #body>
      <div class="flex flex-col items-center gap-4 h-full">
        <div class="relative w-full max-w-md aspect-square rounded-xl overflow-hidden bg-black">
          <video ref="videoEl" class="w-full h-full object-cover" playsinline muted />
          <div class="absolute inset-8 border-2 border-white/70 rounded-lg pointer-events-none" />
        </div>

        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          icon="i-lucide-camera-off"
          :title="error"
          class="max-w-md"
        />
        <template v-else>
          <p class="text-sm text-muted text-center max-w-md">
            Vise le QR code de l'autre appareil. S'il change en boucle, garde-le dans le cadre
            jusqu'à la fin.
          </p>
          <div v-if="total > 1" class="w-full max-w-md space-y-1" :data-scan-progress="got">
            <UProgress :model-value="got" :max="total" />
            <p class="text-xs text-muted text-center">{{ got }} / {{ total }} images</p>
          </div>
        </template>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import jsQR from 'jsqr'
import { FrameAssembler } from '~/services/share'

// ============================================================
// Scanner QR continu dans la WebView (caméra arrière) : décode les
// images en boucle et réassemble un QR animé (FrameAssembler).
// Sur Android, la permission caméra passe par le plugin
// barcode-scanner (il déclare CAMERA dans le manifeste).
// ============================================================

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; code: [code: string] }>()

const videoEl = ref<HTMLVideoElement | null>(null)
const error = ref('')
const got = ref(0)
const total = ref(0)

let stream: MediaStream | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let assembler = new FrameAssembler()
const canvas = document.createElement('canvas')

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }

async function ensurePermission(): Promise<boolean> {
  try {
    const { checkPermissions, requestPermissions } =
      await import('@tauri-apps/plugin-barcode-scanner')
    if ((await checkPermissions()) === 'granted') return true
    return (await requestPermissions()) === 'granted'
  } catch {
    return true // plateforme sans le plugin : getUserMedia demandera lui-même
  }
}

function decodeFrame(video: HTMLVideoElement): string | null {
  const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight))
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx || !canvas.width) return null
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null
}

async function start() {
  error.value = ''
  got.value = 0
  total.value = 0
  assembler = new FrameAssembler()
  if (!(await ensurePermission())) {
    error.value = 'Accès à la caméra refusé'
    return
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      audio: false,
    })
  } catch {
    error.value = 'Caméra indisponible'
    return
  }
  const video = videoEl.value
  if (!video) return stop()
  video.srcObject = stream
  await video.play().catch(() => {})

  // BarcodeDetector (natif, rapide) si dispo, sinon jsQR
  const BD = (window as unknown as { BarcodeDetector?: new (o: object) => Detector })
    .BarcodeDetector
  const detector = BD ? new BD({ formats: ['qr_code'] }) : null

  const tick = async () => {
    if (!stream) return
    let text: string | null = null
    try {
      if (detector) text = (await detector.detect(video))[0]?.rawValue ?? null
      else text = decodeFrame(video)
    } catch {
      text = null
    }
    if (text) {
      const r = assembler.add(text)
      if (r.status === 'complete') {
        emit('code', r.code)
        close()
        return
      }
      if (r.status === 'progress') {
        got.value = r.got
        total.value = r.total
      }
    }
    timer = setTimeout(tick, 100)
  }
  tick()
}

function stop() {
  if (timer) clearTimeout(timer)
  timer = null
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
}

function close() {
  stop()
  emit('update:open', false)
}

watch(
  () => props.open,
  async (o) => {
    if (o) {
      await nextTick()
      start()
    } else stop()
  }
)
onBeforeUnmount(stop)
</script>
