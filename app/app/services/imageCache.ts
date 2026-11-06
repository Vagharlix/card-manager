import { invoke } from '@tauri-apps/api/core'
import { forgetCachedImages } from '~/composables/useCardImage'

// ============================================================
// IMAGE CACHE — pilotage du cache disque des images de cartes
// (commandes Rust de src-tauri/src/image_cache.rs).
// Après une suppression de fichiers, on oublie aussi les URLs déjà
// résolues en mémoire, sinon les vignettes pointeraient vers le vide.
// ============================================================

export async function imageCacheSize(): Promise<number> {
  return invoke<number>('image_cache_size')
}

export async function clearImageCache(): Promise<void> {
  await invoke('clear_image_cache')
  forgetCachedImages()
}

// ramène le cache sous la limite ; retourne les octets libérés
export async function pruneImageCache(limitMb: number): Promise<number> {
  const freed = await invoke<number>('prune_image_cache', { limitMb })
  if (freed > 0) forgetCachedImages()
  return freed
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}
