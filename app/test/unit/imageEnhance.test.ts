import { describe, expect, it } from 'vitest'
import { enhanceForOcr } from '~/utils/imageEnhance'

// zone relue de près avant l'OCR : gris + contraste étiré
describe('enhanceForOcr', () => {
  const pixels = (values: [number, number, number][]) =>
    new Uint8ClampedArray(values.flatMap(([r, g, b]) => [r, g, b, 200]))

  it('texte gris pâle sur fond clair → noir sur blanc', () => {
    // 1 pixel de « texte » (gris 150) pour 9 de fond (gris 210)
    const img = pixels([[150, 150, 150], ...Array.from({ length: 9 }, () => [210, 210, 210] as [number, number, number])])
    enhanceForOcr(img, 0.05, 0.95)
    expect([img[0], img[1], img[2], img[3]]).toEqual([0, 0, 0, 255])
    expect(img[4]).toBe(255)
  })

  it('couleurs → gris (luminance), image uniforme sans division par zéro', () => {
    const img = pixels([[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]])
    enhanceForOcr(img)
    for (let p = 0; p < img.length; p += 4) expect(img[p]).toBe(img[p + 1]) // gris
    expect(img[4]).toBeGreaterThan(img[0]!) // le vert est plus clair que le rouge
    const flat = pixels([[90, 90, 90], [90, 90, 90]])
    enhanceForOcr(flat)
    expect(Array.from(flat)).toEqual([0, 0, 0, 255, 0, 0, 0, 255])
    enhanceForOcr(new Uint8ClampedArray(0))
  })
})
