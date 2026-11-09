<template>
  <UModal :open="open" title="Edit storage" @update:open="$emit('update:open', $event)">
    <template #body>
      <div v-if="container" class="space-y-4">
        <!-- binder : nombre de pages (dimensions figées) -->
        <template v-if="container.type === 'binder'">
          <div>
            <p class="text-sm text-muted mb-1.5">Number of pages</p>
            <UInput v-model.number="pageCount" type="number" min="0" size="sm" class="w-32" />
            <p class="text-xs text-dimmed mt-1">
              Format fixe : {{ container.rowsPerPage }} × {{ container.colsPerPage }} par page
            </p>
          </div>
          <div v-if="willOrphan" class="text-xs text-warning flex items-start gap-1.5">
            <UIcon name="i-lucide-triangle-alert" class="shrink-0 mt-0.5" />
            <span
              >Reducing to {{ pageCount }} page(s) removes the cards placed on the deleted pages.
              They become unsorted again.</span
            >
          </div>
        </template>

        <!-- deckbox / bulk : capacité max -->
        <template v-else>
          <div>
            <p class="text-sm text-muted mb-1.5">Max capacity</p>
            <UInput
              v-model.number="capacity"
              type="number"
              min="1"
              placeholder="Unlimited"
              size="sm"
              class="w-32"
            />
            <p class="text-xs text-dimmed mt-1">Leave empty for unlimited capacity.</p>
          </div>
          <div v-if="willTrim" class="text-xs text-warning flex items-start gap-1.5">
            <UIcon name="i-lucide-triangle-alert" class="shrink-0 mt-0.5" />
            <span
              >Reducing to {{ capacity }} removes
              {{ container.cardCount - (capacity ?? 0) }} card(s) from this storage. They become
              unsorted again.</span
            >
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
          label="Save"
          icon="i-lucide-check"
          :loading="saving"
          :disabled="!canSave"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import {
  setContainerCapacity,
  setBinderPageCount,
  type ContainerListItem,
} from '~/services/containers'

const props = defineProps<{
  open: boolean
  container: ContainerListItem | null
}>()

const emit = defineEmits<{ 'update:open': [value: boolean]; saved: [] }>()

const toast = useToast()

const capacity = ref<number | null>(null)
const pageCount = ref(0)
const saving = ref(false)

// pré-remplit à l'ouverture
watch(
  () => props.open,
  (o) => {
    if (o && props.container) {
      capacity.value = props.container.maxCapacity ?? null
      pageCount.value = props.container.pageCount ?? 0
    }
  }
)

// avertissement : réduire le nombre de pages sous le contenu actuel
const willOrphan = computed(() => {
  if (!props.container || props.container.type !== 'binder') return false
  const slotsPerPage = (props.container.rowsPerPage ?? 0) * (props.container.colsPerPage ?? 0)
  const capacityAfter = pageCount.value * slotsPerPage
  return props.container.cardCount > capacityAfter
})

// avertissement : réduire la capacité sous le contenu actuel (deckbox/bulk)
const willTrim = computed(() => {
  if (!props.container || props.container.type === 'binder') return false
  if (capacity.value === null) return false
  return props.container.cardCount > capacity.value
})

const canSave = computed(() => {
  if (!props.container) return false
  if (props.container.type === 'binder') return pageCount.value >= 0
  return capacity.value === null || capacity.value >= 1
})

async function save() {
  const c = props.container
  if (!c || !canSave.value) return
  saving.value = true
  try {
    if (c.type === 'binder') {
      const freed = await setBinderPageCount(c.id, pageCount.value)
      toast.add({
        title:
          freed > 0 ? `Pages updated · ${freed} card(s) moved back to unsorted` : 'Pages updated',
        icon: 'i-lucide-check',
        color: 'success',
      })
    } else {
      const freed = await setContainerCapacity(c.id, c.type, capacity.value)
      toast.add({
        title:
          freed > 0
            ? `Capacity updated · ${freed} card(s) moved back to unsorted`
            : 'Capacity updated',
        icon: 'i-lucide-check',
        color: 'success',
      })
    }
    emit('update:open', false)
    emit('saved')
  } catch (e: any) {
    toast.add({
      title:
        e?.message === 'INVALID_CAPACITY'
          ? 'Capacity must be greater than 0'
          : e?.message === 'INVALID_LAYOUT'
            ? 'Invalid value'
            : 'Could not save the changes',
      color: 'error',
    })
  } finally {
    saving.value = false
  }
}
</script>
