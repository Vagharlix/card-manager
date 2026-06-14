<template>
  <button
    class="group relative text-left rounded-lg border border-default overflow-hidden hover:border-primary transition-colors"
    @click="$emit('open', deck)"
  >
    <!-- cover -->
    <div class="aspect-[1.4] bg-elevated overflow-hidden relative">
      <ArtThumb
        v-if="deck.coverCardId"
        :passcode="deck.coverCardId"
        class="w-full h-full object-cover object-top"
      />
      <div v-else class="w-full h-full flex items-center justify-center text-dimmed">
        <UIcon name="i-lucide-layers" class="text-3xl" />
      </div>

      <!-- menu actions -->
      <UDropdownMenu :items="menuItems" :content="{ align: 'end' }">
        <UButton
          icon="i-lucide-ellipsis-vertical"
          color="neutral"
          variant="solid"
          size="xs"
          class="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition z-10"
          @click.stop
        />
      </UDropdownMenu>
    </div>

    <!-- infos -->
    <div class="p-2.5">
      <div class="flex items-center gap-2">
        <p class="font-medium text-sm truncate flex-1">{{ deck.name }}</p>
        <span
          v-if="deck.deckboxName"
          class="flex items-center gap-1 text-[11px] text-muted shrink-0 max-w-[45%]"
          :title="deck.deckboxName"
        >
          <UIcon name="i-lucide-package" class="shrink-0" />
          <span class="truncate">{{ deck.deckboxName }}</span>
        </span>
      </div>
      <p class="text-xs text-muted mt-0.5">
        Main {{ deck.mainCount }} · Extra {{ deck.extraCount }} · Side {{ deck.sideCount }}
      </p>
    </div>
  </button>
</template>

<script setup lang="ts">
import type { DeckListItem } from '~/services/decks'

const props = defineProps<{ deck: DeckListItem }>()
const emit = defineEmits<{
  open: [deck: DeckListItem]
  rename: [deck: DeckListItem]
  delete: [deck: DeckListItem]
  range: [deck: DeckListItem]
}>()

const menuItems = computed(() => [
  [
    { label: 'Renommer', icon: 'i-lucide-pencil', onSelect: () => emit('rename', props.deck) },
    {
      label: 'Ranger dans une deckbox',
      icon: 'i-lucide-package',
      onSelect: () => emit('range', props.deck),
    },
    {
      label: 'Supprimer',
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      onSelect: () => emit('delete', props.deck),
    },
  ],
])
</script>
