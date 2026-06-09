<template>
  <img v-if="src" :src="src" class="w-full h-full object-cover" :alt="`art ${passcode}`" />
  <USkeleton v-else class="w-full h-full" />
</template>

<script setup lang="ts">
const props = defineProps<{ passcode: string }>()
const { src } = useCardImage(() => props.passcode, 'small')
</script>
