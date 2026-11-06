import { createGlobalState } from '@vueuse/core'
import { syncWithGoogle } from '~/services/userSync/cloud'
import { googleAccount, googleAvailable, GoogleError } from '~/services/userSync/google'
import { SyncError, type SyncReport } from '~/services/userSync'

// ============================================================
// État global de la synchro entre appareils (PC ↔ téléphone).
// `epoch` augmente quand une synchro a modifié la base locale : app.vue
// s'en sert pour remonter la page affichée (elle relit ses données).
// ============================================================

export const useDeviceSync = createGlobalState(() => {
  const syncing = ref(false)
  const epoch = ref(0)

  /**
   * Synchronise si un compte Google est connecté. `silent` : au lancement,
   * aucune erreur n'est remontée (hors ligne, accès retiré…).
   */
  async function run(silent = false): Promise<SyncReport | null> {
    if (syncing.value || !googleAvailable()) return null
    if (!(await googleAccount())) return null
    syncing.value = true
    try {
      const report = await syncWithGoogle()
      const changes = report.applied.inserted + report.applied.updated + report.applied.deleted
      if (changes) epoch.value++
      return report
    } catch (e) {
      if (silent) {
        console.warn('synchro au lancement impossible', e)
        return null
      }
      throw e
    } finally {
      syncing.value = false
    }
  }

  return { syncing, epoch, run }
})

/** Message lisible pour une erreur de synchro. */
export function syncErrorMessage(e: unknown): string {
  if (e instanceof GoogleError || e instanceof SyncError) return e.message
  return 'Synchronisation impossible (réseau ?)'
}
