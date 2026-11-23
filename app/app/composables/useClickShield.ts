// ============================================================
// Bouclier anti « clic fantôme » (mobile).
// Un panneau (UDrawer) se ferme dès que le doigt touche le fond grisé
// (pointerdown) ; le clic qui suit, au relâchement, tombe alors sur ce qui
// est dessous (une autre carte de la grille) et rouvre aussitôt un panneau.
// shieldClicks(), appelé à la fermeture, avale CE clic-là seulement : si le
// doigt est encore posé à ce moment. Une fermeture par le bouton ✕ ou la
// touche Retour (doigt déjà levé) ne bloque rien, ni un toucher alors qu'aucun
// panneau n'était affiché (la librairie signale encore des « touchers
// extérieurs » juste après la fermeture : sans ce test, le toucher suivant
// sur la page était avalé).
// Écouteurs posés par plugins/click-shield.client.ts.
// ============================================================

let pointerDown = false
let panelAtDown = false
let swallowUntil = 0

// panelShown : un panneau était affiché quand le doigt s'est posé
export function notePointer(down: boolean, panelShown = false): void {
  pointerDown = down
  panelAtDown = down && panelShown
}

export function shieldClicks(): void {
  // garde-fou : si le clic n'arrive jamais, le bouclier tombe seul
  if (pointerDown && panelAtDown) swallowUntil = Date.now() + 800
}

// à appeler sur chaque clic : vrai = ce clic doit être avalé (une seule fois)
export function takeShieldedClick(): boolean {
  if (Date.now() >= swallowUntil) return false
  swallowUntil = 0
  return true
}
