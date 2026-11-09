<template>
  <UModal :open="open" :title="title" @update:open="$emit('update:open', $event)">
    <template #body>
      <div class="space-y-4" data-range-modal-body>
        <!-- sélecteur de deckbox -->
        <div v-if="!deckboxes.length" class="text-sm text-muted text-center py-4">
          No deckbox yet. Create one in the collection first.
        </div>
        <template v-else>
          <!-- deckbox actuelle du deck -->
          <p v-if="current" class="text-xs text-muted">
            Currently stored in:
            <span class="text-default font-medium">{{ current.name }}</span>
          </p>

          <div>
            <p class="text-sm text-muted mb-1.5">Deckbox</p>
            <USelect
              id="deck-range-select"
              v-model="selectedId"
              :items="deckboxItems"
              placeholder="Pick a deckbox"
              size="sm"
              class="w-full"
            >
              <template #item="{ item }">
                <span
                  :data-select-value="(item as any).value"
                  class="flex items-center gap-2 w-full"
                >
                  {{ item.label }}
                </span>
              </template>
            </USelect>
          </div>

          <!-- calcul en cours -->
          <div v-if="planning" class="text-sm text-muted text-center py-4">Computing…</div>

          <!-- récap du plan -->
          <div v-else-if="plan" class="space-y-3" data-range-plan>
            <!-- purge : cartes étrangères au deck qui sortent de la deckbox -->
            <UAlert
              v-if="plan.purgeTotal > 0"
              color="warning"
              variant="soft"
              icon="i-lucide-package-open"
              title="This deckbox holds other cards"
            >
              <template #description>
                <p class="text-xs mt-0.5">
                  {{ plan.purgeTotal }} card(s) not in the deck will be moved back to unsorted:
                </p>
                <ul class="text-xs mt-1 space-y-0.5">
                  <li v-for="(p, i) in plan.purge" :key="i">{{ p.name }} ×{{ p.qty }}</li>
                </ul>
              </template>
            </UAlert>

            <!-- capacité -->
            <UAlert
              v-if="plan.willExceed"
              color="warning"
              variant="soft"
              icon="i-lucide-triangle-alert"
              title="Capacity exceeded"
              :description="`The deck needs ${plan.neededCapacity} slots, the deckbox has ${plan.capacity}. Its capacity will be raised to ${plan.neededCapacity}.`"
            />

            <!-- rien à faire -->
            <p v-if="!plan.lines.length" class="text-sm text-muted text-center py-2">
              All owned cards are already in this deckbox.
            </p>

            <!-- détail par carte -->
            <div v-else class="max-h-64 overflow-y-auto space-y-1.5">
              <div
                v-for="l in plan.lines"
                :key="l.rootId"
                class="flex items-center gap-2 text-sm rounded-lg border border-default p-2"
              >
                <div class="w-8 shrink-0 rounded overflow-hidden">
                  <ArtThumb :passcode="l.displayId" />
                </div>
                <div class="flex-1 min-w-0">
                  <p class="truncate">{{ l.name }}</p>
                  <p class="text-xs text-muted">
                    <template v-if="l.toAssign > 0">+{{ l.toAssign }} stored</template>
                    <template v-if="l.toMove > 0">
                      <template v-if="l.toAssign > 0"> · </template>
                      {{ l.toMove }} moved from
                      {{ l.movedFrom.map((m) => `${m.name} ×${m.qty}`).join(', ') }}
                    </template>
                    <template v-if="l.missing > 0">
                      <template v-if="l.toAssign > 0 || l.toMove > 0"> · </template>
                      <span class="text-warning">{{ l.missing }} not owned</span>
                    </template>
                  </p>
                </div>
              </div>
            </div>

            <!-- résumé -->
            <p class="text-xs text-muted" :data-plan-total="plan.totalToPlace">
              {{ plan.totalToPlace }} card(s) will go into “{{ plan.deckboxName }}”.
            </p>
          </div>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex gap-2 justify-end w-full">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="$emit('update:open', false)"
        />
        <UButton
          id="deck-range-confirm"
          label="Confirm"
          icon="i-lucide-check"
          :disabled="!canConfirm"
          :loading="applying"
          @click="confirm"
        />
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { listContainers, type ContainerListItem } from '~/services/containers'
import {
  planDeckToDeckbox,
  deckCurrentDeckbox,
  type DeckLinkPlan,
  type CurrentDeckbox,
} from '~/services/deckLink'

const props = defineProps<{
  open: boolean
  deckId: string
  applying?: boolean
}>()

const emit = defineEmits<{ 'update:open': [value: boolean]; confirm: [plan: DeckLinkPlan] }>()

const deckboxes = ref<ContainerListItem[]>([])
const current = ref<CurrentDeckbox | null>(null)

// la deckbox actuelle est grisée et marquée « (actuelle) »
const deckboxItems = computed(() =>
  deckboxes.value.map((d) => ({
    label: d.id === current.value?.id ? `${d.name} (current)` : d.name,
    value: d.id,
    disabled: d.id === current.value?.id,
  }))
)

const selectedId = ref<string | undefined>(undefined)
const plan = ref<DeckLinkPlan | null>(null)
const planning = ref(false)

// on peut confirmer dès qu'une deckbox différente de l'actuelle est choisie
// (le lien changera), ou s'il y a quelque chose à faire physiquement.
const canConfirm = computed(() => {
  const p = plan.value
  if (!selectedId.value || planning.value || !p) return false
  if (selectedId.value !== current.value?.id) return true // déplacement / nouveau rangement
  return p.totalToPlace > 0 || p.purgeTotal > 0 // même deckbox : resynchronisation
})

function confirm() {
  if (plan.value) emit('confirm', plan.value)
}

const title = computed(() => 'Store the deck in a deckbox')

async function loadDeckboxes() {
  const all = await listContainers()
  deckboxes.value = all.filter((c) => c.type === 'deckbox')
  current.value = await deckCurrentDeckbox(props.deckId)
}

// recalcule le plan quand on choisit un deckbox
watch(selectedId, async (id) => {
  if (!id) {
    plan.value = null
    return
  }
  planning.value = true
  try {
    plan.value = await planDeckToDeckbox(props.deckId, id, 'ygo')
  } finally {
    planning.value = false
  }
})

// charge les deckbox à l'ouverture
watch(
  () => props.open,
  (o) => {
    if (o) {
      selectedId.value = undefined
      plan.value = null
      loadDeckboxes()
    }
  }
)
</script>
