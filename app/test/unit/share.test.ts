import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { createTestDatabases, type TestDatabases } from './helpers/testDb'
import { createSeeder } from './helpers/seed'

// ============================================================
// partage — codec (format, erreurs, capacité QR) et service
// (construction, résolution croisée, collections enregistrées).
// ============================================================

const h = vi.hoisted(() => ({ dbs: null as unknown as TestDatabases }))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))

const {
  encodeShare,
  decodeShare,
  ShareCodeError,
  buildMyShare,
  shareCode,
  resolveShare,
  saveShare,
  listSavedShares,
  loadSavedShare,
  deleteSavedShare,
  toFrames,
  FrameAssembler,
} = await import('~/services/share')
const { addCard } = await import('~/services/collection')

const DM = '46986414'
const DM_ALT = '36996508'
const POT = '55144522'
const BEWD = '89631139'

// capacité d'un QR code version 40, correction L, mode alphanumérique
const QR_MAX_ALNUM = 4296

describe('codec', () => {
  const payload = {
    game: 'ygo',
    owner: 'Félix 🃏',
    createdAt: Date.UTC(2026, 10, 6, 12, 0, 0),
    cards: [
      { id: POT, qty: 1, trade: 0 },
      { id: DM, qty: 2, trade: 1 },
      { id: DM, qty: 1, trade: 1 }, // 2e pile de la même carte : fusionnée
    ],
  }

  it('aller-retour : fusionne les piles, trie, garde nom et date', () => {
    const code = encodeShare(payload)
    expect(code).toMatch(/^CMSHARE1:[A-Z2-7]+$/) // jeu alphanumérique QR
    expect(decodeShare(code)).toEqual({
      game: 'ygo',
      owner: 'Félix 🃏',
      createdAt: payload.createdAt,
      cards: [
        { id: DM, qty: 3, trade: 2 },
        { id: POT, qty: 1, trade: 0 },
      ],
    })
  })

  it('tolère espaces, retours à la ligne et minuscules dans un code collé', () => {
    const code = encodeShare(payload)
    const mangled = `  ${code.slice(0, 20)}\n${code.slice(20).toLowerCase()} \n`
    expect(decodeShare(mangled).cards).toHaveLength(2)
  })

  it('borne la quantité à l’échange à la quantité', () => {
    const code = encodeShare({ ...payload, cards: [{ id: DM, qty: 1, trade: 5 }] })
    expect(decodeShare(code).cards).toEqual([{ id: DM, qty: 1, trade: 1 }])
  })

  it.each([
    ['préfixe absent', 'hello'],
    ['caractères hors base32', 'CMSHARE1:!!!'],
    ['données non compressées', 'CMSHARE1:AAAA'],
  ])('rejette un code invalide (%s)', (_label, code) => {
    expect(() => decodeShare(code)).toThrow(ShareCodeError)
  })

  it('rejette un code tronqué', () => {
    const code = encodeShare(payload)
    expect(() => decodeShare(code.slice(0, code.length - 6))).toThrow('INVALID')
  })

  it('signale une version future', () => {
    expect(() => decodeShare('CMSHARE2:ABC')).toThrow('UNSUPPORTED_VERSION')
  })

  it('refuse les ids non numériques ou à zéro de tête', () => {
    for (const id of ['abc-123', '0123']) {
      expect(() => encodeShare({ ...payload, cards: [{ id, qty: 1, trade: 0 }] })).toThrow(
        'UNSUPPORTED_ID'
      )
    }
  })

  it('650 cartes différentes tiennent dans un QR code', () => {
    // passcodes réalistes : 8 chiffres, répartis aléatoirement (graine fixe)
    let seed = 42
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    const cards = Array.from({ length: 650 }, () => ({
      id: String(10_000_000 + Math.floor(rand() * 89_999_999)),
      qty: 1 + Math.floor(rand() * 3),
      trade: rand() < 0.3 ? 1 : 0,
    }))
    const code = encodeShare({ ...payload, cards })
    expect(code.length).toBeLessThanOrEqual(QR_MAX_ALNUM)
    expect(decodeShare(code).cards.length).toBe(new Set(cards.map((c) => c.id)).size)
  })
})

// collection réaliste de n cartes différentes (graine fixe)
function bigCollection(n: number) {
  let seed = 7
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  const ids = new Set<string>()
  while (ids.size < n) ids.add(String(10_000_000 + Math.floor(rand() * 89_999_999)))
  return {
    game: 'ygo',
    owner: 'Gros collectionneur',
    createdAt: 0,
    cards: [...ids].map((id) => ({
      id,
      qty: 1 + Math.floor(rand() * 3),
      trade: rand() < 0.2 ? 1 : 0,
    })),
  }
}

