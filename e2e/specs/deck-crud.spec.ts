import {
  resetDb,
  goTo,
  waitForPath,
  typeInto,
  waitFor,
  countOf,
  click,
  waitForApp,
  openMenu,
  clickMenuAction,
} from './helpers.js'
import { browser } from '@wdio/globals'

// ============================================================
// PARCOURS : CRUD deck
// Teste les DEUX boutons de création (état vide + barre d'outils),
// puis renommage et suppression via le menu de la carte deck.
// Tout via id/data-* (i18n-safe).
// ============================================================

const DECK_A = 'Deck Alpha'
const DECK_A2 = 'Deck Alpha Renommé'
const DECK_B = 'Deck Beta'

async function countDeckByName(name: string): Promise<number> {
  return countOf(`.deck-card[data-deck-name="${name}"]`)
}

async function deckIdByName(name: string): Promise<string> {
  const id = await browser.execute((n: string) => {
    const el = document.querySelector(`.deck-card[data-deck-name="${n}"]`)
    return el?.getAttribute('data-deck-id') ?? null
  }, name)
  if (!id) throw new Error(`deck introuvable: ${name}`)
  return id
}

// crée un deck via un bouton donné, renseigne le nom, confirme, revient à /decks
async function createDeckVia(triggerSel: string, name: string) {
  await waitFor(triggerSel, { timeout: 8000 })
  await click(triggerSel)
  await waitFor('#deck-name-input', { timeout: 5000 })
  await typeInto('#deck-name-input', name)
  await click('#deck-create-confirm')
  // confirmCreate redirige vers /decks/:id ; attendre cette navigation interne
  await waitForPath((p) => /^\/decks\/.+/.test(p), 8000)
  // puis revenir à la liste (remonte le composant → onMounted(load) recharge)
  await goTo('/decks')
  await waitForPath((p) => p === '/decks', 8000)
  await browser.waitUntil(async () => (await countDeckByName(name)) === 1, {
    timeout: 8000,
    timeoutMsg: `le deck "${name}" n'apparaît pas après création`,
  })
}

describe('Decks — CRUD', () => {
  before(async () => {
    await waitForApp()
  })

  beforeEach(async () => {
    await resetDb()
    await goTo('/decks')
  })

  it('crée via les deux boutons, renomme, puis supprime', async () => {
    // 1. DB vide → l'état vide est affiché → bouton "Créer un deck"
    await createDeckVia('#deck-create-empty', DECK_A)

    // 2. il y a maintenant un deck → la barre d'outils est visible → bouton "Nouveau deck"
    await createDeckVia('#deck-create-btn', DECK_B)

    // les deux decks sont présents
    await browser.waitUntil(
      async () => (await countDeckByName(DECK_A)) === 1 && (await countDeckByName(DECK_B)) === 1,
      { timeout: 8000, timeoutMsg: 'les deux decks ne sont pas listés' }
    )

    // 3. renommer Deck Alpha via son menu
    const idA = await deckIdByName(DECK_A)
    await openMenu(idA) // ouvre [data-menu-trigger=idA], attend [data-menu-action]
    await clickMenuAction('rename')
    await waitFor('#deck-rename-input', { timeout: 5000 })
    await typeInto('#deck-rename-input', DECK_A2)
    await click('#deck-rename-confirm')
    await browser.waitUntil(
      async () => (await countDeckByName(DECK_A2)) === 1 && (await countDeckByName(DECK_A)) === 0,
      { timeout: 8000, timeoutMsg: "le renommage ne s'est pas reflété" }
    )

    // 4. supprimer Deck Beta via son menu
    const idB = await deckIdByName(DECK_B)
    await openMenu(idB)
    await clickMenuAction('delete')
    await waitFor('#deck-delete-confirm', { timeout: 5000 })
    await click('#deck-delete-confirm')
    await browser.waitUntil(
      async () => (await countDeckByName(DECK_B)) === 0 && (await countDeckByName(DECK_A2)) === 1,
      { timeout: 8000, timeoutMsg: "la suppression ne s'est pas reflétée" }
    )
  })
})
