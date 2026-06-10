<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <p class="text-xs text-muted uppercase tracking-wide">Filtres</p>
      <UButton
        v-if="hasActiveFilters"
        label="Réinitialiser"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="reset"
      />
    </div>

    <UAccordion :items="sections" type="multiple" :default-value="['type', 'stats']">
      <template #type-body>
        <div class="space-y-3 pb-2">
          <div>
            <p class="text-sm text-muted mb-1">Catégorie</p>
            <USelect
              v-model="local.category"
              :items="categoryItems"
              placeholder="Toutes"
              size="sm"
              class="w-full"
            />
          </div>

          <div v-if="options.monsterTypes.length">
            <p class="text-sm text-muted mb-1">Types de monstre</p>
            <div class="flex flex-wrap gap-1.5">
              <UCheckbox
                v-for="t in options.monsterTypes"
                :key="t"
                :model-value="local.monsterTypes?.includes(t)"
                :label="t"
                size="sm"
                @update:model-value="toggle('monsterTypes', t)"
              />
            </div>
          </div>

          <div v-if="options.spellTrapTypes.length">
            <p class="text-sm text-muted mb-1">Types magie/piège</p>
            <div class="flex flex-wrap gap-1.5">
              <UCheckbox
                v-for="t in options.spellTrapTypes"
                :key="t"
                :model-value="local.spellTrapTypes?.includes(t)"
                :label="t"
                size="sm"
                @update:model-value="toggle('spellTrapTypes', t)"
              />
            </div>
          </div>
        </div>
      </template>

      <template #props-body>
        <div class="space-y-3 pb-2">
          <div>
            <p class="text-sm text-muted mb-1">Attribut</p>
            <USelect
              v-model="local.attribute"
              :items="options.attributes"
              placeholder="Tous"
              size="sm"
              class="w-full"
            />
          </div>
          <div>
            <p class="text-sm text-muted mb-1">Race / Type</p>
            <USelect
              v-model="local.race"
              :items="options.races"
              placeholder="Toutes"
              size="sm"
              class="w-full"
            />
          </div>
          <div>
            <p class="text-sm text-muted mb-1">Archétype</p>
            <USelect
              v-model="local.archetype"
              :items="options.archetypes"
              placeholder="Tous"
              size="sm"
              class="w-full"
              searchable
            />
          </div>
          <div>
            <p class="text-sm text-muted mb-1">Banlist (TCG)</p>
            <USelect
              v-model="local.banlist"
              :items="BANLIST"
              placeholder="Toutes"
              size="sm"
              class="w-full"
            />
          </div>
        </div>
      </template>

      <template #stats-body>
        <div class="space-y-2 pb-2">
          <NumericFilterInput label="Niveau" v-model="local.level" />
          <NumericFilterInput label="ATK" v-model="local.atk" />
          <NumericFilterInput label="DEF" v-model="local.def" />
          <NumericFilterInput label="Scale" v-model="local.scale" />
          <NumericFilterInput label="Link" v-model="local.linkRating" />
        </div>
      </template>
    </UAccordion>
  </div>
</template>

<script setup lang="ts">
import type { YgoFilters } from '~/services/search'
import type { YgoFilterOptions } from '~/services/search'

const props = defineProps<{
  modelValue: YgoFilters
  options: YgoFilterOptions
}>()

const emit = defineEmits<{ 'update:modelValue': [value: YgoFilters] }>()

// copie locale modifiable, synchronisée vers le parent
const local = reactive<YgoFilters>({ ...props.modelValue })

watch(local, () => emit('update:modelValue', { ...local }), { deep: true })

const categoryItems = ['Monster', 'Spell', 'Trap']
const BANLIST = ['Forbidden', 'Limited', 'Semi-Limited']

const sections = [
  { label: 'Type', value: 'type', slot: 'type' },
  { label: 'Propriétés', value: 'props', slot: 'props' },
  { label: 'Statistiques', value: 'stats', slot: 'stats' },
]

// coche/décoche une valeur dans un filtre tableau (monsterTypes, spellTrapTypes)
function toggle(key: 'monsterTypes' | 'spellTrapTypes', value: string) {
  const arr = local[key] ? [...local[key]!] : []
  const i = arr.indexOf(value)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(value)
  local[key] = arr.length ? arr : undefined
}

const hasActiveFilters = computed(() =>
  Object.values(local).some((v) => (Array.isArray(v) ? v.length > 0 : v != null))
)

function reset() {
  for (const key of Object.keys(local) as (keyof YgoFilters)[]) {
    delete local[key]
  }
}
</script>