describe('QR animé', () => {
  it('5000 cartes : une trentaine d’images légères, réassemblées dans le désordre', () => {
    const payload = bigCollection(5000)
    const code = encodeShare(payload)
    const frames = toFrames(code)
    expect(frames.length).toBeGreaterThan(20)
    expect(frames.length).toBeLessThan(45)
    for (const f of frames) expect(f).toMatch(/^CMSQ:[A-Z2-7]{4}:\d+:\d+:[A-Z2-7]+$/)

    // réception : ordre mélangé, doublons, et une image d'un AUTRE partage au milieu
    const other = toFrames(encodeShare(bigCollection(1200)))
    const a = new FrameAssembler()
    const shuffled = [...frames].reverse()
    let result = a.add(other[0]!)
    expect(result).toMatchObject({ status: 'progress', got: 1 })
    for (const f of [shuffled[0]!, shuffled[0]!, ...shuffled.slice(1)]) result = a.add(f)
    expect(result.status).toBe('complete')
    if (result.status === 'complete') expect(decodeShare(result.code).cards).toHaveLength(5000)
  })

  it('vraie chaîne QR : images générées par qrcode, relues par jsQR, réassemblées', () => {
    const code = encodeShare(bigCollection(1000))
    const frames = toFrames(code)
    const a = new FrameAssembler()
    let last: ReturnType<FrameAssembler['add']> = { status: 'ignored' }
    for (const frame of frames) {
      // rendu en pixels (module = 4 px, marge de 4 modules), comme une image à l'écran
      const qr = QRCode.create(frame, { errorCorrectionLevel: 'M' })
      const n = qr.modules.size
      const scale = 4
      const margin = 4 * scale
      const size = n * scale + 2 * margin
      const px = new Uint8ClampedArray(size * size * 4).fill(255)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++)
          if (qr.modules.get(y, x))
            for (let dy = 0; dy < scale; dy++)
              for (let dx = 0; dx < scale; dx++) {
                const i = ((margin + y * scale + dy) * size + margin + x * scale + dx) * 4
                px[i] = px[i + 1] = px[i + 2] = 0
              }
      const read = jsQR(px, size, size)
      expect(read?.data).toBe(frame)
      last = a.add(read!.data)
    }
    expect(last).toEqual({ status: 'complete', code })
  })

  it('petite collection : une seule image', () => {
    const code = encodeShare(bigCollection(50))
    const frames = toFrames(code)
    expect(frames).toHaveLength(1)
    expect(new FrameAssembler().add(frames[0]!)).toEqual({ status: 'complete', code })
  })

  it('accepte un code complet scanné directement, ignore les QR étrangers', () => {
    const code = encodeShare(bigCollection(10))
    const a = new FrameAssembler()
    expect(a.add('https://example.com')).toEqual({ status: 'ignored' })
    expect(a.add(code)).toEqual({ status: 'complete', code })
  })
})

describe('service', () => {
  let dbs: TestDatabases
  let seed: ReturnType<typeof createSeeder>

  beforeEach(() => {
    dbs = createTestDatabases()
    h.dbs = dbs
    seed = createSeeder(dbs)
    seed.card(DM, 'Dark Magician')
    seed.card(DM_ALT, 'Dark Magician', DM)
    seed.card(POT, 'Pot of Greed')
    seed.card(BEWD, 'Blue-Eyes White Dragon')
  })

  afterEach(() => {
    dbs.user.close()
    dbs.ygo.close()
  })

  it('buildMyShare : quantités par carte, option « à l’échange uniquement »', async () => {
    await addCard({ game: 'ygo', cardId: DM, quantity: 2, tradeQty: 1 })
    await addCard({ game: 'ygo', cardId: DM, quantity: 1 })
    await addCard({ game: 'ygo', cardId: POT, quantity: 1 })

    const all = await buildMyShare('ygo', { owner: ' Félix ' })
    expect(all.owner).toBe('Félix')
    expect(all.cards.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: DM, qty: 3, trade: 1 },
      { id: POT, qty: 1, trade: 0 },
    ])
    expect((await buildMyShare('ygo', { owner: 'F', onlyTrade: true })).cards).toEqual([
      { id: DM, qty: 3, trade: 1 },
    ])
  })

  it('resolveShare : regroupe les artworks, croise avec ma collection', async () => {
    await addCard({ game: 'ygo', cardId: DM, quantity: 1 }) // j'ai 1 DM (autre artwork)
    const view = await resolveShare({
      game: 'ygo',
      owner: 'Ami',
      createdAt: 0,
      cards: [
        { id: DM_ALT, qty: 2, trade: 1 },
        { id: DM, qty: 1, trade: 0 },
        { id: BEWD, qty: 1, trade: 1 },
        { id: '99999999', qty: 1, trade: 0 }, // inconnue de ma base
      ],
    })
    expect(view).toEqual([
      { rootId: '99999999', displayId: '99999999', name: '#99999999', qty: 1, trade: 0, mine: 0 },
      { rootId: BEWD, displayId: BEWD, name: 'Blue-Eyes White Dragon', qty: 1, trade: 1, mine: 0 },
      { rootId: DM, displayId: DM_ALT, name: 'Dark Magician', qty: 3, trade: 1, mine: 1 },
    ])
  })

  it('collections reçues : enregistrer, remplacer pour le même joueur, relire, supprimer', async () => {
    await addCard({ game: 'ygo', cardId: DM, quantity: 2, tradeQty: 1 })
    const first = await saveShare(await shareCode('ygo', { owner: 'Ami' }))
    expect(first).toMatchObject({ owner: 'Ami', cardCount: 2, tradeCount: 1 })

    await addCard({ game: 'ygo', cardId: POT, quantity: 1 })
    const second = await saveShare(await shareCode('ygo', { owner: 'Ami' }))
    expect(second.id).toBe(first.id) // même joueur : remplacé
    const list = await listSavedShares()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ owner: 'Ami', cardCount: 3 })
    expect((await loadSavedShare(first.id))?.cards).toHaveLength(2)

    await deleteSavedShare(first.id)
    expect(await listSavedShares()).toEqual([])
    expect(await loadSavedShare(first.id)).toBeNull()
  })

  it('saveShare refuse un code invalide sans rien écrire', async () => {
    await expect(saveShare('pas un code')).rejects.toThrow(ShareCodeError)
    expect(await listSavedShares()).toEqual([])
  })
})
