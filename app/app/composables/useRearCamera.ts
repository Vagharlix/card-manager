// ============================================================
// Caméra arrière dans la WebView (getUserMedia), partagée par le
// scan QR du partage et le scan OCR des cartes.
// Sur Android, la permission CAMERA passe par le plugin
// barcode-scanner (il la déclare dans le manifeste) ; wry accorde
// ensuite la capture vidéo à la WebView.
// ============================================================

export function useRearCamera(video: Ref<HTMLVideoElement | null>) {
  const error = ref('')
  let stream: MediaStream | null = null

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

  async function start(): Promise<boolean> {
    error.value = ''
    if (!(await ensurePermission())) {
      error.value = 'Accès à la caméra refusé'
      return false
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      })
    } catch {
      error.value = 'Caméra indisponible'
      return false
    }
    // mise au point continue (sinon image souvent floue dans la WebView) : best-effort
    const track = stream.getVideoTracks()[0]
    try {
      await track?.applyConstraints({
        advanced: [{ focusMode: 'continuous' } as unknown as MediaTrackConstraintSet],
      })
    } catch {
      // caméra sans réglage de mise au point
    }
    const el = video.value
    if (!el) {
      stop()
      return false
    }
    el.srcObject = stream
    await el.play().catch(() => {})
    return true
  }

  function stop() {
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
  }

  // image courante, recadrée (fractions de l'image) et réduite à maxSide px
  function grab(
    canvas: HTMLCanvasElement,
    maxSide: number,
    crop = { x: 0, y: 0, w: 1, h: 1 }
  ): CanvasRenderingContext2D | null {
    const el = video.value
    if (!el || !el.videoWidth) return null
    const sx = el.videoWidth * crop.x
    const sy = el.videoHeight * crop.y
    const sw = el.videoWidth * crop.w
    const sh = el.videoHeight * crop.h
    const scale = Math.min(1, maxSide / Math.max(sw, sh))
    canvas.width = Math.round(sw * scale)
    canvas.height = Math.round(sh * scale)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx?.drawImage(el, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    return ctx
  }

  onBeforeUnmount(stop)
  return { error, start, stop, grab, active: () => stream !== null }
}
