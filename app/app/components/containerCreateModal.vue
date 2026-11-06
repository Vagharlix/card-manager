<template>
  <UModal :open="open" title="Nouveau conteneur" @update:open="$emit('update:open', $event)">
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
          <p class="text-sm text-muted mb-1.5">Nom</p>
          <UInput
            id="container-name-input"
            v-model="name"
            placeholder="ex. Classeur rares"
            class="w-full"
            autofocus
          />
        </div>

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
            <p class="text-xs text-muted mb-1">Lignes</p>
            <UInput
              id="container-rows-input"
              v-model.number="rows"
              type="number"
              min="1"
              size="sm"
            />
          </div>
          <div>
            <p class="text-xs text-muted mb-1">Colonnes</p>
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
          <p class="text-xs text-muted mb-1">Capacité max (optionnel)</p>
          <UInput
            id="container-capacity-input"
            v-model.number="maxCapacity"
            type="number"
            min="1"
            placeholder="Illimitée"
            size="sm"
            class="w-full"
          />
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex gap-2 justify-end w-full">
        <UButton
          label="Annuler"
          color="neutral"
          variant="ghost"
          @click="$emit('update:open', false)"
        />
        <UButton
          id="container-create-confirm"
          label="Créer"
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
}

async function create() {
  if (!canCreate.value) return
  creating.value = true
  try {
    let id: string
    if (type.value === 'binder') {
      id = await createBinder(name.value.trim(), pageCount.value, rows.value, cols.value)
    } else if (type.value === 'deckbox') {
      id = await createDeckbox(name.value.trim(), maxCapacity.value)
    } else {
      id = await createBulkBox(name.value.trim(), maxCapacity.value)
    }
    toast.add({ title: 'Conteneur créé', icon: 'i-lucide-check', color: 'success' })
    resetForm()
    emit('update:open', false)
    emit('created', id)
  } catch (e: any) {
    const msg =
      e?.message === 'DUPLICATE_NAME'
        ? 'Un conteneur porte déjà ce nom'
        : e?.message === 'INVALID_CAPACITY'
          ? 'La capacité doit être supérieure à 0'
          : e?.message === 'INVALID_LAYOUT'
            ? 'Dimensions de classeur invalides'
            : e?.message === 'EMPTY_NAME'
              ? 'Le nom ne peut pas être vide'
              : 'Échec de la création'
    toast.add({ title: msg, color: 'error' })
  } finally {
    creating.value = false
  }
}
</script>
