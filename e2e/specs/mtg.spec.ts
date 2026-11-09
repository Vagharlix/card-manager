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
} from './helpers.js'
import { browser } from '@wdio/globals'

// ============================================================
// PARCOURS : Magic: The Gathering
// Bascule de jeu par le sélecteur → base Magic remplie avec l'échantillon
// Scryfall réel (vrai importeur, sans réseau) → recherche → fiche : choix
// de l'impression (une impression = une carte) → ajout → collection →
// deck (règles Magic : terrains de base illimités, 4 copies sinon) →
// retour à YGO. Cibles via id/data-* uniquement (i18n-safe).
// ============================================================

const SAMPLE = readFileSync(
  join(process.cwd(), '..', 'app', 'test', 'unit', 'fixtures', 'scryfall-sample.jsonl'),
  'utf8'
)
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
const printsOf = (name: string): string[] =>
  SAMPLE.filter((c) => c.name === name).map((c) => c.id as string)

async function pickGame(id: string) {
  await openSelect('game-picker')
  await clickSelectOption(id)
  // la page est remontée sur le nouveau jeu
  await browser.waitUntil(async () => (await attrOf('#game-picker', 'data-current-game')) === id, {
    timeout: 8000,
    timeoutMsg: `jeu ${id} non sélectionné`,
  })
}

describe('Magic: The Gathering', () => {
  before(async () => {
    await waitForApp()
    await resetDb()
    await pickGame('mtg')
    const res = await browser.execute(async (items: unknown[]) => {
      try {
        return await (window as any).__seedMtg(items)
      } catch (e: any) {
        return { error: String(e?.message ?? e) }
      }
    }, SAMPLE)
    if ((res as any)?.error) throw new Error(`seedMtg: ${(res as any).error}`)
    expect((res as any).cards).toBe(20)
  })

  it('recherche : une ligne par carte, filtres Magic', async () => {
    await goTo('/search')
    await waitFor('[data-mtg-filters]') // panneau de filtres du jeu
    await typeInto('#search-card-input', 'Lightning Bolt')
    await browser.waitUntil(async () => (await countOf('#search-results .card-thumb')) === 1, {
      timeout: 8000,
      timeoutMsg: 'une seule carte attendue',
    })
    const shown = await attrOf('#search-results .card-thumb', 'data-card-id')
    expect(printsOf('Lightning Bolt')).toContain(shown)
  })

  it('fiche : choisir une impression puis l’ajouter', async () => {
    await click('#search-results .card-thumb')
    await waitFor('#card-detail')
    await waitFor('#card-printing-select')
    expect(await countOf('#entry-first-edition, [data-entry-first-edition]')).toBe(0)

    const shown = await attrOf('#search-results .card-thumb', 'data-card-id')
    const other = printsOf('Lightning Bolt').find((p) => p !== shown)!
    await openSelect('card-printing-select')
    await clickSelectOption(other)
    await waitForAttr('#card-detail-owned', 'data-owned-count', (v) => v === '0')
    await click('#btn-quick-add')
    await waitForAttr('#card-detail-owned', 'data-owned-count', (v) => v === '1')
    await browser.keys('Escape')
  })

  it('collection : la carte est rangée sous Magic, pas sous YGO', async () => {
    await goTo('/decks')
    await goTo('/collection')
    await waitFor('#container-content .container-card[data-content-card-id]')
    expect(await countOf('#container-content .container-card')).toBe(1)
  })

  it('deck : terrains de base illimités, 4 copies sinon', async () => {
    await goTo('/decks')
    await waitFor('#deck-create-empty, #deck-create-btn')
    await click((await countOf('#deck-create-empty')) ? '#deck-create-empty' : '#deck-create-btn')
    await typeInto('#deck-name-input', 'Mono red')
    await click('#deck-create-confirm')
    await waitForPath((p) => /^\/decks\/.+/.test(p))

    expect(await countOf('[data-board="main"]')).toBe(1)
    expect(await countOf('[data-board="commander"]')).toBe(1)
    expect(await countOf('[data-board="extra"]')).toBe(0)

    await typeInto('#deck-search-input', 'Forest')
    const forests = printsOf('Forest')
    await browser.waitUntil(
      async () =>
        forests.includes((await attrOf('.deck-search-result', 'data-search-card-id')) ?? ''),
      { timeout: 8000, timeoutMsg: 'résultat Forest absent' }
    )
    for (let i = 0; i < 6; i++) {
      await click('.deck-search-result')
      await browser.pause(150)
    }
    await waitForAttr('[data-board="main"] .deck-board-card', 'data-quantity', (v) => v === '6')

    await typeInto('#deck-search-input', 'Lightning Bolt')
    // attendre le nouveau résultat (l'ancien, Forest, compte aussi pour 1)
    const bolts = printsOf('Lightning Bolt')
    await browser.waitUntil(
      async () =>
        bolts.includes((await attrOf('.deck-search-result', 'data-search-card-id')) ?? ''),
      { timeout: 8000, timeoutMsg: 'résultat Lightning Bolt absent' }
    )
    for (let i = 0; i < 5; i++) {
      await click('.deck-search-result')
      await browser.pause(150)
    }
    await browser.waitUntil(
      async () => (await attrOf('[data-total-cards]', 'data-total-cards')) === '10',
      { timeout: 8000, timeoutMsg: '6 Forest + 4 Lightning Bolt attendus (5e refusé)' }
    )
  })

  it('retour à YGO : ses cartes, pas celles de Magic', async () => {
    await pickGame('ygo')
    await goTo('/search')
    await waitFor('#search-card-input')
    expect(await countOf('[data-mtg-filters]')).toBe(0)
    await goTo('/collection')
    await browser.pause(500)
    expect(await countOf('#container-content .container-card')).toBe(0)
  })
})
