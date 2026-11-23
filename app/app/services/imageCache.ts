import { invoke } from '@tauri-apps/api/core'

// ============================================================
// IMAGE CACHE — pilotage du cache disque des images de cartes
// (commandes Rust de src-tauri/src/image_cache.rs). Les images elles-mêmes
// passent par le protocole cardimg (useCardImage) : une image supprimée du
// disque est simplement retéléchargée à sa prochaine demande.
// ============================================================

export async function imageCacheSize(): Promise<number> {
  return invoke<number>('image_cache_size')
}

export async function clearImageCache(): Promise<void> {
  await invoke('clear_image_cache')
}

// ramène le cache sous la limite ; retourne les octets libérés
export async function pruneImageCache(limitMb: number): Promise<number> {
  return invoke<number>('prune_image_cache', { limitMb })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
