import { createGlobalState } from '@vueuse/core'
import { syncWithGoogle } from '~/services/userSync/cloud'
import { googleAccount, googleAvailable, GoogleError } from '~/services/userSync/google'
import { SyncError, type SyncReport } from '~/services/userSync'

// ============================================================
// État global de la synchro entre appareils (PC ↔ téléphone).
// `epoch` augmente quand une synchro a modifié la base locale : app.vue
// s'en sert pour remonter la page affichée (elle relit ses données).
// ============================================================

// délai avant la synchro discrète au lancement et au retour dans l'appli
export const FOREGROUND_DELAY_MS = 1500

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
    let timer: ReturnType<typeof setTimeout> | null = null
    document.addEventListener('visibilitychange', () => {
      if (timer) clearTimeout(timer)
      timer = null
      if (document.visibilityState !== 'visible' || Date.now() - lastRun <= 120_000) return
      // un peu après le retour : les premières actions passent avant la
      // synchro (ses requêtes attendent leur tour dans la même file)
      timer = setTimeout(() => {
        timer = null
        if (document.visibilityState === 'visible') run(true)
      }, FOREGROUND_DELAY_MS)
    })
  }

  /** La base locale a été modifiée hors synchro (import, restauration) : pages à relire. */
  function dataChanged() {
    epoch.value++
  }

  return { syncing, epoch, run, watchForeground, dataChanged }
})

/** Message lisible pour une erreur de synchro. */
// message montré à l'utilisateur : le message prévu pour nos erreurs, sinon
// l'erreur brute (réseau côté Rust, base de données…) pour pouvoir la signaler
export function syncErrorMessage(e: unknown): string {
  if (e instanceof GoogleError || e instanceof SyncError) return e.message
  const detail = (e instanceof Error ? e.message : String(e ?? '')).trim()
  return detail ? `Sync failed: ${detail.slice(0, 300)}` : 'Sync failed (no connection?)'
}
