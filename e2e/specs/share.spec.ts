import {
  resetDb,
  goTo,
  typeInto,
  waitFor,
  countOf,
  click,
  waitForApp,
  waitForAttr,
  attrOf,
} from './helpers.js'
import { browser } from '@wdio/globals'

// ============================================================
// PARCOURS : partage de collection (sans caméra)
// Générer le partage de ma collection → code CMSHARE1 + QR → l'importer
// comme le ferait un autre joueur (coller le code) → vue croisée avec
// ma collection → filtre « qui me manquent » → suppression.
// Le scan caméra (QR animé) n'est testable que sur téléphone.
// Cibles via id/data-* uniquement (i18n-safe).
// ============================================================

const DM = '46986414' // Dark Magician (présent dans la fixture)
const CARD = `.shared-card[data-shared-card-id="${DM}"]`

describe('Partage de collection', () => {
  before(async () => {
    await waitForApp()
    await resetDb()
  })

  it('génère un partage, l’importe, croise avec ma collection, puis le supprime', async () => {
    const seeded = await browser.execute(async (id: string) => {
      const w = window as any
      return w.__seedOwned ? (await w.__seedOwned(id, 2), true) : false
    }, DM)
    expect(seeded).toBe(true)

    // 1. partager ma collection
    await goTo('/search')
    await goTo('/share')
    await waitFor('#share-generate-btn')
    await typeInto('#share-owner-input', 'Testeur')
    await click('#share-generate-btn')
    await waitForAttr('[data-share-code]', 'data-share-code', (v) => !!v?.startsWith('CMSHARE1:'))
    await waitForAttr('#share-qr', 'data-qr-frames', (v) => v === '1')
    const code = await attrOf('[data-share-code]', 'data-share-code')

    // 2. l'importer comme un autre joueur
    await click('[data-share-section="receive"]')
    await waitFor('#share-import-input')
    await typeInto('#share-import-input', code!)
    await click('#share-import-btn')
    await waitFor('#shared-view', { timeout: 8000 })
    await waitForAttr(CARD, 'data-shared-qty', (v) => v === '2')
    expect(await attrOf(CARD, 'data-shared-mine')).toBe('2')
    expect(await countOf('[data-saved-share-id]')).toBe(1)

    // 3. « qui me manquent » : je les ai toutes → vide
    await click('#shared-only-missing')
    await browser.waitUntil(async () => (await countOf(CARD)) === 0, {
      timeout: 5000,
      timeoutMsg: 'le filtre « qui me manquent » ne filtre pas',
    })

    // 4. supprimer la collection reçue
    await click('#shared-delete-btn')
    await browser.waitUntil(async () => (await countOf('[data-saved-share-id]')) === 0, {
      timeout: 5000,
      timeoutMsg: 'la collection reçue n’a pas été supprimée',
    })
  })
})
