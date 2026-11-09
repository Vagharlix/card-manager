<template>
  <UModal
    :open="open"
    fullscreen
    title="Scan a shared collection"
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
            Point at the other device's QR code. If it keeps changing, keep it in view until the
            end.
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
// Scanner QR continu (caméra arrière, useRearCamera) : décode les
// images en boucle et réassemble un QR animé (FrameAssembler).
// ============================================================

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; code: [code: string] }>()

const videoEl = ref<HTMLVideoElement | null>(null)
const camera = useRearCamera(videoEl)
const error = camera.error
const got = ref(0)
const total = ref(0)

let timer: ReturnType<typeof setTimeout> | null = null
let assembler = new FrameAssembler()
const canvas = document.createElement('canvas')

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }

function decodeFrame(): string | null {
  const ctx = camera.grab(canvas, 800)
  if (!ctx || !canvas.width) return null
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null
}

async function start() {
  got.value = 0
  total.value = 0
  assembler = new FrameAssembler()
  if (!(await camera.start())) return
  const video = videoEl.value!

  // BarcodeDetector (natif, rapide) si dispo, sinon jsQR
  const BD = (window as unknown as { BarcodeDetector?: new (o: object) => Detector })
    .BarcodeDetector
  const detector = BD ? new BD({ formats: ['qr_code'] }) : null

  const tick = async () => {
    if (!camera.active()) return
    let text: string | null = null
    try {
      if (detector) text = (await detector.detect(video))[0]?.rawValue ?? null
      else text = decodeFrame()
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
  camera.stop()
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
