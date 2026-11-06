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
  openMenu,
  clickMenuAction,
} from './helpers.js'
import { browser } from '@wdio/globals'

// ============================================================
// PARCOURS : construire un deck
// Créer un deck, ajouter une carte depuis la recherche, vérifier
// qu'elle est dans le Main Deck, l'incrémenter (+1), la retirer.
// Tout via id/data-* (i18n-safe).
// ============================================================

const DECK = 'Deck Build'
const CARD_QUERY = 'Dark Magician'

// crée un deck et navigue jusqu'à sa page ; retourne l'id (depuis l'URL)
async function createDeckAndOpen(name: string): Promise<string> {
  await goTo('/decks')
  await waitFor('#deck-create-empty', { timeout: 10000 })
  await click('#deck-create-empty')
  await waitFor('#deck-name-input', { timeout: 5000 })
  await typeInto('#deck-name-input', name)
  await click('#deck-create-confirm')
  // confirmCreate redirige vers /decks/:id
  await waitForPath((p) => /^\/decks\/.+/.test(p), 8000)
  const path = await browser.execute(() => window.location.pathname)
  const id = path.split('/').pop() as string
  // attendre que la page deck soit prête (champ de recherche de la sidebar)
  await waitFor('#deck-search-input', { timeout: 8000 })
  return id
}

const MAIN = '[data-board="main"]'

describe('Decks — construction', () => {
  before(async () => {
    await waitForApp()
  })

  beforeEach(async () => {
    await resetDb()
  })

  it("ajoute une carte au deck, l'incrémente, puis la retire", async () => {
    // 1. créer et ouvrir le deck
    await createDeckAndOpen(DECK)

    // 2. rechercher une carte dans la sidebar (watchDebounced 300ms)
    await typeInto('#deck-search-input', CARD_QUERY)
    await waitFor('.deck-search-result', { timeout: 15000 })
    const cardId = await attrOf('.deck-search-result', 'data-search-card-id')
    if (!cardId) throw new Error('aucun résultat de recherche')

    // 3. cliquer le premier résultat → ajout au deck
    await click('.deck-search-result', 0)

    // 4. la carte est dans le Main Deck avec quantité 1
    const cardSel = `${MAIN} .deck-board-card[data-deck-card-id="${cardId}"]`
    await waitFor(cardSel, { timeout: 8000 })
    await browser.waitUntil(async () => (await attrOf(cardSel, 'data-quantity')) === '1', {
      timeout: 5000,
      timeoutMsg: "la carte n'est pas en quantité 1",
    })

    // 5. incrémenter via le menu (+1) → quantité 2
    await openMenu(cardId)
    await clickMenuAction('add')
    await browser.waitUntil(async () => (await attrOf(cardSel, 'data-quantity')) === '2', {
      timeout: 5000,
      timeoutMsg: "la carte n'est pas passée à 2",
    })

    // 6. retirer via le menu (−1) → quantité 1
    await openMenu(cardId)
    await clickMenuAction('remove')
    await browser.waitUntil(async () => (await attrOf(cardSel, 'data-quantity')) === '1', {
      timeout: 5000,
      timeoutMsg: "la carte n'est pas redescendue à 1",
    })

    // 7. retirer le dernier exemplaire → la carte disparaît du Main
    await openMenu(cardId)
    await clickMenuAction('remove')
    await browser.waitUntil(async () => (await countOf(cardSel)) === 0, {
      timeout: 5000,
      timeoutMsg: "la carte n'a pas été retirée du deck",
    })
  })
})
