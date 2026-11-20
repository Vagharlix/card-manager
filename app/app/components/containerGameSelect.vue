<template>
  <!-- jeux d'un rangement (facultatif, plusieurs possibles) : n'apparaît
       qu'avec plusieurs jeux -->
  <div v-if="multiGame">
    <p class="text-sm text-muted mb-1.5">Games</p>
    <div class="flex flex-wrap gap-2">
      <UButton
        v-for="g in games"
        :key="g.id"
        :data-container-game-option="g.id"
        :data-selected="modelValue.includes(g.id) || undefined"
        :label="g.label"
        :icon="modelValue.includes(g.id) ? 'i-lucide-check' : undefined"
        :variant="modelValue.includes(g.id) ? 'solid' : 'outline'"
        color="neutral"
        size="sm"
        class="rounded-full"
        @click="toggle(g.id)"
      />
    </div>
    <p class="text-xs text-dimmed mt-1">
      {{
        modelValue.length
          ? 'Only shown and offered in the selected games.'
          : 'No game selected: shown in every game.'
      }}
    </p>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ modelValue: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const { games, multiGame } = useCurrentGame()

function toggle(id: string) {
  const next = props.modelValue.includes(id)
    ? props.modelValue.filter((g) => g !== id)
    : [...props.modelValue, id]
  emit('update:modelValue', next)
}
</script>
