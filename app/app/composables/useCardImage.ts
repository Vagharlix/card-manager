import { invoke, convertFileSrc } from '@tauri-apps/api/core'

type CardImageSize = 'full' | 'small' | 'cropped'

const resolved = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()

// à appeler quand des fichiers du cache disque ont été supprimés
export function forgetCachedImages(): void {
  resolved.clear()
}

async function resolveImage(passcode: string, size: CardImageSize): Promise<string> {
  const path = await invoke<string>('cache_card_image', { passcode, size })
  return convertFileSrc(path)
}

export function useCardImage(
  passcode: MaybeRefOrGetter<string | number>,
  size: CardImageSize = 'small'
) {
  const src = ref('')
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    const code = String(toValue(passcode))
    if (!code) return

    const key = `${size}/${code}`
    loading.value = true
    error.value = false

    if (resolved.has(key)) {
      src.value = resolved.get(key)!
      loading.value = false
      return
    }

    if (!inflight.has(key)) {
      inflight.set(key, resolveImage(code, size))
    }

    try {
      const url = await inflight.get(key)!
      resolved.set(key, url)
      src.value = url
    } catch {
      error.value = true
    } finally {
      loading.value = false
      inflight.delete(key)
    }
  }

  watch(() => toValue(passcode), load, { immediate: true })

  return { src, loading, error }
}
