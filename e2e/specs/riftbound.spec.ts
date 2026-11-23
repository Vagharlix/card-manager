import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  resetDb,
  goTo,
  typeInto,
  waitFor,
  waitForPath,
  countOf,
  click,
  waitForApp,
  attrOf,
  waitForAttr,
  openSelect,
  clickSelectOption,
  openMenu,
  clickMenuAction,
} from './helpers.js'
import { browser } from '@wdio/globals'

// ============================================================
// PARCOURS : Riftbound
// Bascule de jeu → base Riftbound remplie avec l'échantillon RiftHunt réel
// (vrai importeur, sans réseau) → recherche (filtres Riftbound) → fiche :
// choix de l'impression + ajout → deck : légende, runes, champs de
// bataille placés dans leur zone, champion choisi par le menu, règles du
// deck entier signalées ([data-deck-issue]) → retour à YGO.
// Cibles via id/data-* uniquement (i18n-safe).
// ============================================================

const SAMPLE = JSON.parse(
  readFileSync(
    join(process.cwd(), '..', 'app', 'test', 'unit', 'fixtures', 'rifthunt-sample.json'),
    'utf8'
  )
) as { bulk: { cards: any[] }; prints: unknown[] }
const printsOf = (name: string): string[] =>
  SAMPLE.bulk.cards.filter((c) => c.cleanName === name).map((c) => c.printing_id as string)
const base = (name: string): string =>
  SAMPLE.bulk.cards.find((c) => c.cleanName === name && c.variant === 'base')?.printing_id ??
  printsOf(name)[0]!

async function pickGame(id: string) {
  await openSelect('game-picker')
  await clickSelectOption(id)
  await browser.waitUntil(async () => (await attrOf('#game-picker', 'data-current-game')) === id, {
    timeout: 8000,
    timeoutMsg: `jeu ${id} non sélectionné`,
  })
}

async function issueCodes(): Promise<string[]> {
  return browser.execute(() =>
    [...document.querySelectorAll('[data-deck-issue]')].map(
      (e) => e.getAttribute('data-deck-issue') ?? ''
    )
  )
}

async function addFromSearch(query: string, cardId: string, times = 1) {
  await typeInto('#deck-search-input', query)
  await browser.waitUntil(
    async () => (await countOf(`.deck-search-result[data-search-card-id="${cardId}"]`)) > 0,
    { timeout: 8000, timeoutMsg: `résultat ${query} absent` }
  )
  for (let i = 0; i < times; i++) {
    await click(`.deck-search-result[data-search-card-id="${cardId}"]`)
    await browser.pause(150)
  }
}

describe('Riftbound', () => {
  before(async () => {
    await waitForApp()
    await resetDb()
    await pickGame('riftbound')
    const res = await browser.execute(async (sample: unknown) => {
      try {
        return await (window as any).__seedRiftbound(sample)
      } catch (e: any) {
        return { error: String(e?.message ?? e) }
      }
    }, SAMPLE as never)
    if ((res as any)?.error) throw new Error(`seedRiftbound: ${(res as any).error}`)
    expect((res as any).changed).toBe(SAMPLE.bulk.cards.length)
  })

  it('recherche : une ligne par carte, filtres Riftbound', async () => {
    await goTo('/search')
    await waitFor('[data-rb-filters]')
    await typeInto('#search-card-input', 'Jinx, Loose Cannon')
    await browser.waitUntil(async () => (await countOf('#search-results .card-thumb')) === 1, {
      timeout: 8000,
      timeoutMsg: 'une seule carte attendue',
    })
    expect(await attrOf('#search-results .card-thumb', 'data-card-id')).toBe(base('Jinx, Loose Cannon'))
  })

  it('fiche : choisir une impression puis l’ajouter', async () => {
    await click('#search-results .card-thumb')
    await waitFor('#card-detail')
    await waitFor('#card-printing-select')
    const other = printsOf('Jinx, Loose Cannon').find((p) => p !== base('Jinx, Loose Cannon'))!
    await openSelect('card-printing-select')
    await clickSelectOption(other)
    await waitForAttr('#card-detail-owned', 'data-owned-count', (v) => v === '0')
    await click('#btn-quick-add')
    await waitForAttr('#card-detail-owned', 'data-owned-count', (v) => v === '1')
    await click('#card-detail-close')
  })

  it('deck : zones Riftbound, champion choisi, règles du deck entier', async () => {
    await goTo('/decks')
    await waitFor('#deck-create-empty, #deck-create-btn')
    await click((await countOf('#deck-create-empty')) ? '#deck-create-empty' : '#deck-create-btn')
    await typeInto('#deck-name-input', 'Jinx')
    await click('#deck-create-confirm')
    await waitForPath((p) => /^\/decks\/.+/.test(p))

    for (const b of ['legend', 'champion', 'main', 'runes', 'battlefields', 'side'])
      expect(await countOf(`[data-board="${b}"]`)).toBe(1)
    expect(await countOf('[data-board="extra"]')).toBe(0)
    await browser.waitUntil(async () => (await issueCodes()).includes('legend'), {
      timeout: 8000,
      timeoutMsg: 'deck vide : règle « legend » attendue',
    })

    // légende → sa zone
    await addFromSearch('Jinx, Loose Cannon', base('Jinx, Loose Cannon'))
    await waitFor(`[data-board="legend"] .deck-board-card[data-deck-card-id="${base('Jinx, Loose Cannon')}"]`)

    // champion : ajouté au deck principal puis choisi par le menu
    const champ = base('Jinx, Demolitionist')
    await addFromSearch('Jinx, Demolitionist', champ)
    await waitFor(`[data-board="main"] .deck-board-card[data-deck-card-id="${champ}"]`)
    await openMenu(champ)
    await clickMenuAction('move-to-champion')
    await waitFor(`[data-board="champion"] .deck-board-card[data-deck-card-id="${champ}"]`)

    // runes : 12 de la même acceptées, la 13e refusée
    await addFromSearch('Fury Rune', base('Fury Rune'), 13)
    await waitForAttr(
      `[data-board="runes"] .deck-board-card[data-deck-card-id="${base('Fury Rune')}"]`,
      'data-quantity',
      (v) => v === '12'
    )

    // champ de bataille : un seul exemplaire
    await addFromSearch('Bandle Tree', base('Bandle Tree'), 2)
    await waitForAttr(
      `[data-board="battlefields"] .deck-board-card[data-deck-card-id="${base('Bandle Tree')}"]`,
      'data-quantity',
      (v) => v === '1'
    )

    // une carte Calm : hors de l'identité Fury / Chaos de la légende
    await addFromSearch('Clockwork Keeper', base('Clockwork Keeper'))
    await browser.waitUntil(
      async () => {
        const codes = await issueCodes()
        return (
          codes.includes('identity') &&
          codes.includes('main') &&
          codes.includes('battlefields') &&
          !codes.includes('legend') &&
          !codes.includes('champion') &&
          !codes.includes('runes')
        )
      },
      { timeout: 8000, timeoutMsg: `règles attendues : identity, main, battlefields` }
    )
  })

  it('retour à YGO : ses cartes, pas celles de Riftbound', async () => {
    await pickGame('ygo')
    await goTo('/search')
    await waitFor('#search-card-input')
    expect(await countOf('[data-rb-filters]')).toBe(0)
    await goTo('/collection')
    await browser.pause(500)
    expect(await countOf('#container-content .container-card')).toBe(0)
  })
})
