import {
  resetDb,
  waitFor,
  waitForPath,
  typeInto,
  countOf,
  click,
  waitForApp,
  attrOf,
  waitForAttr,
} from './helpers.js'
import { browser } from '@wdio/globals'

// ============================================================
// PARCOURS : interface mobile (fenêtre de 390×844 → mise en page
// téléphone). Barre d'onglets, bascule Cartes / Rangements, fiche carte
// en panneau du bas, deck en onglets avec ajout dans un panneau, partage,
// réglages empilés. Cibles via id/data-* uniquement (i18n-safe).
// ============================================================

const DM = '46986414'

describe('Interface mobile', () => {
  before(async () => {
    await waitForApp() // l'appli démarre en mode bureau (en-tête)
    await browser.setWindowSize(390, 844)
    await browser.waitUntil(async () => (await countOf('#mobile-tabbar')) === 1, {
      timeout: 10000,
      timeoutMsg: 'pas de barre d’onglets en 390 px',
    })
    await resetDb()
    await browser.execute(async (id: string) => {
      await (window as any).__seedOwned(id, 2)
    }, DM)
  })

  it('barre d’onglets : chaque onglet ouvre sa page (pas de scan hors Android)', async () => {
    expect(await countOf('header')).toBe(0)
    expect(await countOf('[data-tab]')).toBe(4)
    expect(await countOf('[data-tab="scan"]')).toBe(0)
    for (const [tab, path] of [
      ['search', '/search'],
      ['decks', '/decks'],
      ['share', '/share'],
      ['collection', '/collection'],
    ]) {
      await click(`[data-tab="${tab}"]`)
      await waitForPath((p) => p === path)
      expect(await attrOf(`[data-tab="${tab}"]`, 'data-active')).not.toBeNull()
    }
  })

  it('collection : rangements en grandes lignes, création, ouverture, retour', async () => {
    await click('[data-mobile-segment="containers"]')
    await waitFor('#container-create-btn')
    await click('#container-create-btn')
    await waitFor('[data-type="deckbox"]')
    await click('[data-type="deckbox"]')
    await typeInto('#container-name-input', 'Mobile box')
    await click('#container-create-confirm')
    await browser.waitUntil(
      async () => (await countOf('.container-item[data-container-name="Mobile box"]')) === 1,
      { timeout: 8000, timeoutMsg: 'rangement créé absent' }
    )
    await click('.container-item[data-container-name="Mobile box"]')
    await waitFor('[data-mobile-back-all]')
    await click('[data-mobile-back-all]')
    await waitFor(`.container-card[data-content-card-id]`)
  })

  it('fiche carte en panneau du bas : ajout rapide', async () => {
    await click('#container-content .container-card .card-thumb')
    await waitFor('#card-detail')
    const before = Number(await attrOf('#card-detail-owned', 'data-owned-count'))
    await click('#btn-quick-add')
    await waitForAttr('#card-detail-owned', 'data-owned-count', (v) => Number(v) === before + 1)
    // (browser.keys n'atteint pas le WebView de test : on ferme par le bouton)
    await click('#card-detail-close')
    await browser.waitUntil(async () => (await countOf('#card-detail')) === 0, { timeout: 5000 })
  })

  it('deck : onglets Main / Extra / Side, ajout de cartes dans un panneau', async () => {
    await click('[data-tab="decks"]')
    await waitForPath((p) => p === '/decks')
    await waitFor('#deck-create-empty, #deck-create-btn')
    await click((await countOf('#deck-create-empty')) ? '#deck-create-empty' : '#deck-create-btn')
    await typeInto('#deck-name-input', 'Mobile deck')
    await click('#deck-create-confirm')
    await waitForPath((p) => /^\/decks\/.+/.test(p))

    expect(await countOf('[data-mobile-board]')).toBe(3)
    await click('[data-mobile-board="extra"]')
    await waitFor('[data-board="extra"]')
    expect(await countOf('[data-board="main"]')).toBe(0) // une zone à la fois

    await click('[data-mobile-deck-add]')
    await waitFor('#deck-search-input')
    await typeInto('#deck-search-input', 'Dark Magician')
    await waitFor('.deck-search-result')
    await click('.deck-search-result')
    await waitForAttr('[data-mobile-board="main"]', 'data-board-count', (v) => v === '1')
    expect(await countOf('#card-detail')).toBe(0) // l'ajout n'ouvre pas la fiche par-dessus
    await click('[data-drawer-close]')
    await browser.waitUntil(async () => (await countOf('#deck-search-input')) === 0, {
      timeout: 5000,
    })
    await click('[data-mobile-board="main"]')
    await waitFor('[data-board="main"] .deck-board-card')
  })

  it('partage : bascule Montrer / Recevoir', async () => {
    await click('[data-tab="share"]')
    await waitForPath((p) => p === '/share')
    await waitFor('#share-generate-btn')
    await click('[data-mobile-share-section="receive"]')
    await waitFor('#share-import-input')
    expect(await countOf('#share-generate-btn')).toBe(0)
  })

  it('réglages : ouverts depuis la collection, toutes les sections empilées', async () => {
    await click('[data-tab="collection"]')
    await waitForPath((p) => p === '/collection')
    await click('#mobile-settings-btn')
    await waitForPath((p) => p === '/settings')
    for (const section of ['devices', 'backup', 'storage'])
      await waitFor(`[data-section-body="${section}"]`)
    expect(await countOf('[data-section]')).toBe(0) // pas de menu latéral
  })
})
