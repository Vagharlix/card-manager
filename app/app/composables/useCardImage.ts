import { convertFileSrc } from '@tauri-apps/api/core'

type CardImageSize = 'full' | 'small' | 'cropped'

// ============================================================
// IMAGES DE CARTES — adresse servie par le protocole `cardimg` de Rust
// (image_cache.rs) : lue dans le cache disque, ou téléchargée puis mise en
// cache. Aucun appel JS → Rust : le navigateur ne charge que les images
// visibles (loading="lazy") et les garde en mémoire.
// Forme : cardimg://localhost/<jeu>%2F<taille>%2F<id> (Linux, macOS),
// http://cardimg.localhost/… (Android, Windows) — convertFileSrc choisit.
// ============================================================
export function cardImageUrl(game: string, id: string, size: CardImageSize = 'small'): string {
  return convertFileSrc(`${game}/${size}/${id}`, 'cardimg')
}

// image d'une carte ; jeu = celui affiché sauf indication contraire
export function useCardImage(
  passcode: MaybeRefOrGetter<string | number>,
  size: CardImageSize = 'small',
  game?: MaybeRefOrGetter<string>
) {
  const current = useCurrentGame().game
  const src = computed(() => {
    const id = String(toValue(passcode) ?? '')
    return id ? cardImageUrl(toValue(game) || current.value, id, size) : ''
  })
  return { src }
}
