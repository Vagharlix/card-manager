<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

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
import { syncYgo, syncProgress, syncStatus, syncError, isSyncing } from '~/services/sync'

async function retry() {
  syncError.value = null
  await runSync()
}

async function runSync() {
  try {
    await syncYgo()
  } catch {}
}

onMounted(runSync)
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
