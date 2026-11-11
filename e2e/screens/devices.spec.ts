import { resetDb, goTo, waitFor, click, waitForApp } from '../specs/helpers.js'
import { browser } from '@wdio/globals'

// ============================================================
// Captures sur une série d'appareils (pas un test : revue d'affichage).
// Marges système simulées (variables --safe-*, comme le plugin Android),
// caméra incrustée dessinée en noir, charnière simulée (__testSegments).
// Lancer : SCREENS_DIR=/tmp/out xvfb-run -a npx wdio run ./wdio.conf.ts --spec ./screens/devices.spec.ts
// ============================================================

const OUT = process.env.SCREENS_DIR ?? './screens/out'

interface Device {
  name: string
  w: number
  h: number
  safe?: { top?: number; bottom?: number; left?: number; right?: number }
  hole?: { x: number; y: number; r: number } // caméra incrustée
  android?: boolean
  touch?: boolean
  segments?: { left: number; top: number; width: number; height: number }[]
}

const DEVICES: Device[] = [
  // Galaxy A52s 5G : 412 × 915, caméra incrustée en haut au centre
  {
    name: 'a52s',
    w: 412,
    h: 915,
    safe: { top: 36, bottom: 24 },
    hole: { x: 206, y: 16, r: 11 },
    android: true,
  },
  // même téléphone couché : la caméra passe sur le côté gauche
  {
    name: 'a52s-paysage',
    w: 915,
    h: 412,
    safe: { left: 36, bottom: 16 },
    hole: { x: 18, y: 206, r: 11 },
    android: true,
    touch: true,
  },
  // écran externe d'un pliable (très étroit)
  {
    name: 'fold-externe',
    w: 280,
    h: 653,
    safe: { top: 30, bottom: 16 },
    hole: { x: 140, y: 14, r: 9 },
    android: true,
  },
  // pliable déplié (Galaxy Z Fold, Oppo Find N) : presque carré
  {
    name: 'fold-deplie',
    w: 690,
    h: 830,
    safe: { top: 30, bottom: 16 },
    hole: { x: 600, y: 14, r: 9 },
    android: true,
  },
  {
    name: 'fold-deplie-paysage',
    w: 830,
    h: 690,
    safe: { top: 30, bottom: 16 },
    android: true,
    touch: true,
  },
  // Surface Duo étalé sur ses deux écrans, charnière de 34 px
  {
    name: 'duo-etale',
    w: 1114,
    h: 720,
    android: true,
    touch: true,
    segments: [
      { left: 0, top: 0, width: 540, height: 720 },
      { left: 574, top: 0, width: 540, height: 720 },
    ],
  },
  { name: 'tablette', w: 800, h: 1280, safe: { top: 24, bottom: 16 }, android: true, touch: true },
]

// drapeaux (Android, tactile) puis rechargement : ils sont lus au démarrage
async function boot(d: Device) {
  await browser.setWindowSize(d.w, d.h)
  await browser.execute((dev: Device) => {
    localStorage.setItem('__forceAndroid', dev.android ? '1' : '0')
    localStorage.setItem('__forceTouch', dev.touch ? '1' : '0')
    location.reload()
  }, d)
  await browser.pause(1500)
  await waitFor('main', { timeout: 30000 })
}

async function setup(d: Device) {
  await browser.execute((dev: Device) => {
    const s = document.documentElement.style
    s.setProperty('--safe-top', `${dev.safe?.top ?? 0}px`)
    s.setProperty('--safe-bottom', `${dev.safe?.bottom ?? 0}px`)
    s.setProperty('--safe-left', `${dev.safe?.left ?? 0}px`)
    s.setProperty('--safe-right', `${dev.safe?.right ?? 0}px`)
    ;(window as any).__testSegments = dev.segments
    document.getElementById('__hole')?.remove()
    if (dev.hole) {
      const el = document.createElement('div')
      el.id = '__hole'
      el.style.cssText = `position:fixed;z-index:99999;pointer-events:none;border-radius:50%;background:#000;
        left:${dev.hole.x - dev.hole.r}px;top:${dev.hole.y - dev.hole.r}px;width:${2 * dev.hole.r}px;height:${2 * dev.hole.r}px`
      document.body.appendChild(el)
    }
    window.dispatchEvent(new Event('resize'))
  }, d)
}

async function shot(d: Device, page: string) {
  await browser.pause(800)
  await browser.saveScreenshot(`${OUT}/${d.name}-${page}.png`)
}

describe('captures multi-appareils', () => {
  // les drapeaux restent dans le stockage du WebView de test : on les retire
  // pour ne pas fausser les parcours E2E lancés ensuite
  after(async () => {
    await browser.execute(() => {
      localStorage.removeItem('__forceAndroid')
      localStorage.removeItem('__forceTouch')
    })
  })

  it('pages principales sur chaque appareil', async () => {
    await waitForApp()
    await resetDb()
    await browser.execute(async () => {
      const w = window as any
      for (const id of ['46986414', '89631139', '55144522', '38033121', '74677422', '70781052'])
        await w.__seedOwned(id, 2)
    })
    for (const d of DEVICES) {
      await boot(d)
      await setup(d)
      await goTo('/search')
      await goTo('/collection')
      await setup(d)
      await waitFor('#container-content')
      await shot(d, '1-collection')

      await click('#container-content .container-card .card-thumb')
      await waitFor('#card-detail')
      await shot(d, '2-fiche')
      await click('#card-detail-close')
      await browser.pause(400)

      await goTo('/search')
      await setup(d)
      await waitFor('#search-card-input')
      await waitFor('[data-search-pagination]')
      await shot(d, '3-recherche')
    }
  })
})
