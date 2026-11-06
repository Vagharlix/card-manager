import { resetDb, goTo, waitFor, click, waitForApp } from '../specs/helpers.js'
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

    await goTo('/search')
    await waitFor('#search-card-input')
    await shot('03-search')

    await goTo('/decks')
    await waitFor('#deck-create-empty, #deck-create-btn')
    await shot('04-decks')

    await goTo('/share')
    await shot('05-share')

    await goTo('/settings')
    await shot('06-settings')

    await goTo('/scan')
    await shot('07-scan')

    await goTo('/collection')
    await browser.pause(400)
    // menu de navigation mobile
    await browser.execute(() => (document.querySelector('[aria-label="Menu"]') as HTMLElement)?.click())
    await shot('08-menu')
  })
})
