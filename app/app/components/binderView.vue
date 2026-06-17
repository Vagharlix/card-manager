<template>
  <div class="flex flex-col h-full">
    <!-- navigation de page -->
    <div class="flex items-center justify-center gap-3 mb-4 shrink-0">
      <UButton
        id="binder-prev-page"
        icon="i-lucide-chevron-left"
        color="neutral"
        variant="soft"
        size="sm"
        :disabled="page <= 0"
        @click="page--"
      />
      <span class="text-sm" data-binder-page
        >Page {{ page + 1 }} / {{ Math.max(1, pageCount) }}</span
      >
      <UButton
        id="binder-next-page"
        icon="i-lucide-chevron-right"
        color="neutral"
        variant="soft"
        size="sm"
        :disabled="page >= pageCount - 1"
        @click="page++"
      />
    </div>

    <!-- grille de la page courante -->
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div
        class="grid gap-2 mx-auto max-w-2xl"
        :style="{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }"
      >
        <div
          v-for="cell in pageSlots"
          :key="`${cell.row}-${cell.col}`"
          class="binder-slot group relative aspect-[0.686] rounded-lg border-2 flex items-center justify-center transition"
          :data-slot-page="page"
          :data-slot-row="cell.row"
          :data-slot-col="cell.col"
          :data-slot-filled="cell.card ? 'true' : 'false'"
          :data-slot-card-id="cell.card ? cell.card.cardId : null"
          :class="
            cell.card
              ? 'border-solid border-default'
              : 'border-dashed border-default hover:border-primary cursor-pointer'
          "
          @click="!cell.card && $emit('add', { page, row: cell.row, col: cell.col })"
        >
          <template v-if="cell.card">
            <button class="w-full h-full" @click.stop="$emit('open', cell.card)">
              <ArtThumb
                :passcode="cell.card.cardId"
                class="w-full h-full object-cover rounded-md"
              />
            </button>
            <UButton
              :data-slot-clear="cell.card.cardId"
              icon="i-lucide-x"
              color="error"
              variant="solid"
              size="xs"
              class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition z-20"
              @click.stop="$emit('clear', cell.card)"
            />
          </template>
          <UIcon
            v-else
            name="i-lucide-plus"
            class="text-dimmed text-xl group-hover:text-primary transition"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BinderSlotCard } from '~/services/containers'

const props = defineProps<{
  slots: BinderSlotCard[]
  pageCount: number
  rowsPerPage: number
  colsPerPage: number
}>()

defineEmits<{
  open: [slot: BinderSlotCard]
  clear: [slot: BinderSlotCard]
  add: [pos: { page: number; row: number; col: number }]
}>()

const page = ref(0)
const cols = computed(() => props.colsPerPage)

const pageSlots = computed(() => {
  const bySlot = new Map(
    props.slots.filter((s) => s.page === page.value).map((s) => [`${s.row}:${s.col}`, s])
  )
  const cells: { row: number; col: number; card: BinderSlotCard | null }[] = []
  for (let row = 0; row < props.rowsPerPage; row++) {
    for (let col = 0; col < props.colsPerPage; col++) {
      cells.push({ row, col, card: bySlot.get(`${row}:${col}`) ?? null })
    }
  }
  return cells
})

watch(
  () => props.pageCount,
  (n) => {
    if (page.value > n - 1) page.value = Math.max(0, n - 1)
  }
)

// expose la page courante au parent si besoin (pour recharger au bon endroit)
defineExpose({ page })
</script>
