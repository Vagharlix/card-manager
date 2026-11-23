<template>
  <div class="space-y-2" data-rb-filters>
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

    <UAccordion :items="sections" type="multiple" :default-value="['domains', 'type']">
      <template #domains-body>
        <div class="flex flex-wrap gap-1.5 pb-2">
          <UButton
            v-for="d in DOMAIN_ITEMS"
            :key="d"
            :data-rb-domain="d"
            :label="d"
            size="xs"
            class="rounded-full"
            color="neutral"
            :variant="selected(d) ? 'solid' : 'outline'"
            @click="toggleDomain(d)"
          />
        </div>
      </template>

      <template #type-body>
        <div class="space-y-3 pb-2">
          <div class="flex flex-wrap gap-1.5">
            <UCheckbox
              v-for="t in RB_TYPES"
              :key="t"
              :model-value="local.types?.includes(t)"
              :label="t"
              size="sm"
              :data-rb-type="t"
              @update:model-value="toggleType(t)"
            />
          </div>
          <div>
            <p class="text-sm text-muted mb-1">Kind</p>
            <USelect
              id="rb-supertype-filter"
              v-model="local.supertype"
              :items="supertypeItems"
              placeholder="Any"
              size="sm"
              class="w-full"
            >
              <template #item="{ item }">
                <span :data-select-value="item.value">{{ item.label }}</span>
              </template>
            </USelect>
          </div>
          <NumericFilterInput v-model="local.energy" label="Energy" />
          <NumericFilterInput v-model="local.might" label="Might" />
        </div>
      </template>

      <template #set-body>
        <div class="space-y-3 pb-2">
          <div>
            <p class="text-sm text-muted mb-1">Set</p>
            <USelect
              id="rb-set-filter"
              v-model="local.set"
              :items="setItems"
              placeholder="Any set"
              size="sm"
              class="w-full"
            >
              <template #item="{ item }">
                <span :data-select-value="item.value">{{ item.label }}</span>
              </template>
            </USelect>
          </div>
          <div>
            <p class="text-sm text-muted mb-1">Legal in</p>
            <USelect
              id="rb-format-filter"
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
import { RB_SUPERTYPES, riftboundSets, type RiftboundFilters } from '~/services/search/riftbound'
import { RB_DOMAINS, RB_TYPES } from '~/services/riftboundData/import'
import { riftboundDeckEngine } from '~/services/deck/riftbound'

// ============================================================
// Filtres de recherche Riftbound (panneau branché par utils/gameUi.ts).
// ============================================================

const props = defineProps<{ modelValue: RiftboundFilters }>()
const emit = defineEmits<{ 'update:modelValue': [value: RiftboundFilters] }>()

const local = reactive<RiftboundFilters>({ ...props.modelValue })
watch(local, () => emit('update:modelValue', { ...local }), { deep: true })

const DOMAIN_ITEMS = [...RB_DOMAINS, 'Colorless']
const sections = [
  { label: 'Domains', value: 'domains', slot: 'domains' },
  { label: 'Type & stats', value: 'type', slot: 'type' },
  { label: 'Set & legality', value: 'set', slot: 'set' },
]
const supertypeItems = RB_SUPERTYPES.map((s) => ({ label: s, value: s }))
const formatItems = riftboundDeckEngine.rules.formats
  .filter((f) => f.id !== 'casual')
  .map((f) => ({ label: f.label, value: f.id }))
const setItems = ref<{ label: string; value: string }[]>([])
onMounted(async () => {
  setItems.value = (await riftboundSets().catch(() => [])).map((s) => ({
    label: `${s.name} (${s.code.toUpperCase()})`,
    value: s.code,
  }))
})

function selected(d: string): boolean {
  return d === 'Colorless' ? !!local.colorless : !!local.domains?.includes(d)
}

function toggleDomain(d: string) {
  if (d === 'Colorless') {
    local.colorless = local.colorless ? undefined : true
    return
  }
  const list = new Set(local.domains ?? [])
  if (list.has(d)) list.delete(d)
  else list.add(d)
  local.domains = list.size ? [...list] : undefined
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
  for (const key of Object.keys(local) as (keyof RiftboundFilters)[]) delete local[key]
}
</script>
