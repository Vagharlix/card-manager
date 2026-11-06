import { goTo, click, waitFor, waitForApp, waitForAttr, attrOf } from './helpers.js'

// ============================================================
// PARCOURS : Réglages → Stockage
// Vérifie que les commandes Rust du cache d'images sont branchées :
// la taille s'affiche (data-cache-bytes numérique), puis le vidage la
// ramène à 0. Cibles via id/data-* uniquement (i18n-safe).
// ============================================================

const isBytes = (v: string | null) => v !== null && /^\d+$/.test(v)

describe('Réglages — cache d’images', () => {
  before(async () => {
    await waitForApp()
  })

  it('affiche la taille du cache puis le vide', async () => {
    await goTo('/settings')
    await waitFor('[data-section="storage"]')
    await click('[data-section="storage"]')

    await waitFor('#image-cache-size')
    await waitForAttr('#image-cache-size', 'data-cache-bytes', isBytes)

    await click('#image-cache-clear')
    await waitForAttr('#image-cache-size', 'data-cache-bytes', (v) => v === '0')
    expect(await attrOf('#image-cache-size', 'data-cache-bytes')).toBe('0')
  })
})
