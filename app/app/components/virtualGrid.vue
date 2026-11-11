<template>
  <!-- conteneur qui défile : seules les lignes visibles (+ une marge) sont
       dessinées, la hauteur totale est réservée pour la barre de défilement -->
  <div ref="scrollEl" class="overflow-y-auto">
    <div class="relative w-full" :style="{ height: `${virtualizer.getTotalSize()}px` }">
      <div
        v-for="row in virtualizer.getVirtualItems()"
        :key="row.key as number"
        :ref="measure"
        :data-index="row.index"
        class="absolute top-0 left-0 w-full grid"
        :style="{
          transform: `translateY(${row.start}px)`,
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          columnGap: `${gap}px`,
          paddingBottom: `${gap}px`,
        }"
      >
        <template v-for="(item, i) in rowItems(row.index)" :key="itemKey(item, row.index * cols + i)">
          <slot :item="item" :index="row.index * cols + i" />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts" generic="T">
import { useVirtualizer } from '@tanstack/vue-virtual'
import { breakpointsTailwind, useBreakpoints, useElementSize } from '@vueuse/core'

// ============================================================
// Grille (ou liste : une colonne) virtualisée. Une collection de 2000
// cartes ne dessine qu'une soixantaine de vignettes : ouverture et
// défilement fluides, mémoire contenue sur téléphone.
// Colonnes selon la largeur de la fenêtre, comme les classes Tailwind
// qu'elle remplace (ex. grid-cols-3 sm:grid-cols-4 … xl:grid-cols-8).
// ============================================================

type Columns = Partial<Record<'base' | 'sm' | 'md' | 'lg' | 'xl' | '2xl', number>>

const props = withDefaults(
  defineProps<{
    items: T[]
    itemKey: (item: T, index: number) => string | number
    columns?: Columns
    gap?: number // px, entre colonnes et entre lignes
    // hauteur estimée d'une ligne pour une largeur de colonne donnée
    // (corrigée par la mesure réelle) : par défaut une carte (0.686) + le gap
    estimate?: (colWidth: number) => number
    overscan?: number // lignes dessinées en plus au-dessus et au-dessous
  }>(),
  {
    columns: () => ({ base: 1 }),
    gap: 12,
    estimate: undefined,
    overscan: 3,
  }
)

const bp = useBreakpoints(breakpointsTailwind)
const cols = computed(() => {
  const c = props.columns
  const order = ['2xl', 'xl', 'lg', 'md', 'sm'] as const
  for (const name of order) {
    const n = c[name]
    if (n && bp.greaterOrEqual(name).value) return n
  }
  return c.base ?? 1
})

const scrollEl = ref<HTMLElement | null>(null)
const { width } = useElementSize(scrollEl)

const rowCount = computed(() => Math.ceil(props.items.length / cols.value))
function rowItems(row: number): T[] {
  return props.items.slice(row * cols.value, (row + 1) * cols.value)
}

function estimateRow(): number {
  const w = width.value || 600
  const colWidth = (w - (cols.value - 1) * props.gap) / cols.value
  return props.estimate ? props.estimate(colWidth) : colWidth / 0.686 + props.gap
}

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rowCount.value,
    getScrollElement: () => scrollEl.value,
    estimateSize: estimateRow,
    overscan: props.overscan,
  }))
)

// mesure réelle de chaque ligne dessinée (nom sous la carte, badges…)
function measure(el: unknown) {
  if (el instanceof Element) virtualizer.value.measureElement(el)
}

// largeur ou colonnes changées : les hauteurs mesurées ne valent plus
watch([width, cols], () => virtualizer.value.measure())

defineExpose({
  scrollToTop: () => virtualizer.value.scrollToOffset(0),
})
</script>
