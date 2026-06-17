import { resetDb, goTo, typeInto, waitFor, countOf, click, waitForApp, attrOf } from './helpers.js'
import { browser } from '@wdio/globals'

// ============================================================
// PARCOURS : placer une carte dans un slot de binder, puis l'en retirer
// Slots ciblés par position (data-slot-page/row/col), i18n-safe.
// ============================================================

const CARD_QUERY = 'Dark Magician'
const BINDER_NAME = 'Classeur Test'

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

// crée un binder (pages=1, 3x3) depuis /collection, retourne son id
async function createBinder(name: string): Promise<string> {
  await click('#container-create-btn')
  await waitFor('[data-type="binder"]', { timeout: 5000 })
  await click('[data-type="binder"]')
  await typeInto('#container-name-input', name)
  await waitFor('#container-pages-input', { timeout: 5000 })
  await typeInto('#container-pages-input', '1')
  await click('#container-create-confirm')
  await browser.waitUntil(
    async () => (await countOf(`.container-item[data-container-name="${name}"]`)) === 1,
    { timeout: 8000, timeoutMsg: 'binder non créé' }
  )
  const id = await browser.execute((n: string) => {
    const el = document.querySelector(`.container-item[data-container-name="${n}"]`)
    return el?.getAttribute('data-container-id') ?? null
  }, name)
  if (!id) throw new Error('id binder introuvable')
  return id
}

const SLOT0 = '.binder-slot[data-slot-page="0"][data-slot-row="0"][data-slot-col="0"]'

describe('Conteneurs — binder slots', () => {
  before(async () => {
    await waitForApp()
  })

  beforeEach(async () => {
    await resetDb()
  })

  it("place une carte dans un slot puis l'en retire", async () => {
    // 1. carte en collection
    await addCardToCollection()

    // 2. créer un binder (auto-sélectionné après création)
    await goTo('/collection')
    await waitFor('#container-create-btn', { timeout: 10000 })
    const binderId = await createBinder(BINDER_NAME)

    // 3. le binder affiche ses slots ; le slot (0,0) est vide
    await waitFor(SLOT0, { timeout: 8000 })
    await browser.waitUntil(async () => (await attrOf(SLOT0, 'data-slot-filled')) === 'false', {
      timeout: 5000,
      timeoutMsg: "le slot (0,0) n'est pas vide au départ",
    })

    // 4. cliquer le slot vide → le picker de cartes non rangées s'ouvre
    await click(SLOT0)
    await waitFor('.unranged-picker-card', { timeout: 8000 })
    const cardId = await attrOf('.unranged-picker-card', 'data-picker-card-id')
    if (!cardId) throw new Error('carte non rangée introuvable dans le picker')

    // 5. choisir la carte
    await click('.unranged-picker-card', 0)

    // 6. le slot (0,0) est maintenant occupé par la bonne carte
    await browser.waitUntil(async () => (await attrOf(SLOT0, 'data-slot-filled')) === 'true', {
      timeout: 8000,
      timeoutMsg: "le slot n'a pas été rempli",
    })
    const placedId = await attrOf(SLOT0, 'data-slot-card-id')
    if (placedId !== cardId) {
      throw new Error(`carte placée inattendue: ${placedId} ≠ ${cardId}`)
    }

    // 7. retirer la carte du slot
    await click(`[data-slot-clear="${cardId}"]`)

    // 8. le slot (0,0) est de nouveau vide
    await browser.waitUntil(async () => (await attrOf(SLOT0, 'data-slot-filled')) === 'false', {
      timeout: 8000,
      timeoutMsg: "le slot n'a pas été vidé",
    })
  })
})
