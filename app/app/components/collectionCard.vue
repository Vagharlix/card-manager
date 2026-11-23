<template>
  <!-- grille -->
  <div
    v-if="view === 'grid'"
    :data-content-card-id="displayId"
    class="container-card group relative"
  >
    <CardThumb
      :card="card"
      :quantity="totalQty"
      :selectable="selectMode"
      :selected="selected"
      @select="$emit('open')"
      @toggle="$emit('toggle')"
    />
    <UBadge
      v-if="tradeQty"
      :data-trade-qty="tradeQty"
      icon="i-lucide-repeat"
      color="primary"
      variant="solid"
      size="sm"
      class="absolute bottom-1.5 left-1.5 z-20"
      :label="String(tradeQty)"
    />
    <UButton
      v-if="removable && !selectMode"
      :data-unassign="displayId"
      icon="i-lucide-folder-minus"
      color="error"
      variant="solid"
      size="xs"
      class="absolute top-1.5 right-1.5 transition z-30"
      :class="alwaysShowActions ? '' : 'opacity-0 group-hover:opacity-100 touch:opacity-100'"
      @click="$emit('unassign')"
    />
  </div>

  <!-- liste -->
  <div
    v-else
    :data-content-card-id="displayId"
    class="container-card group w-full flex items-center gap-3 p-2 rounded-lg hover:bg-elevated"
  >
    <button class="flex items-center gap-3 flex-1 text-left min-w-0" @click="$emit('open')">
      <div class="w-10 shrink-0 rounded overflow-hidden aspect-[0.686]">
        <ArtThumb :passcode="displayId" :game="game" />
      </div>
      <span class="flex-1 truncate">{{ name }}</span>
    </button>
    <UBadge
      v-if="tradeQty"
      :data-trade-qty="tradeQty"
      icon="i-lucide-repeat"
      color="primary"
      variant="soft"
      :label="`${tradeQty} for trade`"
    />
    <UBadge color="neutral" variant="soft">×{{ totalQty }}</UBadge>
    <UButton
      v-if="removable"
      :data-unassign="displayId"
      icon="i-lucide-folder-minus"
      color="error"
      variant="ghost"
      size="xs"
      class="opacity-0 group-hover:opacity-100 touch:opacity-100 transition"
      @click="$emit('unassign')"
    />
  </div>
</template>

<script setup lang="ts">
// ============================================================
// Une carte de la page Collection (grille ou liste).
// Propriétés simples (pas d'objet) : quand la page se redessine (sélection,
// ouverture d'une fiche, rechargement), Vue ne redessine que les cartes dont
// une valeur a changé, au lieu de toutes.
// ============================================================
const props = defineProps<{
  view: 'grid' | 'list'
  game: string
  displayId: string
  name: string
  totalQty: number
  tradeQty?: number
  selectMode: boolean
  selected: boolean
  removable: boolean // vrai rangement : bouton « retirer »
  alwaysShowActions: boolean // mobile : bouton visible sans survol
}>()

defineEmits<{ open: []; toggle: []; unassign: [] }>()

// objet stable tant que la carte ne change pas (CardThumb ne se redessine pas)
const card = computed(() => ({
  game: props.game,
  id: props.displayId,
  name: props.name,
  imageUrl: '',
}))
</script>
