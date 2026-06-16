<template>
  <img v-if="src" :src="src" class="w-full h-full object-cover" :alt="alt" />
  <USkeleton v-else class="w-full h-full" />
</template>

<script setup lang="ts">
const props = defineProps<{
  passcode: string
  name?: string // when provided, used as the alt text (accessibility + test targeting)
}>()

const { src } = useCardImage(() => props.passcode, 'small')

// prefer the real card name for the alt; fall back to the passcode
const alt = computed(() => props.name ?? `art ${props.passcode}`)
</script>
