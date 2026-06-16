import { browser } from '@wdio/globals'
import {
  resetDb,
  goTo,
  typeInto,
  waitFor,
  click,
  textOf,
  waitForApp,
  waitForTextMatch,
} from './helpers.js'

// ============================================================
// PARCOURS : ajouter une carte à la collection
// ============================================================

const CARD_QUERY = 'Dark Magician'

// Lit le nombre du compteur "#card-detail-owned" (-1 si absent).
async function ownedCount(): Promise<number> {
  const txt = await textOf('#card-detail-owned')
  const m = txt.match(/(\d+)\s+dans ta collection/)
  return m ? parseInt(m[1], 10) : -1
}

describe('Collection — ajout de carte', () => {
  before(async () => {
    await waitForApp()
  })

  beforeEach(async () => {
    await resetDb()
  })

  it('ajoute une carte trouvée par recherche', async () => {
    // 1. page de recherche
    await goTo('/search')

    // 2. rechercher la carte
    await waitFor('#search-card-input')
    await typeInto('#search-card-input', CARD_QUERY)

    // 3. attendre les résultats et ouvrir la première carte
    await waitFor('#search-results .card-thumb', { timeout: 15000 })
    await click('#search-results .card-thumb', 0)

    // 4. attendre que la vue détail soit prête (signal déterministe)
    await waitFor('#card-detail', { timeout: 10000 })
    await waitForTextMatch('#card-detail-owned', (t) => /\d+\s+dans ta collection/.test(t))

    // 5. cliquer "Ajouter" et attendre que le compteur passe à 1
    await click('#btn-quick-add')
    await browser.waitUntil(async () => (await ownedCount()) >= 1, {
      timeout: 8000,
      timeoutMsg: "le compteur 'dans ta collection' n'a pas atteint 1",
    })
  })
})
