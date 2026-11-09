<template>
  <div class="space-y-2" data-mtg-filters>
    <div class="flex items-center justify-between">
      <p class="text-xs text-muted uppercase tracking-wide">Filters</p>
      <UButton
        v-if="hasActiveFilters"
        label="Reset"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="reset"
      />
    </div>

    <UAccordion :items="sections" type="multiple" :default-value="['colors', 'type']">
      <template #colors-body>
        <div class="flex flex-wrap gap-1.5 pb-2">
          <UButton
            v-for="c in COLORS"
            :key="c.id"
            :data-mtg-color="c.id"
            :label="c.label"
            size="xs"
            class="rounded-full"
            color="neutral"
            :variant="selected(c.id) ? 'solid' : 'outline'"
            @click="toggleColor(c.id)"
          />
        </div>
      </template>

      <template #type-body>
        <div class="space-y-3 pb-2">
          <div class="flex flex-wrap gap-1.5">
            <UCheckbox
              v-for="t in MTG_TYPES"
              :key="t"
              :model-value="local.types?.includes(t)"
              :label="t"
              size="sm"
              @update:model-value="toggleType(t)"
            />
          </div>
          <NumericFilterInput v-model="local.cmc" label="MV" />
          <div>
            <p class="text-sm text-muted mb-1">Legal in</p>
            <USelect
              id="mtg-format-filter"
              v-model="local.format"
              :items="formatItems"
              placeholder="Any format"
              size="sm"
              class="w-full"
            >
              <template #item="{ item }">
                <span :data-select-value="item.value">{{ item.label }}</span>
              </template>
            </USelect>
          </div>
        </div>
      </template>
    </UAccordion>
  </div>
</template>

<script setup lang="ts">
import { MTG_TYPES, type MtgFilters } from '~/services/search/mtg'
import { mtgDeckEngine } from '~/services/deck/mtg'

// ============================================================
// Filtres de recherche Magic (panneau branché par utils/gameUi.ts).
// ============================================================

const props = defineProps<{ modelValue: MtgFilters }>()
const emit = defineEmits<{ 'update:modelValue': [value: MtgFilters] }>()

const local = reactive<MtgFilters>({ ...props.modelValue })
watch(local, () => emit('update:modelValue', { ...local }), { deep: true })

const COLORS = [
  { id: 'W', label: 'White' },
  { id: 'U', label: 'Blue' },
  { id: 'B', label: 'Black' },
  { id: 'R', label: 'Red' },
  { id: 'G', label: 'Green' },
  { id: 'C', label: 'Colorless' },
]
const sections = [
  { label: 'Colors', value: 'colors', slot: 'colors' },
  { label: 'Type & legality', value: 'type', slot: 'type' },
]
const formatItems = mtgDeckEngine.rules.formats
  .filter((f) => f.id !== 'casual')
  .map((f) => ({ label: f.label, value: f.id }))

function selected(id: string): boolean {
  return id === 'C' ? !!local.colorless : !!local.colors?.includes(id)
}

function toggleColor(id: string) {
  if (id === 'C') {
    local.colorless = local.colorless ? undefined : true
    return
  }
  const list = new Set(local.colors ?? [])
  if (list.has(id)) list.delete(id)
  else list.add(id)
  local.colors = list.size ? [...list] : undefined
}

function toggleType(t: string) {
  const list = new Set(local.types ?? [])
  if (list.has(t)) list.delete(t)
  else list.add(t)
  local.types = list.size ? [...list] : undefined
}

const hasActiveFilters = computed(() =>
  Object.values(local).some((v) => (Array.isArray(v) ? v.length > 0 : v != null))
)

function reset() {
  for (const key of Object.keys(local) as (keyof MtgFilters)[]) delete local[key]
}
</script>
