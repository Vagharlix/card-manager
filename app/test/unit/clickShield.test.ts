import { describe, expect, it } from 'vitest'
import { notePointer, shieldClicks, takeShieldedClick } from '~/composables/useClickShield'

describe('bouclier anti clic fantôme', () => {
  it('fermeture au toucher du fond (doigt posé) : le clic suivant est avalé, une fois', () => {
    notePointer(true, true)
    shieldClicks()
    notePointer(false)
    expect(takeShieldedClick()).toBe(true)
    expect(takeShieldedClick()).toBe(false)
  })

  it('fermeture par le bouton ✕ ou Retour (doigt levé) : rien n’est bloqué', () => {
    notePointer(false)
    shieldClicks()
    expect(takeShieldedClick()).toBe(false)
  })

  it('aucun panneau affiché au toucher (fermeture tardive signalée) : rien n’est bloqué', () => {
    notePointer(true, false)
    shieldClicks()
    notePointer(false)
    expect(takeShieldedClick()).toBe(false)
  })
})
