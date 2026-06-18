import {
  resetDb,
  goTo,
  waitForPath,
  typeInto,
  waitFor,
  countOf,
  click,
  waitForApp,
  attrOf,
  openSelect,
  clickSelectOption,
} from './helpers.js'
import { browser } from '@wdio/globals'

// ============================================================
// PARCOURS : ranger un deck dans une deckbox (deck ↔ deckbox)
// Un deck contenant une carte + cette MÊME carte possédée (seedée
// directement en base) + une deckbox → modal de rangement → choisir
// la deckbox → plan calculé → confirmer → la carte est physiquement
// dans la deckbox. Tout via id/data-* (i18n-safe).
//
// La carte possédée est seedée via window.__seedOwned(cardId) avec
// EXACTEMENT le card_id ajouté au deck : on ne dépend plus de l'ordre
// des résultats de recherche (qui diffère entre /search et la sidebar
// du deck pour les cartes à artworks multiples comme Dark Magician).
// ============================================================

const CARD_QUERY = 'Dark Magician'
const BOX_NAME = 'Box Range Deck'
const DECK_NAME = 'Deck À Ranger'

// crée un deck, l'ouvre, y ajoute le 1er résultat de recherche ;
// retourne le card_id réellement ajouté (lu sur le board Main).
async function createDeckAndAddFirstCard(name: string): Promise<string> {
  await goTo('/decks')
  await waitFor('#deck-create-empty', { timeout: 10000 })
  await click('#deck-create-empty')
  await waitFor('#deck-name-input', { timeout: 5000 })
  await typeInto('#deck-name-input', name)
  await click('#deck-create-confirm')
  await waitForPath((p) => /^\/decks\/.+/.test(p), 8000)
  await waitFor('#deck-search-input', { timeout: 8000 })
  await typeInto('#deck-search-input', CARD_QUERY)
  await waitFor('.deck-search-result', { timeout: 15000 })
  await click('.deck-search-result', 0)
  const cardSel = '[data-board="main"] .deck-board-card'
  await waitFor(cardSel, { timeout: 8000 })
  const cardId = await attrOf(cardSel, 'data-deck-card-id')
  if (!cardId) throw new Error('carte du deck sans data-deck-card-id')
  return cardId
}

// seed une copie possédée de cardId directement en base (plugin de test)
async function seedOwned(cardId: string): Promise<void> {
  const res = await browser.execute(async (id: string) => {
    const w = window as any
    if (!w.__seedOwned) return { error: '__seedOwned absent' }
    try {
      return await w.__seedOwned(id, 1)
    } catch (e: any) {
      return { error: String(e?.message ?? e) }
    }
  }, cardId)
  if ((res as any)?.error) throw new Error(`seedOwned: ${(res as any).error}`)
}

async function createDeckboxFromCollection(name: string): Promise<string> {
  await goTo('/collection')
  await waitFor('#container-create-btn', { timeout: 10000 })
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

describe('Decks — rangement dans une deckbox', () => {
  before(async () => {
    await waitForApp()
  })

  beforeEach(async () => {
    await resetDb()
  })

  it('range un deck dans une deckbox et la carte y atterrit', async () => {
    // 1. deck contenant une carte (on récupère son card_id réel)
    const cardId = await createDeckAndAddFirstCard(DECK_NAME)

    // 2. posséder EXACTEMENT cette carte (seed direct en base)
    await seedOwned(cardId)

    // 3. deckbox cible
    const boxId = await createDeckboxFromCollection(BOX_NAME)

    // 4. revenir sur le deck et ouvrir le modal de rangement
    await goTo('/decks')
    await waitFor(`.deck-card[data-deck-name="${DECK_NAME}"]`, { timeout: 8000 })
    await click(`.deck-card[data-deck-name="${DECK_NAME}"]`)
    await waitForPath((p) => /^\/decks\/.+/.test(p), 8000)
    await waitFor('#deck-range-btn', { timeout: 8000 })
    await click('#deck-range-btn')
    await waitFor('#deck-range-select', { timeout: 8000 })

    // 5. choisir la deckbox (combobox Reka, options téléportées)
    await openSelect('deck-range-select')
    await clickSelectOption(boxId)

    // 6. le plan se calcule → au moins 1 carte à placer
    await waitFor('[data-plan-total]', { timeout: 8000 })
    await browser.waitUntil(
      async () => Number(await attrOf('[data-plan-total]', 'data-plan-total')) >= 1,
      { timeout: 5000, timeoutMsg: 'le plan ne prévoit aucune carte à placer' }
    )

    // 7. confirmer le rangement
    await click('#deck-range-confirm')

    // 8. la carte est physiquement dans la deckbox
    await goTo('/collection')
    await waitFor(`.container-item[data-container-id="${boxId}"]`, { timeout: 8000 })
    await click(`.container-item[data-container-id="${boxId}"]`)
    await browser.waitUntil(
      async () =>
        (await countOf(`#container-content .container-card[data-content-card-id="${cardId}"]`)) ===
        1,
      { timeout: 8000, timeoutMsg: "la carte du deck n'est pas dans la deckbox" }
    )
  })
})
