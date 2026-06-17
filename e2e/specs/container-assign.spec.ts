import { resetDb, goTo, typeInto, waitFor, countOf, click, waitForApp, attrOf } from './helpers.js'
import { browser } from '@wdio/globals'

// ============================================================
// PARCOURS : ranger une carte dans un deckbox, puis l'en retirer
// Tout via id/data-* (i18n-safe).
// ============================================================

const CARD_QUERY = 'Dark Magician'
const BOX_NAME = 'Deckbox Range'

// helper local : ajoute une carte à la collection via la recherche
async function addCardToCollection() {
  await goTo('/search')
  await waitFor('#search-card-input')
  await typeInto('#search-card-input', CARD_QUERY)
  await waitFor('#search-results .card-thumb', { timeout: 15000 })
  await click('#search-results .card-thumb', 0)
  await waitFor('#card-detail', { timeout: 10000 })
  await browser.waitUntil(
    async () => (await attrOf('#card-detail-owned', 'data-owned-count')) !== null,
    { timeout: 10000 }
  )
  await click('#btn-quick-add')
  await browser.waitUntil(
    async () => Number(await attrOf('#card-detail-owned', 'data-owned-count')) >= 1,
    { timeout: 8000, timeoutMsg: "la carte n'a pas été ajoutée" }
  )
}

// helper local : crée une deckbox depuis /collection, retourne son id
async function createDeckbox(name: string): Promise<string> {
  await click('#container-create-btn')
  await waitFor('[data-type="deckbox"]', { timeout: 5000 })
  await click('[data-type="deckbox"]')
  await typeInto('#container-name-input', name)
  await click('#container-create-confirm')
  await browser.waitUntil(
    async () => (await countOf(`.container-item[data-container-name="${name}"]`)) === 1,
    { timeout: 8000, timeoutMsg: 'deckbox non créée' }
  )
  const id = await browser.execute((n: string) => {
    const el = document.querySelector(`.container-item[data-container-name="${n}"]`)
    return el?.getAttribute('data-container-id') ?? null
  }, name)
  if (!id) throw new Error('id deckbox introuvable')
  return id
}

describe('Conteneurs — ranger / retirer une carte', () => {
  before(async () => {
    await waitForApp()
  })

  beforeEach(async () => {
    await resetDb()
  })

  it("range une carte dans un deckbox puis l'en retire", async () => {
    // 1. avoir une carte en collection (donc "non rangée")
    await addCardToCollection()

    // 2. créer un deckbox depuis /collection
    await goTo('/collection')
    await waitFor('#container-create-btn', { timeout: 10000 })
    const boxId = await createDeckbox(BOX_NAME)

    // après création, le deckbox vide est auto-sélectionné : revenir aux "non rangées"
    await click('[data-container-id="__unranged__"]')

    // 3. ouvrir le détail de la carte non rangée
    await waitFor('#container-content .container-card', { timeout: 8000 })
    const cardId = await attrOf('#container-content .container-card', 'data-content-card-id')
    if (!cardId) throw new Error('carte non rangée introuvable')
    await click('#container-content .container-card .card-thumb', 0)

    // 4. dans le détail, cliquer "Ranger" → picker
    await waitFor('#btn-range-card', { timeout: 8000 })
    await click('#btn-range-card')

    // 5. choisir le deckbox dans le picker et confirmer
    await waitFor(`[data-picker-container-id="${boxId}"]`, { timeout: 5000 })
    await click(`[data-picker-container-id="${boxId}"]`)
    await click('#picker-confirm')

    // 6. repartir d'un état propre (ferme picker + détail), puis sélectionner le deckbox
    await goTo('/collection')
    await waitFor(`.container-item[data-container-id="${boxId}"]`, { timeout: 8000 })
    await click(`.container-item[data-container-id="${boxId}"]`)

    // 7. la carte apparaît dans le deckbox
    await browser.waitUntil(
      async () =>
        (await countOf(`#container-content .container-card[data-content-card-id="${cardId}"]`)) ===
        1,
      { timeout: 8000, timeoutMsg: "la carte n'apparaît pas dans le deckbox" }
    )

    // 8. la retirer
    await click(`[data-unassign="${cardId}"]`)
    await waitFor('#unassign-confirm', { timeout: 5000 })
    await click('#unassign-confirm')

    // 9. le deckbox est de nouveau vide
    await browser.waitUntil(
      async () =>
        (await countOf(`#container-content .container-card[data-content-card-id="${cardId}"]`)) ===
        0,
      { timeout: 8000, timeoutMsg: "la carte n'a pas été retirée du deckbox" }
    )
  })
})
