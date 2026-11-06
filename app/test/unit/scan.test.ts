import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabases, type TestDatabases } from './helpers/testDb'
import { createSeeder } from './helpers/seed'

// ============================================================
// scan — analyse du texte OCR (codes d'impression, noms,
// stabilisation) et identification sur la base de cartes.
// ============================================================

const h = vi.hoisted(() => ({ dbs: null as unknown as TestDatabases }))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))

const { parseSetCode, extractSetCodes, nameSimilarity, ScanStabilizer, identifyCard, canScan } =
  await import('~/services/scan')
const { nameCandidates } = await import('~/services/scan/text')

describe('codes d’impression', () => {
  it.each([
    ['LOB-EN005', 'LOB-005'],
    ['lob-en005', 'LOB-005'],
    ['LOB-FR005', 'LOB-005'],
    ['LOB-F005', 'LOB-005'],
    ['LOB-005', 'LOB-005'],
    ['LOB - EN005', 'LOB-005'],
    ['LOB-ENOO5', 'LOB-005'], // O lus à la place de 0
    ['RA01-EN0I2', 'RA01-012'], // I lu à la place de 1
    ['MP24-EN056', 'MP24-056'],
    ['SDY-006', 'SDY-006'],
    ['LOB-S005', 'LOB-005'], // ancien code espagnol : la région S n'est pas un chiffre
  ])('%s → %s', (raw, key) => {
    expect(parseSetCode(raw)?.key).toBe(key)
  })

  it.each(['hello', '123-456', 'ATK/2500 DEF/2100', '4007'])('ignore « %s »', (raw) => {
    expect(parseSetCode(raw)).toBeNull()
  })

  it('extrait les codes parmi du bruit, sans doublon', () => {
    const lines = [
      { text: 'Dark Magician' },
      { text: '[Spellcaster/Normal]' },
      { text: 'LOB-EN005 1st Edition' },
      { text: 'ATK/2500 DEF/2100' },
      { text: 'lob-en005' },
    ]
    expect(extractSetCodes(lines).map((c) => c.key)).toEqual(['LOB-005'])
  })
})

describe('noms', () => {
  it('tolère quelques erreurs d’OCR, pas une autre carte', () => {
    expect(nameSimilarity('Dark Maglcian', 'Dark Magician')).toBeGreaterThanOrEqual(0.8)
    expect(nameSimilarity('DARK MAGICIAN', 'Dark Magician')).toBe(1)
    expect(nameSimilarity('Dark Magician Girl', 'Dark Magician')).toBeLessThan(0.8)
    expect(nameSimilarity('Pot of Greed', 'Dark Magician')).toBeLessThan(0.3)
  })

  it('candidats : lignes du haut, surtout des lettres, sans code ni stats', () => {
    const lines = [
      { text: 'LOB-EN005', y: 300 },
      { text: 'ATK/2500 DEF/2100', y: 400 },
      { text: 'Dark Magician', y: 10 },
      { text: '[Spellcaster/Normal]', y: 320 },
      { text: '46986414', y: 500 },
    ]
    expect(nameCandidates(lines)[0]).toBe('Dark Magician')
    expect(nameCandidates(lines)).not.toContain('LOB-EN005')
    expect(nameCandidates(lines)).not.toContain('46986414')
  })
})

describe('stabilisation', () => {
  const dm = { cardId: 'DM' }
  const pot = { cardId: 'POT' }

  it('retient une carte vue 2 fois de suite, une seule fois tant qu’elle reste à l’écran', () => {
    const s = new ScanStabilizer()
    expect(s.push(dm)).toBeNull()
    expect(s.push(dm)).toBe(dm)
    expect(s.push(dm)).toBeNull()
    expect(s.push(dm)).toBeNull()
  })

  it('une lecture isolée (faux positif) n’est pas retenue', () => {
    const s = new ScanStabilizer()
    expect(s.push(dm)).toBeNull()
    expect(s.push(pot)).toBeNull()
    expect(s.push(null)).toBeNull()
    expect(s.push(dm)).toBeNull()
  })

  it('ré-ajoute le même exemplaire après qu’il a quitté l’image', () => {
    const s = new ScanStabilizer(2, 3)
    s.push(dm)
    expect(s.push(dm)).toBe(dm)
    s.push(null)
    s.push(null)
    expect(s.push(dm)).toBeNull() // revenu trop tôt : toujours la même carte posée
    s.push(null)
    s.push(null)
    s.push(null)
    s.push(dm)
    expect(s.push(dm)).toBe(dm)
  })

  it('enchaîne deux cartes différentes', () => {
    const s = new ScanStabilizer()
    s.push(dm)
    expect(s.push(dm)).toBe(dm)
    s.push(pot)
    expect(s.push(pot)).toBe(pot)
  })
})

describe('identification (YGO)', () => {
  let dbs: TestDatabases
  const DM = '46986414'
  const DM_ALT = '36996508'
  const POT = '55144522'

  function printing(id: string, cardId: string) {
    dbs.ygo.raw
      .prepare(`INSERT INTO printings (id, card_id, set_name, set_code) VALUES (?, ?, 'Set', ?)`)
      .run(id, cardId, id)
  }

  beforeEach(() => {
    dbs = createTestDatabases()
    h.dbs = dbs
    const seed = createSeeder(dbs)
    seed.card(DM, 'Dark Magician')
    seed.card(DM_ALT, 'Dark Magician', DM)
    seed.card(POT, 'Pot of Greed')
    seed.card('38033121', 'Dark Magician Girl')
    printing('LOB-EN005', DM)
    printing('SDY-006', DM)
    printing('LOB-EN119', POT)
  })

  afterEach(() => {
    dbs.user.close()
    dbs.ygo.close()
  })

  it('jeu supporté', () => {
    expect(canScan('ygo')).toBe(true)
    expect(canScan('mtg')).toBe(false)
  })

  it('par code d’impression : carte et impression exactes', async () => {
    const r = await identifyCard('ygo', [{ text: 'Pot of Gred' }, { text: 'LOB-EN119' }])
    expect(r).toMatchObject({ cardId: POT, printingId: 'LOB-EN119', via: 'setcode', score: 1 })
  })

  it('code d’une édition non anglaise → impression anglaise correspondante', async () => {
    const r = await identifyCard('ygo', [{ text: 'LOB-FR005' }])
    expect(r).toMatchObject({ cardId: DM, printingId: 'LOB-EN005' })
  })

  it('sans code lisible : par le nom, même abîmé, vers l’artwork principal', async () => {
    const r = await identifyCard('ygo', [
      { text: 'Dark Maglcian', y: 5 },
      { text: 'ATK/2500 DEF/2100', y: 400 },
    ])
    expect(r).toMatchObject({ cardId: DM, printingId: null, via: 'name' })
    expect(r!.score).toBeGreaterThanOrEqual(0.8)
  })

  it('ne confond pas une carte au nom proche', async () => {
    const r = await identifyCard('ygo', [{ text: 'Dark Magician Girl', y: 5 }])
    expect(r?.cardId).toBe('38033121')
  })

  it('rien de reconnaissable → null', async () => {
    expect(await identifyCard('ygo', [{ text: 'zzzz qqqq' }])).toBeNull()
    expect(await identifyCard('ygo', [{ text: 'ZZZ-EN999' }])).toBeNull()
    expect(await identifyCard('ygo', [])).toBeNull()
  })
})
