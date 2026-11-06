import {
  resetDb,
  goTo,
  typeInto,
  waitFor,
  countOf,
  click,
  waitForApp,
  waitForAttr,
} from './helpers.js'
import { browser } from '@wdio/globals'

// ============================================================
// PARCOURS : « Toute ma collection » + quantité à l'échange
// Carte possédée (seedée) → visible dans la vue par défaut de
// /collection → 1 copie passée « à l'échange » depuis la fiche →
// badge data-trade-qty → filtre « à l'échange » → recherche.
// Cibles via id/data-* uniquement (i18n-safe).
// ============================================================

const DM = '46986414' // Dark Magician (passcode principal, présent dans la fixture)
const CARD = `#container-content .container-card[data-content-card-id="${DM}"]`

async function seedOwned(cardId: string, qty: number): Promise<void> {
  const res = await browser.execute(
    async (id: string, q: number) => {
      const w = window as any
      if (!w.__seedOwned) return { error: '__seedOwned absent' }
      try {
        return await w.__seedOwned(id, q)
      } catch (e: any) {
        return { error: String(e?.message ?? e) }
      }
    },
    cardId,
    qty
  )
  if ((res as any)?.error) throw new Error(`seedOwned: ${(res as any).error}`)
}

describe('Collection — vue complète et échange', () => {
  before(async () => {
    await waitForApp()
    await resetDb()
  })

  it('affiche la collection, marque une copie à l’échange, filtre et recherche', async () => {
    await seedOwned(DM, 2)

    // vue par défaut de /collection = toute ma collection. L'app démarre déjà
    // sur /collection (redirection de l'accueil) : passer par une autre page
    // pour remonter la vue après le seed.
    await goTo('/search')
    await goTo('/collection')
    await waitFor('[data-container-id="__all__"]')
    await waitFor(CARD, { timeout: 10000 })

    // fiche → éditer l'exemplaire → 1 à l'échange
    await click(`${CARD} .card-thumb`)
    await waitFor('[data-entry-edit]', { timeout: 8000 })
    await click('[data-entry-edit]')
    await waitFor('#entry-trade-qty-input')
    await typeInto('#entry-trade-qty-input', '1')
    await click('#entry-save-btn')
    await waitForAttr('[data-entry-trade-qty]', 'data-entry-trade-qty', (v) => v === '1')

    // retour à la vue (ferme la fiche) : le badge d'échange apparaît
    await goTo('/search')
    await goTo('/collection')
    await waitForAttr(`${CARD} [data-trade-qty]`, 'data-trade-qty', (v) => v === '1')

    // filtre « à l'échange » : la carte reste
    await click('#collection-only-trade')
    await browser.pause(500)
    expect(await countOf(CARD)).toBe(1)

    // recherche sans résultat
    await typeInto('#collection-search', 'zzzz-aucune-carte')
    await browser.waitUntil(async () => (await countOf(CARD)) === 0, {
      timeout: 5000,
      timeoutMsg: 'la recherche ne filtre pas la collection',
    })
  })
})
