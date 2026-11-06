<template>
  <div
    :data-scan-entry="item.cardId"
    :data-scan-language="item.language ?? ''"
    :data-scan-rarity="item.rarity ?? ''"
    :data-scan-first-edition="item.firstEdition ? 'true' : 'false'"
    class="p-2 bg-elevated"
    :class="large ? 'rounded-xl' : 'rounded-lg'"
  >
    <div class="flex items-center gap-3">
      <div class="shrink-0 rounded overflow-hidden" :class="large ? 'w-9' : 'w-8'">
        <ArtThumb :passcode="item.cardId" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-sm truncate" :class="large && 'font-semibold'">{{ item.name }}</p>
        <p class="text-xs text-muted">
          {{ item.printingId ?? 'impression non détectée'
          }}<template v-if="item.language"> · {{ languageLabel }}</template>
        </p>
      </div>
      <UButton
        :data-scan-undo="item.entryId"
        icon="i-lucide-undo-2"
        color="neutral"
        variant="ghost"
        :size="large ? 'lg' : 'xs'"
        aria-label="Annuler l'ajout"
        @click="$emit('undo')"
      />
    </div>

    <!-- précisions que la caméra ne peut pas toujours lire : modifiables d'un geste -->
    <div class="flex flex-wrap items-center gap-2 mt-2" :class="large ? 'pl-12' : 'pl-11'">
      <UButton
        data-scan-first-edition-toggle
        :variant="item.firstEdition ? 'solid' : 'outline'"
        color="neutral"
        size="xs"
        class="rounded-full"
        label="1re édition"
        :icon="item.firstEdition ? 'i-lucide-check' : undefined"
        @click="$emit('first-edition', !item.firstEdition)"
      />
      <USelect
        v-if="item.rarities.length > 1"
        :model-value="item.rarity ?? undefined"
        :items="rarityItems"
        placeholder="Rareté ?"
        size="xs"
        class="min-w-32"
        :color="item.rarity ? 'neutral' : 'warning'"
        data-scan-rarity-select
        @update:model-value="onRarity"
      >
        <template #item="{ item: opt }">
          <span :data-select-value="(opt as any).value">{{ (opt as any).label }}</span>
        </template>
      </USelect>
      <UBadge
        v-else-if="item.rarity"
        :label="item.rarity"
        color="neutral"
        variant="outline"
        size="sm"
      />
    </div>
  </div>
</template>

<script lang="ts">
export interface ScanSessionEntry {
  entryId: string
  cardId: string
  printingId: string | null
  name: string
  language: string | null
  firstEdition: boolean
  rarity: string | null
  rarities: string[] // raretés possibles de l'impression lue
}
</script>

<script setup lang="ts">
const props = defineProps<{
  item: ScanSessionEntry
  languageLabel?: string
  large?: boolean
}>()

const emit = defineEmits<{
  undo: []
  rarity: [value: string]
  'first-edition': [value: boolean]
}>()

const rarityItems = computed(() => props.item.rarities.map((r) => ({ label: r, value: r })))

function onRarity(v: unknown) {
  if (typeof v === 'string') emit('rarity', v)
}
</script>
