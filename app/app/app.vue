<template>
  <!-- mobile : notifications en haut, pour ne pas couvrir les onglets -->
  <UApp :toaster="toaster">
    <NuxtLayout>
      <!-- après une synchro qui a modifié la base, la page est remontée (relit ses données) -->
      <NuxtPage :page-key="pageKey" />
    </NuxtLayout>
    <GameLaunchModal />
    <!-- 1re installation d'une base de cartes : rien à afficher sans elle -->
    <Transition name="fade">
      <div
        v-if="syncBlocking && (isSyncing || syncError)"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      >
        <UCard class="w-80 flex flex-col items-center gap-4 p-8">
          <template v-if="syncError">
            <UAlert
              color="error"
              variant="soft"
              icon="i-lucide-circle-x"
              title="Sync failed"
              :description="syncError"
            />
            <UButton color="primary" label="Retry" icon="i-lucide-refresh-cw" @click="retry" />
          </template>
          <template v-else>
            <p class="text-sm text-muted text-center">{{ syncStatus }}</p>
            <UProgress :value="syncProgress" color="primary" size="sm" class="w-full" />
            <p class="text-xs text-muted">{{ syncProgress }}%</p>
          </template>
        </UCard>
      </div>
    </Transition>
    <!-- mise à jour d'une base existante : en arrière-plan, cartes consultables -->
    <Transition name="fade">
      <div
        v-if="isSyncing && !syncBlocking"
        data-card-update
        :data-progress="syncProgress"
        class="fixed z-40 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-elevated border border-default shadow text-xs text-muted pointer-events-none"
        :style="{
          bottom: isMobile
            ? 'calc(4.5rem + var(--safe-bottom))'
            : 'calc(1rem + var(--safe-bottom))',
        }"
      >
        <UIcon name="i-lucide-loader-circle" class="animate-spin shrink-0" />
        <span class="truncate max-w-64">{{ syncStatus }}</span>
        <span class="tabular-nums">{{ syncProgress }}%</span>
      </div>
    </Transition>
  </UApp>
</template>

<script setup lang="ts">
import {
  syncCardData,
  syncProgress,
  syncStatus,
  syncError,
  isSyncing,
  syncBlocking,
} from '~/services/cardData'
import { getGlobalSettings } from '~/services/settings'
import { pruneImageCache } from '~/services/imageCache'
import { FOREGROUND_DELAY_MS } from '~/composables/useDeviceSync'

const { isMobile } = useResponsive()
const toast = useToast()
const deviceSync = useDeviceSync()
const { game } = useCurrentGame()
// remontée de la page : après une synchro qui a changé la base, ou au changement de jeu
const pageKey = (r: { fullPath: string }) => `${r.fullPath}#${game.value}#${deviceSync.epoch.value}`
// mobile : notifications en haut et brèves (elles passent sur le titre de la page)
const toaster = computed(() =>
  isMobile.value
    ? { position: 'top-center' as const, duration: 2500 }
    : { position: 'bottom-right' as const }
)

async function retry() {
  syncError.value = null
  syncBlocking.value = false
  await runSync()
}

async function runSync() {
  // In E2E test mode the reference database is provided (copied from dev),
  // so we never sync — tests must not depend on the network.
  if (import.meta.env.VITE_TEST_MODE === 'true') return
  try {
    await syncCardData(game.value, { auto: true })
  } catch (e) {
    // en arrière-plan (base déjà là) : on le signale, on réessaiera
    if (!syncBlocking.value)
      toast.add({
        title: 'Card update failed',
        description: `${e instanceof Error ? e.message : String(e)} — it will be retried later.`,
        color: 'warning',
      })
  }
}

// applique la limite du cache d'images (réglage Stockage) au lancement, au
// plus une fois par jour : l'élagage parcourt tous les fichiers du cache
// (et la limite est aussi appliquée dès qu'on la change dans les réglages)
const PRUNE_KEY = 'imageCachePrunedAt'
const DAY_MS = 86_400_000
async function pruneCache() {
  try {
    const last = Number(localStorage.getItem(PRUNE_KEY) ?? 0)
    if (Date.now() - last < DAY_MS) return
  } catch {}
  try {
    const { imageCacheLimitMb } = await getGlobalSettings()
    await pruneImageCache(imageCacheLimitMb)
    try {
      localStorage.setItem(PRUNE_KEY, String(Date.now()))
    } catch {}
  } catch {}
}

// un autre jeu choisi : sa base de cartes peut ne jamais avoir été téléchargée
watch(game, () => runSync())

onMounted(async () => {
  await useSettings()
    .ensureLoaded()
    .catch(() => {})
  await runSync()
  // synchro entre appareils (si un compte Google est connecté), sans bruit,
  // et nettoyage du cache : un peu après l'ouverture, pour que la première
  // page lise ses données avant (même file de requêtes)
  setTimeout(() => {
    pruneCache()
    if (import.meta.env.VITE_TEST_MODE !== 'true') deviceSync.run(true)
  }, FOREGROUND_DELAY_MS)
  if (import.meta.env.VITE_TEST_MODE !== 'true') deviceSync.watchForeground()
})
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
