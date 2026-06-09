<template>
  <div class="aspect-[0.7] rounded-md overflow-hidden bg-elevated border border-default">
    <USkeleton v-if="loading" class="w-full h-full" />
    <div v-else-if="error" class="w-full h-full flex items-center justify-center text-muted">
      <UIcon name="i-lucide-image-off" />
    </div>
    <img v-else :src="src" class="w-full h-full object-cover" :alt="`card ${passcode}`" />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ passcode: string }>()
const { src, loading, error } = useCardImage(() => props.passcode, 'small')
</script>
