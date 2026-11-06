<template>
  <AppPage sidebar-label="Sections" title="Réglages" :mobile-sidebar="false">
    <template #leading>
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        size="lg"
        to="/collection"
        aria-label="Retour"
      />
    </template>
    <template #sidebar>
      <nav class="flex flex-col gap-1">
        <button
          v-for="section in sections"
          :key="section.id"
          :data-section="section.id"
          class="text-left px-3 py-2 rounded-md text-sm"
          :class="active === section.id ? 'bg-elevated text-primary' : 'hover:bg-elevated'"
          @click="active = section.id"
        >
          {{ section.label }}
        </button>
      </nav>
    </template>

    <!-- desktop : une section à la fois ; mobile : toutes à la suite, en cartes -->
    <div class="h-full overflow-y-auto" :class="isMobile && 'space-y-4 pb-6'">
      <!-- ── Collection ── -->
      <section v-if="show('collection')" :class="sectionClass">
        <h2 :class="titleClass">Ajout de cartes</h2>
        <p class="text-xs text-muted">
          Valeurs pré-remplies lors de l'ajout rapide d'une carte ({{ gameLabel }}).
        </p>

        <div class="space-y-1">
          <p class="text-sm font-medium">État par défaut</p>
          <USelect
            :model-value="games[GAME]?.defaultCondition"
            :items="conditionItems"
            :size="fieldSize"
            :class="fieldClass"
            @update:model-value="onDefaultCondition"
          />
        </div>

        <div class="space-y-1">
          <p class="text-sm font-medium">Langue par défaut</p>
          <USelect
            :model-value="games[GAME]?.defaultLanguage"
            :items="languageItems"
            :size="fieldSize"
            :class="fieldClass"
            @update:model-value="onDefaultLanguage"
          />
        </div>
      </section>

      <!-- ── Partage ── -->
      <section v-if="show('share')" :class="sectionClass">
        <h2 :class="titleClass">Partage</h2>
        <div class="space-y-1">
          <p class="text-sm font-medium">Mon nom</p>
          <p class="text-xs text-muted">Affiché chez ceux qui reçoivent ma collection.</p>
          <UInput
            id="settings-owner-name"
            v-model="ownerName"
            placeholder="Ton nom"
            :size="fieldSize"
            :class="fieldClass"
            @blur="saveOwnerName"
          />
        </div>
      </section>

      <!-- ── Apparence ── -->
      <section v-if="show('appearance')" :class="sectionClass">
        <h2 :class="titleClass">Apparence</h2>
        <div class="space-y-1">
          <p class="text-sm font-medium">Thème</p>
          <USelect
            id="settings-color-mode"
            v-model="colorMode.preference"
            :items="colorModeItems"
            :size="fieldSize"
            :class="fieldClass"
          />
        </div>
      </section>

      <!-- ── Synchronisation ── -->
      <section v-if="show('sync')" :class="sectionClass">
        <h2 :class="titleClass">Base de cartes</h2>

        <div class="space-y-1">
          <p class="text-sm font-medium">Base de cartes {{ gameLabel }}</p>
          <p class="text-xs text-muted" :data-sync-version="localVersion ?? ''">
            {{ localVersion ? `Version ${localVersion}` : 'Jamais synchronisée' }}
          </p>
        </div>

        <div class="flex flex-wrap gap-2" :class="isMobile && 'flex-col'">
          <UButton
            id="sync-check-btn"
            label="Vérifier les mises à jour"
            icon="i-lucide-refresh-cw"
            :size="fieldSize"
            :block="isMobile"
            :loading="isSyncing"
            @click="checkUpdates"
          />
          <UButton
            id="sync-force-btn"
            label="Tout retélécharger"
            icon="i-lucide-download"
            color="neutral"
            variant="soft"
            :size="fieldSize"
            :block="isMobile"
            :disabled="isSyncing"
            @click="forceResync"
          />
        </div>
        <p class="text-xs text-muted">
          Retélécharge toutes les cartes (réseau requis, quelques minutes). Collection et decks ne
          sont pas touchés.
        </p>
      </section>

      <!-- ── Stockage ── -->
      <section v-if="show('storage')" :class="sectionClass">
        <h2 :class="titleClass">Stockage</h2>

        <div class="space-y-1">
          <p class="text-sm font-medium">Cache d'images</p>
          <p id="image-cache-size" class="text-xs text-muted" :data-cache-bytes="cacheBytes ?? ''">
            {{ cacheBytes === null ? '…' : `${formatBytes(cacheBytes)} utilisés` }}
          </p>
        </div>

        <div class="space-y-1">
          <p class="text-sm font-medium">Limite du cache d'images (Mo)</p>
          <p class="text-xs text-muted">
            Au-delà, les images les moins récemment affichées sont supprimées (appliqué à
            l'enregistrement et à chaque lancement).
          </p>
          <UInput
            v-model.number="cacheLimit"
            type="number"
            min="0"
            :size="fieldSize"
            :class="isMobile ? 'w-full' : 'w-32'"
            @blur="saveCacheLimit"
          />
        </div>

        <div>
          <UButton
            id="image-cache-clear"
            label="Vider le cache d'images"
            icon="i-lucide-trash-2"
            color="error"
            variant="soft"
            :size="fieldSize"
            :block="isMobile"
            :loading="clearing"
            @click="clearCache"
          />
        </div>
      </section>

      <!-- ── Jeux ── -->
      <section v-if="show('games')" :class="sectionClass">
        <h2 :class="titleClass">Jeux</h2>

        <div class="space-y-1">
          <p class="text-sm font-medium">Jeu favori</p>
          <p class="text-xs text-muted">Ouvre directement ce jeu au lancement, sans demander.</p>
          <USelect
            :model-value="global.favoriteGame || NONE"
            :items="favoriteGameItems"
            :size="fieldSize"
            :class="fieldClass"
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
      </section>
    </div>
  </AppPage>
</template>

<script setup lang="ts">
import { gameDef, allGames } from '~/services/game'
import {
  imageCacheSize,
  clearImageCache,
  pruneImageCache,
  formatBytes,
} from '~/services/imageCache'
import { syncYgo, localSyncVersion, isSyncing } from '~/services/sync'
import { getShareOwnerName, setShareOwnerName } from '~/services/settings'

// un seul jeu pour l'instant ; quand un 2e arrive, la section Collection
// gagnera un sélecteur de jeu et GAME deviendra réactif.
const GAME = 'ygo'

const sections = [
  { id: 'collection', label: 'Ajout de cartes' },
  { id: 'share', label: 'Partage' },
  { id: 'appearance', label: 'Apparence' },
  { id: 'sync', label: 'Base de cartes' },
  { id: 'storage', label: 'Stockage' },
  { id: 'games', label: 'Jeux' },
]
const active = ref('collection')

const { isMobile } = useResponsive()
const show = (id: string) => isMobile.value || active.value === id
const sectionClass = computed(() =>
  isMobile.value
    ? 'space-y-4 rounded-2xl border border-default bg-elevated p-4'
    : 'space-y-6 max-w-md'
)
const titleClass = computed(() =>
  isMobile.value
    ? 'text-xs font-semibold text-muted uppercase tracking-wide'
    : 'text-lg font-medium'
)
const fieldSize = computed(() => (isMobile.value ? 'lg' : 'sm'))
const fieldClass = computed(() => (isMobile.value ? 'w-full' : 'w-56'))

// ── apparence ──
const colorMode = useColorMode()
const colorModeItems = [
  { label: 'Comme le système', value: 'system' },
  { label: 'Clair', value: 'light' },
  { label: 'Sombre', value: 'dark' },
]

// ── partage : nom affiché chez les autres (même réglage que la page Partage) ──
const ownerName = ref('')
async function saveOwnerName() {
  await setShareOwnerName(ownerName.value.trim())
}

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

// ── cache d'images ──
const cacheBytes = ref<number | null>(null)
const clearing = ref(false)

async function refreshCacheSize() {
  try {
    cacheBytes.value = await imageCacheSize()
  } catch {
    cacheBytes.value = null
  }
}

// limite persistée au blur (pas à chaque frappe), puis appliquée tout de suite
const cacheLimit = ref(global.imageCacheLimitMb)
async function saveCacheLimit() {
  await setImageCacheLimitMb(cacheLimit.value)
  try {
    await pruneImageCache(global.imageCacheLimitMb)
  } finally {
    await refreshCacheSize()
  }
}

async function clearCache() {
  clearing.value = true
  try {
    await clearImageCache()
    toast.add({ title: "Cache d'images vidé", icon: 'i-lucide-check', color: 'success' })
  } catch {
    toast.add({ title: 'Échec du vidage du cache', color: 'error' })
  } finally {
    clearing.value = false
    await refreshCacheSize()
  }
}

// ── synchronisation (la progression s'affiche dans l'overlay global d'app.vue) ──
const localVersion = ref<string | null>(null)

async function refreshVersion() {
  try {
    localVersion.value = await localSyncVersion()
  } catch {
    localVersion.value = null
  }
}

async function runSync(force: boolean) {
  try {
    await syncYgo({ force })
    toast.add({ title: 'Base de cartes à jour', icon: 'i-lucide-check', color: 'success' })
  } catch {
    // l'overlay d'app.vue affiche déjà l'erreur avec un bouton « Retry »
  } finally {
    await refreshVersion()
  }
}
const checkUpdates = () => runSync(false)
const forceResync = () => runSync(true)

onMounted(async () => {
  ownerName.value = await getShareOwnerName()
  refreshCacheSize()
  refreshVersion()
})
</script>
