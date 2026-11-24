import { describe, expect, it } from 'vitest'

// ============================================================
// Affichage commun à tous les jeux : format des cartes par jeu, carte
// paysage tournée dans une case portrait, mise à jour (même la 1re
// installation) d'une base de cartes en arrière-plan.
// ============================================================

const { fitStyle } = await import('~/composables/useCardFit')
const { cardAspectOf, CARD_ASPECT_STANDARD } = await import('~/services/game')
const { registerGameModule, unregisterGameModule, gameModule } = await import(
  '~/services/game/modules'
)
const cardData = await import('~/services/cardData')

describe('format des cartes', () => {
  it('par jeu : YGO 59 × 86, Magic et Riftbound 63 × 88, inconnu = standard', () => {
    expect(cardAspectOf('ygo')).toBeCloseTo(59 / 86)
    expect(cardAspectOf('mtg')).toBeCloseTo(63 / 88)
    expect(cardAspectOf('riftbound')).toBeCloseTo(63 / 88)
    expect(cardAspectOf('nope')).toBe(CARD_ASPECT_STANDARD)
  })

  it('image paysage dans une case portrait : quart de tour qui remplit la case', () => {
    // champ de bataille 1039 × 744 dans une case 100 × 140
    const s = fitStyle(1039, 744, 100, 140)!
    expect(s.transform).toBe('translate(-50%, -50%) rotate(90deg)')
    expect(s.width).toBe('140.000%') // largeur tournée = hauteur de la case
    expect(s.height).toBe('71.429%') // hauteur tournée = largeur de la case
    // même orientation, case carrée, image pas encore chargée : rien
    expect(fitStyle(744, 1039, 100, 140)).toBeUndefined()
    expect(fitStyle(1039, 744, 140, 100)).toBeUndefined()
    expect(fitStyle(1039, 744, 48, 48)).toBeUndefined()
    expect(fitStyle(0, 0, 100, 140)).toBeUndefined()
    // carte portrait dans une case paysage (rare) : tournée aussi
    expect(fitStyle(744, 1039, 140, 100)?.transform).toContain('rotate(90deg)')
  })
})

describe('mise à jour d’une base de cartes', () => {
  it('1re installation : signalée pendant la mise à jour, page rechargée à la fin', async () => {
    const base = gameModule('riftbound')
    let version: string | null = null
    const seen: { first: boolean; game: string | null }[] = []
    registerGameModule({
      ...base,
      def: { ...base.def, id: 'bgtest', label: 'Background test' },
      cardData: {
        localVersion: async () => version,
        sync: async () => {
          seen.push({ first: cardData.syncFirstInstall.value, game: cardData.syncingGame.value })
          version = 'v1'
          return { changed: 10, removed: 0 }
        },
      },
    })
    try {
      const before = cardData.cardDataInstalled.value
      expect(await cardData.syncCardData('bgtest')).toEqual({ changed: 10, removed: 0 })
      expect(seen).toEqual([{ first: true, game: 'bgtest' }])
      expect(cardData.cardDataInstalled.value).toBe(before + 1)
      expect(cardData.syncingGame.value).toBeNull()
      expect(cardData.syncFirstInstall.value).toBe(false)
      // mise à jour suivante : plus une installation, la page n'est pas rechargée
      await cardData.syncCardData('bgtest')
      expect(seen[1]).toEqual({ first: false, game: 'bgtest' })
      expect(cardData.cardDataInstalled.value).toBe(before + 1)
    } finally {
      unregisterGameModule('bgtest')
    }
  })
})
