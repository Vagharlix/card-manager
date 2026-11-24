<template>
  <!-- case positionnée : une image paysage (champ de bataille) y est tournée
       pour la remplir (useCardFit) ; fond neutre tant que l'image n'est pas
       arrivée (pas d'animation : une par vignette redessinerait la liste) -->
  <div class="relative w-full h-full overflow-hidden">
    <img
      v-if="src"
      :src="src"
      class="w-full h-full object-cover bg-elevated"
      :class="imgClass"
      :style="fit.style.value"
      :alt="alt"
      loading="lazy"
      decoding="async"
      @load="fit.onLoad"
    />
    <USkeleton v-else class="w-full h-full" />
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    passcode: string
    name?: string // when provided, used as the alt text (accessibility + test targeting)
    game?: string // jeu de la carte (par défaut : le jeu affiché)
    // tourner une carte imprimée dans l'autre sens que la case (défaut : oui) ;
    // non pour un recadrage voulu (couverture d'un deck)
    rotate?: boolean
    imgClass?: string // classes de l'image elle-même (ex. object-top)
  }>(),
  { name: undefined, game: undefined, rotate: true, imgClass: undefined }
)

const { src } = useCardImage(
  () => props.passcode,
  'small',
  () => props.game ?? ''
)
const fit = useCardFit(src, () => props.rotate)

// prefer the real card name for the alt; fall back to the passcode
const alt = computed(() => props.name ?? `art ${props.passcode}`)
</script>
