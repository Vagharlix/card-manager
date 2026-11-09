<template>
  <UModal :open="open" :title="title" @update:open="$emit('update:open', $event)">
    <template #body>
      <div class="space-y-4">
        <!-- quantité (flux carte unique, si plusieurs non rangés) -->
        <div v-if="maxQuantity && maxQuantity > 1">
          <p class="text-sm text-muted mb-1.5">Quantity to store</p>
          <UInput
            id="picker-qty-input"
            v-model.number="qty"
            type="number"
            min="1"
            :max="maxQuantity"
            size="sm"
            class="w-32"
          />
          <p class="text-xs text-dimmed mt-1">{{ maxQuantity }} unsorted</p>
        </div>

        <!-- liste des conteneurs groupés par type -->
        <div>
          <p class="text-sm text-muted mb-1.5">Storage</p>

          <div v-if="!containers.length" class="text-sm text-dimmed text-center py-6">
            No storage yet. Create one first.
          </div>

          <div v-else class="space-y-3 max-h-72 overflow-y-auto">
            <div v-for="group in groups" :key="group.type">
              <p
                v-if="group.items.length"
                class="text-[11px] text-muted uppercase tracking-wide mb-1 flex items-center gap-1.5"
              >
                <UIcon :name="group.icon" class="text-xs" />
                {{ group.label }}
              </p>
              <button
                v-for="c in group.items"
                :key="c.id"
                :data-picker-container-id="c.id"
                :disabled="c.isFull"
                class="picker-container w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition border mb-1"
                :class="
                  c.isFull
                    ? 'border-default opacity-40 cursor-not-allowed'
                    : selected === c.id
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-default hover:bg-elevated'
                "
                @click="!c.isFull && (selected = c.id)"
              >
                <span class="flex-1 truncate">{{ c.name }}</span>
                <UBadge v-if="c.isFull" color="error" variant="soft" size="xs">Full</UBadge>
                <span v-else class="text-xs text-muted">{{ capacityLabel(c) }}</span>
              </button>
            </div>
          </div>
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
          id="picker-confirm"
          label="Store"
          icon="i-lucide-check"
          :loading="busy"
          :disabled="!selected"
          @click="confirm"
        />
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import type { ContainerWithCapacity, ContainerType } from '~/services/containers'

const props = withDefaults(
  defineProps<{
    open: boolean
    containers: ContainerWithCapacity[]
    title?: string
    maxQuantity?: number | null
    busy?: boolean
  }>(),
  {
    title: 'Store in…',
    maxQuantity: null,
    busy: false,
  }
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: [payload: { containerId: string; type: ContainerType; quantity: number }]
}>()

const selected = ref<string | null>(null)
const qty = ref(1)

const TYPE_META: Record<ContainerType, { label: string; icon: string }> = {
  deckbox: { label: 'Deckboxes', icon: 'i-lucide-box' },
  binder: { label: 'Binders', icon: 'i-lucide-notebook' },
  bulk_box: { label: 'Bulk boxes', icon: 'i-lucide-archive' },
}

const groups = computed(() => {
  const order: ContainerType[] = ['deckbox', 'binder', 'bulk_box']
  return order.map((type) => ({
    type,
    label: TYPE_META[type].label,
    icon: TYPE_META[type].icon,
    items: props.containers.filter((c) => c.type === type),
  }))
})

// "3 restantes" / "∞" pour un conteneur non plein
function capacityLabel(c: ContainerWithCapacity): string {
  if (c.remaining === null) return '∞'
  return `${c.remaining} libre${c.remaining > 1 ? 's' : ''}`
}

watch(
  () => props.open,
  (o) => {
    if (o) {
      selected.value = null
      qty.value = 1
    }
  }
)

function confirm() {
  if (!selected.value) return
  const container = props.containers.find((c) => c.id === selected.value)
  if (!container || container.isFull) return
  emit('confirm', {
    containerId: container.id,
    type: container.type,
    quantity: qty.value,
  })
}
</script>
