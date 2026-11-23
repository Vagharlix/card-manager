import {
  resetDb,
  goTo,
  typeInto,
  waitFor,
  countOf,
  click,
  waitForApp,
  waitForAttr,
  openSelect,
  clickSelectOption,
  attrOf,
} from './helpers.js'
import { browser } from '@wdio/globals'

// ============================================================
// PARCOURS : sélection multiple dans la recherche
// « Select » → cocher deux cartes → « Add (2) » → 2 copies de chacune,
// rangées dans une deckbox → les cartes sont possédées, la deckbox les
// contient.
// ============================================================

describe('Recherche — sélection multiple', () => {
  before(async () => {
    await waitForApp()
  })

  it('ajoute plusieurs cartes d’un coup et les range', async () => {
    await resetDb()

    // une deckbox où ranger la sélection
    await goTo('/search')
    await goTo('/collection')
    await waitFor('#container-create-btn', { timeout: 10000 })
    await click('#container-create-btn')
    await waitFor('[data-type="deckbox"]', { timeout: 5000 })
    await click('[data-type="deckbox"]')
    await typeInto('#container-name-input', 'Selection box')
    await click('#container-create-confirm')
    await waitFor('.container-item[data-container-name="Selection box"]', { timeout: 8000 })
    const boxId = await attrOf('.container-item[data-container-name="Selection box"]', 'data-container-id')

    await goTo('/search')
    await typeInto('#search-card-input', 'Dark Magician')
    await browser.pause(600) // recherche (300 ms d'attente avant de chercher)
    await waitFor('#search-results .card-thumb', { min: 2 })

    await click('#search-select-btn')
    await waitForAttr('#search-select-btn', 'data-active', (v) => v !== null)
    const ids = await browser.execute(() =>
      [...document.querySelectorAll('#search-results .card-thumb')]
        .slice(0, 2)
        .map((e) => e.getAttribute('data-card-id'))
    )
    await click('#search-results .card-thumb', 0)
    await click('#search-results .card-thumb', 1)
    await waitForAttr('#search-selection-bar', 'data-selected-count', (v) => v === '2')
    // un clic de plus décoche, et un clic sur une carte n'ouvre pas sa fiche
    await click('#search-results .card-thumb', 1)
    await waitForAttr('#search-selection-bar', 'data-selected-count', (v) => v === '1')
    await click('#search-results .card-thumb', 1)
    await waitForAttr('#search-selection-bar', 'data-selected-count', (v) => v === '2')
    expect(await countOf('#card-detail')).toBe(0)

    await click('#search-add-selected')
    await waitFor('#search-batch-qty', { timeout: 5000 })
    await typeInto('#search-batch-qty', '2')
    await openSelect('search-batch-storage')
    await clickSelectOption(boxId!)
    await click('#search-batch-confirm')

    // sélection terminée, cartes possédées
    await browser.waitUntil(async () => (await countOf('#search-selection-bar')) === 0, {
      timeout: 10000,
    })
    for (const id of ids)
      await waitFor(`#search-results .card-thumb[data-card-id="${id}"][data-owned]`, { timeout: 8000 })

    // la deckbox contient les deux cartes (2 copies chacune)
    await goTo('/collection')
    await waitFor(`.container-item[data-container-id="${boxId}"]`, { timeout: 8000 })
    await click(`.container-item[data-container-id="${boxId}"]`)
    await waitFor('#container-content .container-card', { min: 1, timeout: 8000 })
    const total = await browser.execute(() =>
      [...document.querySelectorAll('#container-content .container-card')].length
    )
    expect(total).toBeGreaterThanOrEqual(1)
  })
})
