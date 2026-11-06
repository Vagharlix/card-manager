<template>
  <!-- MOBILE : liste à grandes lignes (onglet « Rangements » de la collection) -->
  <div v-if="isMobile" class="flex flex-col gap-2 pb-24">
    <button
      data-container-id="__unranged__"
      class="w-full flex items-center gap-3 p-3 rounded-xl text-left border border-warning/40 bg-warning/10"
      @click="$emit('select', UNRANGED_ID)"
    >
      <span
        class="size-10 rounded-lg bg-warning/20 text-warning flex items-center justify-center shrink-0"
      >
        <UIcon name="i-lucide-inbox" class="size-5" />
      </span>
      <span class="flex-1 min-w-0">
        <span class="block font-semibold">Non rangées</span>
        <span class="block text-xs text-muted">{{ unrangedCount }} carte(s) à ranger</span>
      </span>
      <UIcon name="i-lucide-chevron-right" class="text-muted" />
    </button>

    <template v-for="group in groups" :key="group.type">
      <p class="mt-3 px-1 text-xs font-semibold text-muted uppercase tracking-wide">
        {{ group.label }}
      </p>
      <p v-if="!group.items.length" class="px-1 text-sm text-dimmed italic">aucun</p>
      <div
        v-for="c in group.items"
        :key="c.id"
        :data-container-id="c.id"
        :data-container-name="c.name"
        class="container-item flex items-center gap-3 p-3 rounded-xl bg-elevated border border-default"
        @click="$emit('select', c.id)"
      >
        <span
          class="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0"
        >
          <UIcon :name="group.icon" class="size-5" />
        </span>
        <span class="flex-1 min-w-0">
          <span class="block font-semibold truncate">{{ c.name }}</span>
          <span class="block text-xs text-muted">{{ describe(c) }}</span>
        </span>
        <UDropdownMenu :items="menuItems(c)" :content="{ align: 'end' }">
          <UButton
            :data-menu-trigger="c.id"
            icon="i-lucide-ellipsis-vertical"
            color="neutral"
            variant="ghost"
            size="lg"
            aria-label="Actions"
            @click.stop
          />
          <template #item="{ item }">
            <span :data-menu-action="(item as any).action" class="flex items-center gap-2 w-full">
              <UIcon :name="item.icon as string" class="shrink-0" />
              <span class="flex-1 truncate">{{ item.label }}</span>
            </span>
          </template>
        </UDropdownMenu>
      </div>
    </template>

    <UButton
      id="container-create-btn"
      icon="i-lucide-plus"
      label="Nouveau"
      size="xl"
      class="fixed right-4 z-10 rounded-full shadow-lg"
      :style="{ bottom: 'calc(5rem + var(--safe-bottom))' }"
      @click="$emit('create')"
    />
  </div>

  <div v-else class="flex flex-col h-full">
    <button
      data-container-id="__all__"
      class="mb-3 shrink-0 w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm text-left transition border"
      :class="
        selectedId === ALL_ID
          ? 'bg-primary/10 border-primary/40 text-primary'
          : 'border-default hover:bg-elevated'
      "
      @click="$emit('select', ALL_ID)"
    >
      <UIcon name="i-lucide-library" class="shrink-0" />
      <span class="flex-1">Toute ma collection</span>
      <span class="text-xs shrink-0">{{ totalCount }}</span>
    </button>

    <div class="flex items-center justify-between mb-3 shrink-0">
      <p class="text-xs text-muted uppercase tracking-wide">Conteneurs</p>
      <UButton
        id="container-create-btn"
        icon="i-lucide-plus"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="$emit('create')"
      />
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto space-y-4">
      <div v-for="group in groups" :key="group.type">
        <p class="text-[11px] text-muted uppercase tracking-wide mb-1 flex items-center gap-1.5">
          <UIcon :name="group.icon" class="text-xs" />
          {{ group.label }}
        </p>

        <div v-if="group.items.length" class="space-y-0.5">
          <div
            v-for="c in group.items"
            :key="c.id"
            :data-container-id="c.id"
            :data-container-name="c.name"
            class="container-item group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition cursor-pointer"
            :class="selectedId === c.id ? 'bg-elevated text-primary' : 'hover:bg-elevated'"
            @click="$emit('select', c.id)"
          >
            <span class="flex-1 truncate">{{ c.name }}</span>

            <UDropdownMenu :items="menuItems(c)" :content="{ align: 'end' }">
              <UButton
                :data-menu-trigger="c.id"
                icon="i-lucide-ellipsis-vertical"
                color="neutral"
                variant="ghost"
                size="xs"
                class="opacity-0 group-hover:opacity-100 transition"
                @click.stop
              />
              <template #item="{ item }">
                <span
                  :data-menu-action="(item as any).action"
                  class="flex items-center gap-2 w-full"
                >
                  <UIcon :name="item.icon as string" class="shrink-0" />
                  <span class="flex-1 truncate">{{ item.label }}</span>
                </span>
              </template>
            </UDropdownMenu>

            <span class="text-xs text-muted shrink-0 w-5 text-right">{{ c.cardCount }}</span>
          </div>
        </div>
        <p v-else class="text-xs text-dimmed pl-2 italic">vide</p>
      </div>
    </div>

    <button
      data-container-id="__unranged__"
      class="mt-3 shrink-0 w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm text-left transition border"
      :class="
        selectedId === UNRANGED_ID
          ? 'bg-warning/10 border-warning/40 text-warning'
          : 'border-default hover:bg-elevated'
      "
      @click="$emit('select', UNRANGED_ID)"
    >
      <UIcon name="i-lucide-inbox" class="shrink-0" />
      <span class="flex-1">Non rangées</span>
      <span class="text-xs shrink-0">{{ unrangedCount }}</span>
    </button>
  </div>

  <!-- renommage -->
  <UModal v-model:open="renameOpen" title="Renommer le conteneur">
    <template #body>
      <UInput
        id="container-rename-input"
        v-model="renameValue"
        placeholder="Nouveau nom"
        class="w-full"
        autofocus
        @keydown.enter="confirmRename"
      />
    </template>
    <template #footer="{ close }">
      <div class="flex gap-2 justify-end w-full">
        <UButton label="Annuler" color="neutral" variant="ghost" @click="close" />
        <UButton
          id="container-rename-confirm"
          label="Renommer"
          icon="i-lucide-check"
          :loading="renaming"
          :disabled="!renameValue.trim()"
          @click="confirmRename"
        />
      </div>
    </template>
  </UModal>

  <!-- édition (capacité / pages) -->
  <containerEditModal v-model:open="editOpen" :container="pendingEdit" @saved="$emit('changed')" />

  <!-- confirmation de suppression -->
  <UModal v-model:open="confirmOpen" title="Supprimer ce conteneur ?">
    <template #body>
      <p class="text-sm text-muted">
        « {{ pendingDelete?.name }} » sera supprimé. Les cartes qu'il contient ne seront pas perdues
        — elles redeviendront « non rangées ».
      </p>
    </template>
    <template #footer="{ close }">
      <div class="flex gap-2 justify-end w-full">
        <UButton label="Annuler" color="neutral" variant="ghost" @click="close" />
        <UButton
          id="container-delete-confirm"
          label="Supprimer"
          color="error"
          icon="i-lucide-trash-2"
          :loading="deleting"
          @click="confirmDelete"
        />
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import {
  renameContainer,
  deleteContainer,
  type ContainerListItem,
  type ContainerType,
} from '~/services/containers'

