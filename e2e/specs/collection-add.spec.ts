import {
  resetDb,
  goTo,
  typeInto,
  waitFor,
  click,
  waitForApp,
  attrOf,
  waitForAttr,
} from './helpers.js'

// ============================================================
// PARCOURS : ajouter une carte à la collection
// Cibles + assertions via id/data-* uniquement (jamais de texte d'UI),
// pour rester valide quelle que soit la langue de l'app.
// ============================================================

const CARD_QUERY = 'Dark Magician'

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

    // 4. attendre que la vue détail soit prête (compteur exposé en data-*)
    await waitFor('#card-detail', { timeout: 10000 })
    await waitForAttr('#card-detail-owned', 'data-owned-count', (v) => v !== null)

    // 5. cliquer "Ajouter" et attendre que le compteur passe à 1 (data-*)
    await click('#btn-quick-add')
    await waitForAttr('#card-detail-owned', 'data-owned-count', (v) => Number(v) >= 1, 8000)
  })
})
