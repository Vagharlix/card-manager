<template>
  <!-- sélecteur de jeu : n'apparaît qu'avec plusieurs jeux -->
  <USelect
    v-if="multiGame"
    id="game-picker"
    :data-current-game="game"
    :model-value="game"
    :items="items"
    :size="size"
    :class="compact ? 'min-w-0' : 'min-w-36'"
    aria-label="Game"
    @update:model-value="onPick"
  >
    <template #item="{ item }">
      <span :data-select-value="item.value">{{ item.label }}</span>
    </template>
  </USelect>
</template>

<script setup lang="ts">
// compact : libellés courts (« YGO », « MTG »), pour les petits écrans
const props = withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg'; compact?: boolean }>(), {
  size: 'sm',
  compact: false,
})

const { game, games, multiGame, setGame } = useCurrentGame()
const items = computed(() =>
  games.value.map((g) => ({ label: props.compact ? g.shortLabel : g.label, value: g.id }))
)
const onPick = (v: string) => setGame(v)
</script>
