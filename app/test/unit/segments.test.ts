import { describe, expect, it } from 'vitest'
import { computeSegments } from '~/utils/segments'

// segments de fenêtre (doubles écrans / pliables) → mise en page
describe('computeSegments', () => {
  it('un seul écran : rien de spécial', () => {
    expect(computeSegments([])).toMatchObject({ columns: false })
    expect(computeSegments([{ left: 0, top: 0, width: 412, height: 915 }])).toMatchObject({
      columns: false,
    })
  })

  it('Surface Duo étalé : deux écrans côte à côte, charnière de 34 px', () => {
    expect(
      computeSegments([
        { left: 574, top: 0, width: 540, height: 720 },
        { left: 0, top: 0, width: 540, height: 720 }, // ordre quelconque
      ])
    ).toEqual({ columns: true, leftWidth: 540, hingeWidth: 34 })
  })

  it('pliable à écran continu : deux segments sans trou', () => {
    expect(
      computeSegments([
        { left: 0, top: 0, width: 420, height: 840 },
        { left: 420, top: 0, width: 420, height: 840 },
      ])
    ).toEqual({ columns: true, leftWidth: 420, hingeWidth: 0 })
  })

  it('charnière horizontale (posture « portable ») : pas de colonnes', () => {
    expect(
      computeSegments([
        { left: 0, top: 0, width: 720, height: 540 },
        { left: 0, top: 574, width: 720, height: 540 },
      ])
    ).toMatchObject({ columns: false })
  })
})
