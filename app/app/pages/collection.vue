<template>
  <AppPage>
    <div class="grid grid-cols-4 gap-4 max-w-2xl">
      <CardImageTest v-for="code in testCards" :key="code" :passcode="code" />
    </div>
  </AppPage>
</template>

<script setup lang="ts">
const testCards = [
  '46986414', // Dark Magician
  '89631139', // Blue-Eyes White Dragon
  '38033121', // Dark Magician Girl
  '44508094', // Kuriboh
]
</script>
