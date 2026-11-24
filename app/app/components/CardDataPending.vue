<template>
  <!-- 1re installation de la base de cartes du jeu, en arrière-plan : la
       recherche n'a encore rien à montrer, on dit pourquoi -->
  <div
    v-if="installing"
    data-card-data-pending
    class="flex flex-col items-center justify-center text-center gap-3 py-16 text-muted"
  >
    <UIcon name="i-lucide-download" class="text-3xl" />
    <p class="text-sm">Downloading the {{ label }} card database…</p>
    <UProgress :model-value="syncProgress" size="sm" class="w-56" />
    <p class="text-xs">{{ syncStatus }} · {{ syncProgress }}%</p>
  </div>
</template>

<script setup lang="ts">
import { syncFirstInstall, syncingGame, syncProgress, syncStatus } from '~/services/cardData'
import { gameDefOrNull } from '~/services/game'

const props = defineProps<{ game: string }>()
const installing = computed(() => syncFirstInstall.value && syncingGame.value === props.game)
const label = computed(() => gameDefOrNull(props.game)?.label ?? '')
</script>
