<template>
  <!-- au lancement, avec plusieurs jeux et sans jeu favori : lequel ouvrir ? -->
  <UModal :open="askAtLaunch" title="Which game?" :dismissible="false" :close="false">
    <template #body>
      <div class="space-y-3" data-game-launch>
        <UButton
          v-for="g in games"
          :key="g.id"
          :data-game-choice="g.id"
          :label="g.label"
          color="neutral"
          variant="soft"
          size="lg"
          block
          @click="choose(g.id)"
        />
        <UCheckbox id="game-launch-remember" v-model="remember" label="Always open this game" />
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
const { games, askAtLaunch, setGame } = useCurrentGame()
const { setFavoriteGame } = useSettings()
const remember = ref(false)

async function choose(id: string) {
  setGame(id)
  if (remember.value) await setFavoriteGame(id)
}
</script>
