<template>
  <AppPage sidebar-label="Sections">
    <template #sidebar>
      <nav class="flex flex-col gap-1">
        <button
          v-for="section in sections"
          :key="section.id"
          class="text-left px-3 py-2 rounded-md text-sm"
          :class="active === section.id ? 'bg-elevated text-primary' : 'hover:bg-elevated'"
          @click="active = section.id"
        >
          {{ section.label }}
        </button>
      </nav>
    </template>

    <!-- ── Jeux ── -->
    <div v-if="active === 'games'" class="space-y-6 max-w-md">
      <h2 class="text-lg font-medium">Jeux</h2>

      <div class="space-y-1">
        <p class="text-sm font-medium">Jeu favori</p>
        <p class="text-xs text-muted">Ouvre directement ce jeu au lancement, sans demander.</p>
        <USelect
          :model-value="global.favoriteGame || NONE"
          :items="favoriteGameItems"
          size="sm"
          class="w-56"
          @update:model-value="onFavoriteGame"
        />
      </div>

      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm font-medium">Afficher le sélecteur de jeu</p>
          <p class="text-xs text-muted">Proposer le choix du jeu à l'ouverture.</p>
        </div>
        <USwitch :model-value="global.showGamePicker" @update:model-value="onShowGamePicker" />
      </div>
    </div>

    <!-- ── Collection ── -->
    <div v-else-if="active === 'collection'" class="space-y-6 max-w-md">
      <h2 class="text-lg font-medium">Collection</h2>
      <p class="text-xs text-muted">
        Valeurs pré-remplies lors de l'ajout rapide d'une carte ({{ gameLabel }}).
      </p>

      <div class="space-y-1">
        <p class="text-sm font-medium">État par défaut</p>
        <USelect
          :model-value="games[GAME]?.defaultCondition"
          :items="conditionItems"
          size="sm"
          class="w-56"
          @update:model-value="onDefaultCondition"
        />
      </div>

      <div class="space-y-1">
        <p class="text-sm font-medium">Langue par défaut</p>
        <USelect
          :model-value="games[GAME]?.defaultLanguage"
          :items="languageItems"
          size="sm"
          class="w-56"
          @update:model-value="onDefaultLanguage"
        />
      </div>
    </div>

    <!-- ── Stockage ── -->
    <div v-else-if="active === 'storage'" class="space-y-6 max-w-md">
      <h2 class="text-lg font-medium">Stockage</h2>

      <div class="space-y-1">
        <p class="text-sm font-medium">Limite du cache d'images (Mo)</p>
        <p class="text-xs text-muted">Enregistré quand le champ perd le focus.</p>
        <UInput
          v-model.number="cacheLimit"
          type="number"
          min="0"
          size="sm"
          class="w-32"
          @blur="saveCacheLimit"
        />
      </div>

      <div>
        <UButton
          label="Vider le cache d'images"
          icon="i-lucide-trash-2"
          color="neutral"
          variant="soft"
          size="sm"
          @click="clearCache"
        />
        <p class="text-xs text-muted mt-1">Action à implémenter (Phase 9).</p>
      </div>
    </div>

    <!-- ── Synchronisation ── -->
    <div v-else-if="active === 'sync'" class="space-y-4 max-w-md">
      <h2 class="text-lg font-medium">Synchronisation</h2>
      <p class="text-xs text-muted">
        Bientôt : resync manuelle forcée, vérification d'une mise à jour au focus de l'app.
      </p>
    </div>
  </AppPage>
</template>

<script setup lang="ts">
import { gameDef, allGames } from '~/services/game'

// un seul jeu pour l'instant ; quand un 2e arrive, la section Collection
// gagnera un sélecteur de jeu et GAME deviendra réactif.
const GAME = 'ygo'

const sections = [
  { id: 'games', label: 'Jeux' },
  { id: 'collection', label: 'Collection' },
  { id: 'storage', label: 'Stockage' },
  { id: 'sync', label: 'Synchronisation' },
]
const active = ref('games')

const {
  global,
  games,
  ensureLoaded,
  ensureGame,
  setFavoriteGame,
  setShowGamePicker,
  setImageCacheLimitMb,
  setGameDefault,
} = useSettings()

// chargement avant rendu (page = Suspense Nuxt, top-level await OK)
await ensureLoaded()
await ensureGame(GAME)

const toast = useToast()

// ── items dérivés du REGISTRE (source unique de vérité) ──
// NONE : Reka UI interdit un item avec value='' (réservé au clear/placeholder),
// donc on utilise une sentinelle qu'on retraduit en '' au stockage.
const NONE = '__none__'
const favoriteGameItems = [
  { label: 'Aucun', value: NONE },
  ...allGames().map((g) => ({ label: g.label, value: g.id })),
]
const def = gameDef(GAME)
const gameLabel = def.label
const conditionItems = def.conditions.map((c) => ({ label: c.label, value: c.id }))
const languageItems = def.languages.map((l) => ({ label: l.label, value: l.id }))

// ── handlers write-through (typés string/bool comme onFormatChange) ──
const onFavoriteGame = (v: string) => setFavoriteGame(v === NONE ? '' : v)
const onShowGamePicker = (v: boolean) => setShowGamePicker(v)
const onDefaultCondition = (v: string) => setGameDefault(GAME, 'default_condition', v)
const onDefaultLanguage = (v: string) => setGameDefault(GAME, 'default_language', v)

// ── limite de cache : persistée au blur (pas à chaque frappe) ──
const cacheLimit = ref(global.imageCacheLimitMb)
async function saveCacheLimit() {
  await setImageCacheLimitMb(cacheLimit.value)
}

function clearCache() {
  // TODO Phase 9 : service de vidage du cache d'images
  toast.add({ title: 'Vidage du cache : à implémenter', color: 'warning' })
}
</script>
