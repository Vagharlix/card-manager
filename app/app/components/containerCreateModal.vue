<template>
  <UModal :open="open" title="New storage" @update:open="$emit('update:open', $event)">
    <template #body>
      <div class="space-y-4">
        <!-- type -->
        <div>
          <p class="text-sm text-muted mb-1.5">Type</p>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="t in TYPES"
              :key="t.value"
              :data-type="t.value"
              class="container-type-btn flex flex-col items-center gap-1 p-3 rounded-lg border text-sm transition"
              :class="
                type === t.value
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-default hover:bg-elevated'
              "
              @click="type = t.value"
            >
              <UIcon :name="t.icon" class="text-lg" />
              {{ t.label }}
            </button>
          </div>
        </div>

        <!-- nom -->
        <div>
          <p class="text-sm text-muted mb-1.5">Name</p>
          <UInput
            id="container-name-input"
            v-model="name"
            placeholder="e.g. Rare binder"
            class="w-full"
            autofocus
          />
        </div>

        <!-- jeux (facultatif, plusieurs possibles) -->
        <ContainerGameSelect v-model="games" />

        <!-- options binder -->
        <div v-if="type === 'binder'" class="grid grid-cols-3 gap-2">
          <div>
            <p class="text-xs text-muted mb-1">Pages</p>
            <UInput
              id="container-pages-input"
              v-model.number="pageCount"
              type="number"
              min="0"
              size="sm"
            />
          </div>
          <div>
            <p class="text-xs text-muted mb-1">Rows</p>
            <UInput
              id="container-rows-input"
              v-model.number="rows"
              type="number"
              min="1"
              size="sm"
            />
          </div>
          <div>
            <p class="text-xs text-muted mb-1">Columns</p>
            <UInput
              id="container-cols-input"
              v-model.number="cols"
              type="number"
              min="1"
              size="sm"
            />
          </div>
        </div>

        <!-- capacité deckbox / bulk -->
        <div v-else>
          <p class="text-xs text-muted mb-1">Max capacity (optional)</p>
          <UInput
            id="container-capacity-input"
            v-model.number="maxCapacity"
            type="number"
            min="1"
            placeholder="Unlimited"
            size="sm"
            class="w-full"
          />
        </div>
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
          id="container-create-confirm"
          label="Create"
          icon="i-lucide-check"
          :loading="creating"
          :disabled="!canCreate"
          @click="create"
        />
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import {
  createDeckbox,
  createBinder,
  createBulkBox,
  type ContainerType,
} from '~/services/containers'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; created: [id: string] }>()

const toast = useToast()

const TYPES: { value: ContainerType; label: string; icon: string }[] = [
  { value: 'deckbox', label: 'Deckbox', icon: 'i-lucide-box' },
  { value: 'binder', label: 'Binder', icon: 'i-lucide-notebook' },
  { value: 'bulk_box', label: 'Bulk box', icon: 'i-lucide-archive' },
]

const type = ref<ContainerType>('deckbox')
const name = ref('')
const pageCount = ref(0)
const rows = ref(3)
const cols = ref(3)
const maxCapacity = ref<number | null>(null)
const creating = ref(false)
// jeux associés : le jeu affiché par défaut (aucun = tous les jeux)
const currentGame = useCurrentGame().game
const games = ref<string[]>([currentGame.value])

// validation en amont : bouton désactivé si saisie invalide
const canCreate = computed(() => {
  if (!name.value.trim()) return false
  if (type.value === 'binder') {
    return rows.value >= 1 && cols.value >= 1 && pageCount.value >= 0
  }
  return maxCapacity.value === null || maxCapacity.value >= 1
})

function resetForm() {
  name.value = ''
  maxCapacity.value = null
  pageCount.value = 0
  rows.value = 3
  cols.value = 3
  games.value = [currentGame.value]
}

async function create() {
  if (!canCreate.value) return
  creating.value = true
  try {
    let id: string
    if (type.value === 'binder') {
      id = await createBinder(
        name.value.trim(),
        pageCount.value,
        rows.value,
        cols.value,
        games.value
      )
    } else if (type.value === 'deckbox') {
      id = await createDeckbox(name.value.trim(), maxCapacity.value, games.value)
    } else {
      id = await createBulkBox(name.value.trim(), maxCapacity.value, games.value)
    }
    toast.add({ title: 'Storage created', icon: 'i-lucide-check', color: 'success' })
    resetForm()
    emit('update:open', false)
    emit('created', id)
  } catch (e: any) {
    const msg =
      e?.message === 'DUPLICATE_NAME'
        ? 'A storage already has this name'
        : e?.message === 'INVALID_CAPACITY'
          ? 'Capacity must be greater than 0'
          : e?.message === 'INVALID_LAYOUT'
            ? 'Invalid binder size'
            : e?.message === 'EMPTY_NAME'
              ? 'The name cannot be empty'
              : 'Could not create the storage'
    toast.add({ title: msg, color: 'error' })
  } finally {
    creating.value = false
  }
}
</script>
