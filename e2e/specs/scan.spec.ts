import { resetDb, goTo, waitFor, countOf, click, waitForApp, waitForAttr } from './helpers.js'
import { browser } from '@wdio/globals'

// ============================================================
// PARCOURS : scan de cartes (sans caméra)
// La caméra et ML Kit n'existent que sur Android ; en mode test, la
// page expose window.__scanFeed(lignes OCR) qui alimente la VRAIE
// chaîne identification → stabilisation → ajout en collection.
// Cibles via id/data-* uniquement (i18n-safe).
// ============================================================

const DM_LOB = '46986421' // carte de l'impression LOB-EN005 dans la fixture
const POT = '55144522' // Pot of Greed, impression MP25-EN050

const DM_FRAME = [
  { text: 'Dark Magician', y: 10 },
  { text: 'LOB-EN005', y: 300 },
]
const POT_FRAME = [{ text: 'MP25-EN050', y: 300 }]
const EMPTY: { text: string }[] = []

async function feed(lines: { text: string; y?: number }[]): Promise<void> {
  const res = await browser.execute(async (l: unknown) => {
    const w = window as any
    if (!w.__scanFeed) return 'absent'
    await w.__scanFeed(l)
    return 'ok'
  }, lines)
  if (res !== 'ok') throw new Error('__scanFeed absent')
}

const count = () =>
  browser.execute(() =>
    document.querySelector('[data-scan-count]')?.getAttribute('data-scan-count')
  )

describe('Scan de cartes', () => {
  before(async () => {
    await waitForApp()
    await resetDb()
  })

  it('ajoute une carte stable, une seule fois, puis un 2e exemplaire après retrait', async () => {
    await goTo('/search')
    await goTo('/scan')
    await waitFor('#scan-view')
    await browser.waitUntil(async () => browser.execute(() => !!(window as any).__scanFeed), {
      timeout: 5000,
      timeoutMsg: '__scanFeed non exposé',
    })

    // 1 image : pas encore confirmé ; 2 images : ajoutée
    await feed(DM_FRAME)
    expect(await count()).toBe('0')
    await feed(DM_FRAME)
    await waitForAttr('[data-scan-count]', 'data-scan-count', (v) => v === '1')
    expect(await countOf(`[data-scan-entry="${DM_LOB}"]`)).toBe(1)

    // la carte reste sous la caméra : pas de doublon
    await feed(DM_FRAME)
    await feed(DM_FRAME)
    expect(await count()).toBe('1')

    // retirée puis reposée : 2e exemplaire
    for (let i = 0; i < 3; i++) await feed(EMPTY)
    await feed(DM_FRAME)
    await feed(DM_FRAME)
    await waitForAttr('[data-scan-count]', 'data-scan-count', (v) => v === '2')

    // annuler le dernier ajout
    await click('[data-scan-undo]')
    await waitForAttr('[data-scan-count]', 'data-scan-count', (v) => v === '1')
  })

  it('mode manuel : la carte reconnue attend le bouton « Ajouter »', async () => {
    await click('#scan-auto-add')
    await feed(POT_FRAME)
    await feed(POT_FRAME)
    await browser.pause(300)
    expect(await count()).toBe('1')
    await click('#scan-add-btn')
    await waitForAttr('[data-scan-count]', 'data-scan-count', (v) => v === '2')
    expect(await countOf(`[data-scan-entry="${POT}"]`)).toBe(1)
  })
})
