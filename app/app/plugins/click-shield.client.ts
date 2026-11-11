// Avale le clic fantôme qui suit la fermeture d'un panneau au toucher du
// fond (cf. useClickShield).
export default defineNuxtPlugin(() => {
  const opts = { capture: true, passive: true }
  // lu avant que le panneau ne réagisse (capture sur document)
  const panelShown = () => !!document.querySelector('[data-vaul-drawer][data-state="open"]')
  document.addEventListener('pointerdown', () => notePointer(true, panelShown()), opts)
  document.addEventListener('pointerup', () => notePointer(false), opts)
  document.addEventListener('pointercancel', () => notePointer(false), opts)
  document.addEventListener(
    'click',
    (e) => {
      if (!takeShieldedClick()) return
      e.stopPropagation()
      e.preventDefault()
    },
    { capture: true }
  )
})
