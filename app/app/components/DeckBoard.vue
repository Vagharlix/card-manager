<template>
  <div class="flex flex-col" :data-board="board">
    <div class="flex items-center gap-2 mb-2 sticky top-0 bg-default py-1 z-10">
      <h3 class="text-sm font-medium">{{ label }}</h3>
      <span class="text-xs px-1.5 py-0.5 rounded" :class="countClass" :data-board-count="count">
        {{ count }}<template v-if="showMax"> / {{ max }}</template>
      </span>
    </div>

    <div
      v-if="cards.length"
      class="grid gap-2 grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10"
    >
      <div
        v-for="c in cards"
        :key="c.cardId"
        class="deck-board-card relative group"
        :data-deck-card-id="c.cardId"
        :data-quantity="c.quantity"
        :data-flagged="flagged?.has(c.cardId) ? 'true' : 'false'"
      >
        <!-- ── MOBILE : tap ouvre le menu d'actions ── -->
        <UDropdownMenu v-if="isMobile" :items="menuItems(c)" :content="{ align: 'center' }">
          <button class="block w-full">
            <div
              class="aspect-[0.686] rounded overflow-hidden border-2 transition-colors"
              :class="flagged?.has(c.cardId) ? 'border-error' : 'border-transparent'"
            >
              <ArtThumb :passcode="c.cardId" class="w-full h-full object-cover" />
            </div>
          </button>
          <template #item="{ item }">
            <span :data-menu-action="(item as any).action" class="flex items-center gap-2 w-full">
              <UIcon :name="item.icon as string" class="shrink-0" />
              <span class="flex-1 truncate">{{ item.label }}</span>
            </span>
          </template>
        </UDropdownMenu>

        <!-- ── DESKTOP : clic gauche = aperçu, clic droit = retirer ── -->
        <button
          v-else
          class="block w-full"
          @click="$emit('info', c)"
          @contextmenu.prevent="$emit('remove', c)"
        >
          <div
            class="aspect-[0.686] rounded overflow-hidden border-2 transition-colors"
            :class="
              flagged?.has(c.cardId)
                ? 'border-error'
                : 'border-transparent group-hover:border-primary'
            "
          >
            <ArtThumb :passcode="c.cardId" class="w-full h-full object-cover" />
          </div>
        </button>

        <!-- quantité -->
        <div
          v-if="c.quantity > 1"
          class="absolute bottom-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full bg-primary text-inverted text-[10px] font-medium flex items-center justify-center pointer-events-none"
        >
          {{ c.quantity }}
        </div>

        <!-- infraction banlist / possession -->
        <div
          v-if="flagged?.has(c.cardId)"
          class="absolute top-0.5 left-0.5 size-4 rounded-full bg-error text-inverted flex items-center justify-center pointer-events-none"
          title="Dépasse la limite du format"
        >
          <UIcon name="i-lucide-ban" class="text-[10px]" />
        </div>
        <div
          v-else-if="c.owned < c.quantity"
          class="absolute top-0.5 left-0.5 size-4 rounded-full bg-warning text-inverted flex items-center justify-center pointer-events-none"
          :title="`Tu possèdes ${c.owned} / ${c.quantity}`"
        >
          <UIcon name="i-lucide-alert-triangle" class="text-[10px]" />
        </div>

        <!-- ── DESKTOP : icône menu au survol (actions rapides : +1, Side, retirer) ── -->
        <UDropdownMenu v-if="!isMobile" :items="menuItems(c)" :content="{ align: 'end' }">
          <button
            :data-menu-trigger="c.cardId"
            class="absolute top-0.5 right-0.5 size-5 rounded bg-elevated/90 border border-default flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:bg-primary hover:text-inverted"
            title="Actions"
            @click.stop
          >
            <UIcon name="i-lucide-ellipsis-vertical" class="text-xs" />
          </button>
          <template #item="{ item }">
            <span :data-menu-action="(item as any).action" class="flex items-center gap-2 w-full">
              <UIcon :name="item.icon as string" class="shrink-0" />
              <span class="flex-1 truncate">{{ item.label }}</span>
            </span>
          </template>
        </UDropdownMenu>

        <!-- DESKTOP : bouton déplacer vers/depuis le Side (au survol, accès direct) -->
        <button
          v-if="!isMobile"
          :data-move="c.cardId"
          class="absolute bottom-0.5 left-0.5 size-5 rounded bg-elevated/90 border border-default flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:bg-primary hover:text-inverted"
          :title="isSide ? 'Renvoyer au deck' : 'Envoyer au Side'"
          @click.stop="$emit('move', c)"
        >
          <UIcon :name="isSide ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'" class="text-xs" />
        </button>
      </div>
    </div>
    <p v-else class="text-xs text-dimmed italic py-2">Vide</p>
  </div>
</template>

<script setup lang="ts">
import type { DeckCard } from '~/services/decks'

const props = defineProps<{
  label: string
  board: string
  cards: DeckCard[]
  min: number
  max: number
  showMax?: boolean
  flagged?: Set<string>
  isSide?: boolean
}>()

const emit = defineEmits<{
  remove: [card: DeckCard]
  info: [card: DeckCard]
  move: [card: DeckCard]
  add: [card: DeckCard]
}>()

const { isMobile } = useResponsive()

const count = computed(() => props.cards.reduce((s, c) => s + c.quantity, 0))

const countClass = computed(() => {
  const n = count.value
  if (n < props.min || n > props.max) return 'bg-error/15 text-error'
  return 'bg-elevated text-muted'
})

// menu d'actions partagé (mobile = tap, desktop = icône au survol)
function menuItems(c: DeckCard) {
  return [
    [
      { label: 'Infos', icon: 'i-lucide-info', action: 'info', onSelect: () => emit('info', c) },
      {
        label: 'Ajouter (+1)',
        icon: 'i-lucide-plus',
        action: 'add',
        onSelect: () => emit('add', c),
      },
      {
        label: 'Retirer (−1)',
        icon: 'i-lucide-minus',
        action: 'remove',
        onSelect: () => emit('remove', c),
      },
      props.isSide
        ? {
            label: 'Renvoyer au deck',
            icon: 'i-lucide-arrow-up',
            action: 'move',
            onSelect: () => emit('move', c),
          }
        : {
            label: 'Envoyer au Side',
            icon: 'i-lucide-arrow-down',
            action: 'move',
            onSelect: () => emit('move', c),
          },
    ],
  ]
}
</script>
