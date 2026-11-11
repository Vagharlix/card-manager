<template>
  <!-- fond neutre tant que l'image n'est pas arrivée (pas d'animation :
       une par vignette redessinerait la liste en continu) -->
  <img
    v-if="src"
    :src="src"
    class="w-full h-full object-cover bg-elevated"
    :alt="alt"
    loading="lazy"
    decoding="async"
  />
  <USkeleton v-else class="w-full h-full" />
</template>

<script setup lang="ts">
const props = defineProps<{
  passcode: string
  name?: string // when provided, used as the alt text (accessibility + test targeting)
  game?: string // jeu de la carte (par défaut : le jeu affiché)
}>()

const { src } = useCardImage(
  () => props.passcode,
  'small',
  () => props.game ?? ''
)

// prefer the real card name for the alt; fall back to the passcode
const alt = computed(() => props.name ?? `art ${props.passcode}`)
</script>
