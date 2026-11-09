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
  let lastRun = 0

  /**
   * Synchronise si un compte Google est connecté. `silent` : au lancement,
   * aucune erreur n'est remontée (hors ligne, accès retiré…).
   */
  async function run(silent = false): Promise<SyncReport | null> {
    if (syncing.value || !googleAvailable()) return null
    if (!(await googleAccount())) return null
    syncing.value = true
    lastRun = Date.now()
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

  /**
   * Retour au premier plan (on revient sur l'appli après avoir utilisé
   * l'autre appareil) : synchro discrète, au plus toutes les 2 minutes.
   */
  function watchForeground() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRun > 120_000) run(true)
    })
  }

  /** La base locale a été modifiée hors synchro (import, restauration) : pages à relire. */
  function dataChanged() {
    epoch.value++
  }

  return { syncing, epoch, run, watchForeground, dataChanged }
})

/** Message lisible pour une erreur de synchro. */
export function syncErrorMessage(e: unknown): string {
  if (e instanceof GoogleError || e instanceof SyncError) return e.message
  return 'Sync failed (no connection?)'
}
