import { resetDb, goTo, waitFor, click, waitForApp, typeInto, waitForPath } from '../specs/helpers.js'
import { browser } from '@wdio/globals'

// Captures d'écran en taille téléphone (pas un test : outil de revue UI).
// Lancer : xvfb-run -a npx wdio run ./wdio.conf.ts --spec ./screens/mobile.spec.ts
const OUT = process.env.SCREENS_DIR ?? './screens/out'
const W = Number(process.env.SCREEN_W ?? 390)
const H = Number(process.env.SCREEN_H ?? 844)

async function shot(name: string) {
  await browser.pause(700)
  await browser.saveScreenshot(`${OUT}/${name}.png`)
}

describe('captures mobile', () => {
  it('pages principales', async () => {
    await waitForApp()
    await browser.setWindowSize(W, H)
    if (process.env.SCREEN_DARK) {
      await browser.execute(() => {
        localStorage.setItem('nuxt-color-mode', 'dark')
        document.documentElement.classList.add('dark')
        document.documentElement.classList.remove('light')
      })
    }
    await resetDb()
    await browser.execute(async () => {
      const w = window as any
      for (const id of ['46986414', '89631139', '55144522', '38033121', '74677422', '70781052'])
        await w.__seedOwned(id, 2)
    })

    await goTo('/search')
    await goTo('/collection')
    await waitFor('#container-content')
    await shot('01-collection')

    await click('#container-content .container-card .card-thumb')
    await waitFor('#card-detail')
    await shot('02-card-detail')

    // onglet « Rangements » (avec un deckbox pour avoir du contenu)
    await click('[data-mobile-segment="containers"]')
    await click('#container-create-btn')
    await waitFor('[data-type="deckbox"]')
    await click('[data-type="deckbox"]')
    await typeInto('#container-name-input', 'Magiciens')
    await click('#container-create-confirm')
    await browser.pause(500)
    await goTo('/search')
    await goTo('/collection')
    await click('[data-mobile-segment="containers"]')
    await shot('03-containers')

    await goTo('/search')
    await waitFor('#search-card-input')
    await typeInto('#search-card-input', 'Dark')
    await shot('04-search')

    await goTo('/decks')
    await waitFor('#deck-create-empty, #deck-create-btn')
    await click('#deck-create-empty')
    await waitFor('#deck-name-input')
    await typeInto('#deck-name-input', 'Magiciens')
    await click('#deck-create-confirm')
    await waitForPath((p) => /^\/decks\/.+/.test(p))
    await shot('05-deck')
    await click('[data-mobile-deck-add]')
    await waitFor('#deck-search-input')
    await typeInto('#deck-search-input', 'Dark')
    await browser.pause(600)
    await shot('06-deck-add')

    await goTo('/decks')
    await shot('07-decks')

    await goTo('/share')
    await shot('08-share')
    await click('[data-mobile-share-section="receive"]')
    await shot('09-share-receive')

    await goTo('/settings')
    await shot('10-settings')

    await goTo('/scan')
    await shot('11-scan')
  })
})
