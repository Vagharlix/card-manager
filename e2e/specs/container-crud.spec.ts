import {
  resetDb,
  goTo,
  typeInto,
  waitFor,
  countOf,
  click,
  waitForApp,
  openContainerMenu,
  clickMenuAction,
} from './helpers.js'
import { browser } from '@wdio/globals'

// ============================================================
// PARCOURS : CRUD conteneur (deckbox)
// Création → apparition dans la sidebar → renommage → suppression.
// Cibles via id/data-* uniquement (i18n-safe).
// ============================================================

const NAME = 'Ma Deckbox Test'
const NAME2 = 'Deckbox Renommée'

// Nombre de conteneurs portant un nom donné (via data-container-name).
async function countByName(name: string): Promise<number> {
  return countOf(`.container-item[data-container-name="${name}"]`)
}

describe('Conteneurs — CRUD', () => {
  before(async () => {
    await waitForApp()
  })

  beforeEach(async () => {
    await resetDb()
    await goTo('/collection')
    await waitFor('#container-create-btn', { timeout: 10000 })
  })

  it('crée une deckbox, la renomme, puis la supprime', async () => {
    // ── création ──
    await click('#container-create-btn')
    await waitFor('[data-type="deckbox"]', { timeout: 5000 })
    await click('[data-type="deckbox"]')
    await typeInto('#container-name-input', NAME)
    await click('#container-create-confirm')

    // la deckbox apparaît dans la sidebar
    await browser.waitUntil(async () => (await countByName(NAME)) === 1, {
      timeout: 8000,
      timeoutMsg: "la deckbox créée n'apparaît pas",
    })

    // ── renommage ──
    const id = await browser.execute((n: string) => {
      const el = document.querySelector(`.container-item[data-container-name="${n}"]`)
      return el?.getAttribute('data-container-id') ?? null
    }, NAME)
    if (!id) throw new Error('id du conteneur introuvable')

    await openContainerMenu(id)
    await clickMenuAction('rename')
    await waitFor('#container-rename-input', { timeout: 5000 })
    await typeInto('#container-rename-input', NAME2)
    await click('#container-rename-confirm')

    await browser.waitUntil(
      async () => (await countByName(NAME2)) === 1 && (await countByName(NAME)) === 0,
      { timeout: 8000, timeoutMsg: "le renommage ne s'est pas reflété" }
    )

    // ── suppression ──
    await openContainerMenu(id)
    await clickMenuAction('delete')
    await waitFor('#container-delete-confirm', { timeout: 5000 })
    await click('#container-delete-confirm')

    await browser.waitUntil(async () => (await countByName(NAME2)) === 0, {
      timeout: 8000,
      timeoutMsg: "la deckbox n'a pas été supprimée",
    })
  })
})
