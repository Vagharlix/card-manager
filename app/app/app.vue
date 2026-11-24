<template>
  <!-- mobile : notifications en haut, pour ne pas couvrir les onglets -->
  <UApp :toaster="toaster">
    <NuxtLayout>
      <!-- après une synchro qui a modifié la base, la page est remontée (relit ses données) -->
      <NuxtPage :page-key="pageKey" />
    </NuxtLayout>
    <GameLaunchModal />
    <!-- mise à jour d'une base de cartes, même la 1re installation : en
         arrière-plan, l'appli reste utilisable (même chose pour tous les jeux) -->
    <Transition name="fade">
      <div
        v-if="isSyncing"
        data-card-update
        :data-progress="syncProgress"
        :data-first-install="syncFirstInstall || undefined"
        class="fixed z-40 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-elevated border border-default shadow text-xs text-muted pointer-events-none"
        :style="{
          bottom: isMobile
            ? 'calc(4.5rem + var(--safe-bottom))'
            : 'calc(1rem + var(--safe-bottom))',
        }"
      >
        <UIcon name="i-lucide-loader-circle" class="animate-spin shrink-0" />
        <span v-if="syncingLabel" class="font-medium text-default shrink-0">{{ syncingLabel }}</span>
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
  isSyncing,
  syncingGame,
  syncFirstInstall,
  cardDataInstalled,
} from '~/services/cardData'
import { gameDefOrNull } from '~/services/game'
import { getGlobalSettings } from '~/services/settings'
import { pruneImageCache } from '~/services/imageCache'
import { FOREGROUND_DELAY_MS } from '~/composables/useDeviceSync'

const { isMobile } = useResponsive()
const toast = useToast()
const deviceSync = useDeviceSync()
const { game, cardAspect } = useCurrentGame()
// format des cartes du jeu affiché : cases des vignettes, fiche, classeurs
watchEffect(() =>
  document.documentElement.style.setProperty('--card-aspect', String(cardAspect.value))
)
// remontée de la page : après une synchro qui a changé la base, au changement
// de jeu, ou à la fin de la 1re installation d'une base de cartes
const pageKey = (r: { fullPath: string }) =>
  `${r.fullPath}#${game.value}#${deviceSync.epoch.value}#${cardDataInstalled.value}`
// jeu en cours de mise à jour (pastille) : utile quand ce n'est pas celui affiché
const syncingLabel = computed(() =>
  syncingGame.value ? (gameDefOrNull(syncingGame.value)?.label ?? null) : null
)
// mobile : notifications en haut et brèves (elles passent sur le titre de la page)
const toaster = computed(() =>
  isMobile.value
    ? { position: 'top-center' as const, duration: 2500 }
    : { position: 'bottom-right' as const }
)

async function runSync() {
  // In E2E test mode the reference database is provided (copied from dev),
  // so we never sync — tests must not depend on the network.
  if (import.meta.env.VITE_TEST_MODE === 'true') return
  const current = game.value
  try {
    await syncCardData(current, { auto: true })
  } catch (e) {
    // en arrière-plan : on le signale ; « Retry » tout de suite, sinon au
    // prochain lancement (ou Réglages → Check for updates)
    toast.add({
      title: `${gameDefOrNull(current)?.label ?? 'Card'} update failed`,
      description: e instanceof Error ? e.message : String(e),
      color: 'warning',
      actions: [{ label: 'Retry', onClick: () => void runSync() }],
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
