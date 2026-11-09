<template>
  <!-- mobile : notifications en haut, pour ne pas couvrir les onglets -->
  <UApp :toaster="toaster">
    <NuxtLayout>
      <!-- après une synchro qui a modifié la base, la page est remontée (relit ses données) -->
      <NuxtPage :page-key="pageKey" />
    </NuxtLayout>
    <GameLaunchModal />
    <Transition name="fade">
      <div
        v-if="isSyncing || syncError"
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
  </UApp>
</template>

<script setup lang="ts">
import { syncCardData, syncProgress, syncStatus, syncError, isSyncing } from '~/services/cardData'
import { getGlobalSettings } from '~/services/settings'
import { pruneImageCache } from '~/services/imageCache'

const { isMobile } = useResponsive()
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
  await runSync()
}

async function runSync() {
  // In E2E test mode the reference database is provided (copied from dev),
  // so we never sync — tests must not depend on the network.
  if (import.meta.env.VITE_TEST_MODE === 'true') return
  try {
    await syncCardData(game.value, { auto: true })
  } catch {}
}

// applique la limite du cache d'images (réglage Stockage) à chaque lancement
async function pruneCache() {
  try {
    const { imageCacheLimitMb } = await getGlobalSettings()
    await pruneImageCache(imageCacheLimitMb)
  } catch {}
}

// un autre jeu choisi : sa base de cartes peut ne jamais avoir été téléchargée
watch(game, () => runSync())

onMounted(async () => {
  await useSettings()
    .ensureLoaded()
    .catch(() => {})
  await runSync()
  await pruneCache()
  // synchro entre appareils (si un compte Google est connecté), sans bruit
  if (import.meta.env.VITE_TEST_MODE !== 'true') {
    await deviceSync.run(true)
    deviceSync.watchForeground()
  }
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
