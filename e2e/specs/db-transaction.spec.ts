import { resetDb, waitForApp } from './helpers.js'
import { browser } from '@wdio/globals'

// ============================================================
// PARCOURS : transaction SQLite après des requêtes simultanées.
// tauri-plugin-sql ouvre plusieurs connexions dès que des requêtes partent
// en même temps (démarrage de l'appli) et les prête à tour de rôle : sans
// précaution, BEGIN / INSERT / COMMIT tombaient sur des connexions
// différentes (« cannot commit - no transaction is active ») et la synchro
// échouait sur le 2e appareil, celui qui doit intégrer les données de
// l'autre. Export puis réimport d'une sauvegarde = même écriture.
// ============================================================

describe('Transactions SQLite', () => {
  before(async () => {
    await waitForApp()
    await resetDb()
    await browser.execute(async () => {
      await (window as any).__seedOwned('46986414', 2)
    })
  })

  it('une transaction tient après des requêtes simultanées', async () => {
    const res = await browser.execute(async () => {
      try {
        return await (window as any).__txProbe()
      } catch (e: any) {
        return { error: String(e?.message ?? e) }
      }
    })
    expect((res as any).error).toBeUndefined()
  })
})
