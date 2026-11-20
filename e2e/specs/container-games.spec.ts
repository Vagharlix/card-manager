import {
  resetDb,
  goTo,
  typeInto,
  waitFor,
  countOf,
  click,
  waitForApp,
  attrOf,
  openSelect,
  clickSelectOption,
  openContainerMenu,
  clickMenuAction,
} from './helpers.js'
import { browser } from '@wdio/globals'

// ============================================================
// PARCOURS : jeux d'un rangement (aucun, un ou plusieurs)
// Un rangement créé dans un jeu lui est associé par défaut : masqué dans
// l'autre jeu (« This game »), visible avec son badge en « All games ».
// Sans jeu (option décochée) : visible partout.
// ============================================================

const TAGGED = 'YGO only box'
const ANY = 'Any game box'

async function switchGame(id: string) {
  await openSelect('game-picker')
  await clickSelectOption(id)
  await browser.waitUntil(async () => (await attrOf('#game-picker', 'data-current-game')) === id, {
    timeout: 10000,
  })
  await waitFor('#container-create-btn', { timeout: 10000 })
}

async function createDeckbox(name: string, untag = false) {
  await click('#container-create-btn')
  await waitFor('[data-type="deckbox"]', { timeout: 5000 })
  await click('[data-type="deckbox"]')
  await typeInto('#container-name-input', name)
  if (untag) {
    // le jeu affiché est coché par défaut : on le décoche → tous les jeux
    await click('[data-container-game-option="ygo"]')
    await browser.waitUntil(
      async () => (await countOf('[data-container-game-option="ygo"][data-selected]')) === 0
    )
  }
  await click('#container-create-confirm')
  await waitFor(`.container-item[data-container-name="${name}"]`, { timeout: 8000 })
}

const shown = (name: string) => countOf(`.container-item[data-container-name="${name}"]`)

describe('Rangements — jeux', () => {
  before(async () => {
    await waitForApp()
  })

  after(async () => {
    // revenir à « This game » et à Yu-Gi-Oh! pour les specs suivants
    if (await countOf('[data-storage-filter="game"]')) await click('[data-storage-filter="game"]')
    if ((await attrOf('#game-picker', 'data-current-game')) !== 'ygo') await switchGame('ygo')
  })

  it('associé au jeu par défaut, masqué ailleurs, visible en « All games »', async () => {
    await resetDb()
    await goTo('/search')
    await goTo('/collection')
    await waitFor('#container-create-btn', { timeout: 10000 })
    await click('[data-storage-filter="game"]')

    await createDeckbox(TAGGED)
    await createDeckbox(ANY, true)

    await switchGame('mtg')
    await click('[data-storage-filter="game"]')
    await browser.waitUntil(async () => (await shown(TAGGED)) === 0, { timeout: 5000 })
    expect(await shown(ANY)).toBe(1)

    await click('[data-storage-filter="all"]')
    await browser.waitUntil(async () => (await shown(TAGGED)) === 1, { timeout: 5000 })
    expect(
      await attrOf(`.container-item[data-container-name="${TAGGED}"] [data-container-games]`, 'data-container-games')
    ).toBe('ygo')

    // l'associer aussi à Magic depuis Magic : visible en « This game »
    const id = await attrOf(`.container-item[data-container-name="${TAGGED}"]`, 'data-container-id')
    await openContainerMenu(id!)
    await clickMenuAction('edit')
    await waitFor('[data-container-game-option="mtg"]', { timeout: 5000 })
    await click('[data-container-game-option="mtg"]')
    await click('#container-edit-save')
    await click('[data-storage-filter="game"]')
    await browser.waitUntil(async () => (await shown(TAGGED)) === 1, { timeout: 8000 })
  })
})
