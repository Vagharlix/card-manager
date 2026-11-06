// ============================================================
// E2E — Banlist alert
//
// L'alerte (data-banlist-alert) ne s'affiche que sur une VRAIE
// infraction (validation.valid === false). Or addCardToDeck refuse
// déjà tout ajout qui dépasserait la limite du format courant : on
// ne peut donc pas créer d'infraction à l'intérieur d'un seul
// format. Le seul chemin propre est le CHANGEMENT DE FORMAT :
//
//   1. deck en `casual` (maxCopiesForCard ignore la banlist → 3)
//      → on ajoute Pot of Greed, ça passe.
//   2. on bascule en `tcg` → Pot of Greed devient Forbidden
//      (limite 0, qty 1) → validateDeck signale l'infraction
//      → l'alerte apparaît.
//
// i18n-safe : aucune assertion sur du texte d'UI, uniquement des
// id / data-*. Le sélecteur de format est piloté comme le
// #deck-range-select (slot #item + data-select-value).
// ============================================================

import {
  resetDb,
  goTo,
  waitForApp,
  typeInto,
  click,
  waitFor,
  countOf,
  attrOf,
  openSelect,
  clickSelectOption,
} from './helpers'

// describe / it / beforeEach / expect : globals WDIO + Mocha,
// comme dans les 8 autres specs.

describe('Banlist', () => {
  beforeEach(async () => {
    await waitForApp()
    await resetDb()
  })

  it('signale une carte interdite après bascule casual → tcg', async () => {
    // ── créer un deck (sur base vide, l'état vide expose #deck-create-empty) ──
    await goTo('/decks')
    await waitFor('#deck-create-empty')
    await click('#deck-create-empty')
    await typeInto('#deck-name-input', 'Banlist Test')
    await click('#deck-create-confirm')
    // #deck-search-input est propre à decks/[id].vue (absent de /decks) :
    // l'attendre confirme la navigation ET absorbe la race de router.push.
    await waitFor('#deck-search-input')

    // ── passer en Casual : la banlist est neutralisée, l'ajout sera autorisé ──
    await openSelect('deck-format-select')
    await clickSelectOption('casual')

    // ── ajouter Pot of Greed (Forbidden en TCG, libre en Casual) ──
    // recherche par NOM ; "Pot of Greed" est distinctif dans la fixture
    // → premier (et seul) résultat. Aucun artwork alternatif, donc pas
    // d'ambiguïté d'ordre comme dans la saga deck-range.
    await typeInto('#deck-search-input', 'Pot of Greed')
    await waitFor('.deck-search-result')
    await click('.deck-search-result')

    // la carte est bien entrée dans le deck
    await waitFor('.deck-board-card[data-deck-card-id]')

    // en Casual : aucune infraction → pas d'alerte, carte non signalée
    expect(await countOf('[data-banlist-alert]')).toBe(0)
    expect(await attrOf('.deck-board-card', 'data-flagged')).toBe('false')

    // ── basculer en TCG → Pot of Greed devient interdite ──
    await openSelect('deck-format-select')
    await clickSelectOption('tcg')

    // assertion principale : l'alerte apparaît (waitFor confirme que la
    // revalidation a eu lieu) ; puis la carte doit être signalée.
    await waitFor('[data-banlist-alert]')
    expect(await attrOf('.deck-board-card', 'data-flagged')).toBe('true')
  })
})