const props = defineProps<{
  containers: ContainerListItem[]
  unrangedCount: number
  totalCount: number
  selectedId: string | null
}>()

const emit = defineEmits<{ select: [id: string]; create: []; changed: [] }>()

const toast = useToast()
const { isMobile } = useResponsive()

function describe(c: ContainerListItem): string {
  if (c.type === 'deckbox' && c.maxCapacity) return `${c.cardCount} / ${c.maxCapacity} cartes`
  if (c.type === 'binder')
    return `${c.cardCount} carte(s) · ${c.pageCount ?? 0} pages ${c.rowsPerPage ?? 3}×${c.colsPerPage ?? 3}`
  return `${c.cardCount} carte(s)`
}

const TYPE_META: Record<ContainerType, { label: string; icon: string }> = {
  deckbox: { label: 'Deckbox', icon: 'i-lucide-box' },
  binder: { label: 'Classeurs', icon: 'i-lucide-notebook' },
  bulk_box: { label: 'Boîtes', icon: 'i-lucide-archive' },
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

function menuItems(c: ContainerListItem) {
  return [
    [
      {
        label: 'Renommer',
        icon: 'i-lucide-pencil',
        action: 'rename',
        onSelect: () => askRename(c),
      },
      {
        label: 'Modifier',
        icon: 'i-lucide-settings-2',
        action: 'edit',
        onSelect: () => askEdit(c),
      },
      {
        label: 'Supprimer',
        icon: 'i-lucide-trash-2',
        action: 'delete',
        color: 'error' as const,
        onSelect: () => askDelete(c),
      },
    ],
  ]
}

// ── renommage ──
const renameOpen = ref(false)
const renameValue = ref('')
const renaming = ref(false)
const pendingRename = ref<ContainerListItem | null>(null)

function askRename(c: ContainerListItem) {
  pendingRename.value = c
  renameValue.value = c.name
  renameOpen.value = true
}

async function confirmRename() {
  const c = pendingRename.value
  if (!c || !renameValue.value.trim()) return
  renaming.value = true
  try {
    await renameContainer(c.id, renameValue.value)
    toast.add({ title: 'Conteneur renommé', icon: 'i-lucide-check', color: 'success' })
    renameOpen.value = false
    emit('changed')
  } catch (e: any) {
    toast.add({
      title:
        e?.message === 'DUPLICATE_NAME' ? 'Un conteneur porte déjà ce nom' : 'Échec du renommage',
      color: 'error',
    })
  } finally {
    renaming.value = false
    pendingRename.value = null
  }
}

// ── édition (capacité / pages) ──
const editOpen = ref(false)
const pendingEdit = ref<ContainerListItem | null>(null)

function askEdit(c: ContainerListItem) {
  pendingEdit.value = c
  editOpen.value = true
}

// ── suppression ──
const confirmOpen = ref(false)
const pendingDelete = ref<ContainerListItem | null>(null)
const deleting = ref(false)

function askDelete(c: ContainerListItem) {
  pendingDelete.value = c
  confirmOpen.value = true
}

async function confirmDelete() {
  const c = pendingDelete.value
  if (!c) return
  deleting.value = true
  try {
    await deleteContainer(c.id)
    toast.add({ title: 'Conteneur supprimé', icon: 'i-lucide-check', color: 'success' })
    emit('changed')
  } catch {
    toast.add({ title: 'Échec de la suppression', color: 'error' })
  } finally {
    deleting.value = false
    confirmOpen.value = false
    pendingDelete.value = null
  }
}
</script>
