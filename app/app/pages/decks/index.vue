<template>
  <AppPage>
    <div class="flex flex-col h-full">
      <!-- barre d'outils -->
      <div class="flex items-center gap-2 mb-4 shrink-0">
        <div>
          <h2 class="font-medium">Decks</h2>
          <p class="text-xs text-muted">{{ decks.length }} deck{{ decks.length > 1 ? 's' : '' }}</p>
        </div>
        <div class="flex-1" />
        <UButton
          id="deck-create-btn"
          icon="i-lucide-plus"
          label="Nouveau deck"
          @click="openCreate"
        />
      </div>

      <!-- contenu -->
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div
          v-if="!loading && !decks.length"
          class="flex flex-col items-center justify-center text-center py-20 text-muted"
        >
          <UIcon name="i-lucide-layers" class="text-4xl mb-3" />
          <p>Aucun deck pour l'instant</p>
          <UButton
            id="deck-create-empty"
            class="mt-4"
            icon="i-lucide-plus"
            label="Créer un deck"
            @click="openCreate"
          />
        </div>

        <div v-else class="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          <DeckCard
            v-for="d in decks"
            :key="d.id"
            :deck="d"
            @open="openDeck"
            @rename="askRename"
            @delete="askDelete"
            @range="askRange"
          />
        </div>
      </div>
    </div>

    <!-- création -->
    <UModal v-model:open="createOpen" title="Nouveau deck">
      <template #body>
        <UInput
          id="deck-name-input"
          v-model="createName"
          placeholder="Nom du deck"
          class="w-full"
          autofocus
          @keydown.enter="confirmCreate"
        />
      </template>
      <template #footer="{ close }">
        <div class="flex gap-2 justify-end w-full">
          <UButton label="Annuler" color="neutral" variant="ghost" @click="close" />
          <UButton
            id="deck-create-confirm"
            label="Créer"
            icon="i-lucide-check"
            :loading="creating"
            :disabled="!createName.trim()"
            @click="confirmCreate"
          />
        </div>
      </template>
    </UModal>

    <!-- renommage -->
    <UModal v-model:open="renameOpen" title="Renommer le deck">
      <template #body>
        <UInput
          id="deck-rename-input"
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
            id="deck-rename-confirm"
            label="Renommer"
            icon="i-lucide-check"
            :loading="renaming"
            :disabled="!renameValue.trim()"
            @click="confirmRename"
          />
        </div>
      </template>
    </UModal>

    <!-- suppression -->
    <UModal v-model:open="deleteOpen" title="Supprimer ce deck ?">
      <template #body>
        <p class="text-sm text-muted">
          « {{ pendingDelete?.name }} » sera supprimé. Cette action peut être annulée plus tard
          (soft delete).
        </p>
      </template>
      <template #footer="{ close }">
        <div class="flex gap-2 justify-end w-full">
          <UButton label="Annuler" color="neutral" variant="ghost" @click="close" />
          <UButton
            id="deck-delete-confirm"
            label="Supprimer"
            color="error"
            icon="i-lucide-trash-2"
            :loading="deleting"
            @click="confirmDelete"
          />
        </div>
      </template>
    </UModal>

    <!-- ranger dans un deckbox -->
    <DeckboxRangeModal
      v-model:open="rangeOpen"
      :deck-id="rangeDeckId"
      :applying="rangeApplying"
      @confirm="onRangeConfirm"
    />
  </AppPage>
</template>

<script setup lang="ts">
import { listDecks, createDeck, renameDeck, deleteDeck, type DeckListItem } from '~/services/decks'
import { applyDeckToDeckbox, type DeckLinkPlan } from '~/services/deckLink'

const router = useRouter()
const toast = useToast()

const decks = ref<DeckListItem[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    decks.value = await listDecks('ygo')
  } finally {
    loading.value = false
  }
}

function openDeck(d: DeckListItem) {
  router.push(`/decks/${d.id}`)
}

// ── création ──
const createOpen = ref(false)
const createName = ref('')
const creating = ref(false)

function openCreate() {
  createName.value = ''
  createOpen.value = true
}

async function confirmCreate() {
  if (!createName.value.trim()) return
  creating.value = true
  try {
    const id = await createDeck('ygo', createName.value)
    createOpen.value = false
    toast.add({ title: 'Deck créé', icon: 'i-lucide-check', color: 'success' })
    router.push(`/decks/${id}`)
  } catch {
    toast.add({ title: 'Échec de la création', color: 'error' })
  } finally {
    creating.value = false
  }
}

// ── renommage ──
const renameOpen = ref(false)
const renameValue = ref('')
const renaming = ref(false)
const pendingRename = ref<DeckListItem | null>(null)

function askRename(d: DeckListItem) {
  pendingRename.value = d
  renameValue.value = d.name
  renameOpen.value = true
}

async function confirmRename() {
  const d = pendingRename.value
  if (!d || !renameValue.value.trim()) return
  renaming.value = true
  try {
    await renameDeck(d.id, renameValue.value)
    renameOpen.value = false
    toast.add({ title: 'Deck renommé', icon: 'i-lucide-check', color: 'success' })
    await load()
  } catch {
    toast.add({ title: 'Échec du renommage', color: 'error' })
  } finally {
    renaming.value = false
    pendingRename.value = null
  }
}

// ── suppression ──
const deleteOpen = ref(false)
const deleting = ref(false)
const pendingDelete = ref<DeckListItem | null>(null)

function askDelete(d: DeckListItem) {
  pendingDelete.value = d
  deleteOpen.value = true
}

async function confirmDelete() {
  const d = pendingDelete.value
  if (!d) return
  deleting.value = true
  try {
    await deleteDeck(d.id)
    deleteOpen.value = false
    toast.add({ title: 'Deck supprimé', icon: 'i-lucide-check', color: 'success' })
    await load()
  } catch {
    toast.add({ title: 'Échec de la suppression', color: 'error' })
  } finally {
    deleting.value = false
    pendingDelete.value = null
  }
}

// ── ranger dans un deckbox ──
const rangeOpen = ref(false)
const rangeDeckId = ref('')
const rangeApplying = ref(false)

function askRange(d: DeckListItem) {
  rangeDeckId.value = d.id
  rangeOpen.value = true
}

async function onRangeConfirm(plan: DeckLinkPlan) {
  rangeApplying.value = true
  try {
    await applyDeckToDeckbox(rangeDeckId.value, plan.deckboxId, 'ygo')
    rangeOpen.value = false
    toast.add({
      title: `Deck rangé dans « ${plan.deckboxName} »`,
      icon: 'i-lucide-check',
      color: 'success',
    })
    await load()
  } catch (e) {
    toast.add({ title: 'Échec du rangement', color: 'error' })
  } finally {
    rangeApplying.value = false
  }
}

onMounted(load)
</script>
