import { deflateRaw, inflateRaw } from 'pako'

// ============================================================
// SHARE CODEC — encode une collection partagée en texte compact
// (QR code, copier-coller). Pur : aucune dépendance base / Tauri.
//
// Format v1 :  "CMSHARE1:" + base32( deflateRaw( octets ) )
//   base32 majuscule (RFC 4648, sans padding) : tout le texte tient dans
//   le jeu alphanumérique des QR codes (mode le plus dense pour du texte),
//   et survit au copier-coller. Le décodage est insensible à la casse.
//   octets = jeu (u8 longueur + utf8) · nom (varint + utf8)
//          · date (varint, secondes unix) · nombre de cartes (varint)
//          · pour chaque carte, triée par id croissant :
//              écart d'id avec la précédente (varint), quantité (varint),
//              quantité à l'échange (varint)
//
// Format v2 :  "CMSHARE2:" + base32( deflateRaw( octets ) ), pour les jeux
//   dont les ids ne sont pas des nombres (ex. « FK-001 », uuid) :
//   même en-tête, puis pour chaque carte, triée par id (ordre des chaînes) :
//     longueur du préfixe commun avec l'id précédent (varint),
//     longueur du reste (varint) + reste (utf8), quantité, quantité à l'échange
// L'encodeur prend v1 dès que tous les ids sont numériques (plus compact),
// v2 sinon ; le décodeur lit les deux.
// ============================================================

export const SHARE_PREFIX = 'CMSHARE1:'
export const SHARE_PREFIX_V2 = 'CMSHARE2:'
// tout code de partage commence par là (suivi de la version)
export const SHARE_MAGIC = 'CMSHARE'

export interface ShareCard {
  id: string
  qty: number
  trade: number
}

export interface SharePayload {
  game: string
  owner: string
  createdAt: number // ms
  cards: ShareCard[]
}

export class ShareCodeError extends Error {
  constructor(code: 'INVALID' | 'UNSUPPORTED_VERSION' | 'UNSUPPORTED_ID') {
    super(code)
  }
}

// ── varint (LEB128 non signé, jusqu'à 2^53) ──
function pushVarint(out: number[], n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new ShareCodeError('INVALID')
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80)
    n = Math.floor(n / 0x80)
  }
  out.push(n)
}

class Reader {
  private pos = 0
  constructor(private readonly bytes: Uint8Array) {}

  varint(): number {
    let result = 0
    let mul = 1
    for (let i = 0; i < 8; i++) {
      const b = this.byte()
      result += (b & 0x7f) * mul
      if (b < 0x80) return result
      mul *= 0x80
    }
    throw new ShareCodeError('INVALID')
  }

  byte(): number {
    const b = this.bytes[this.pos++]
    if (b === undefined) throw new ShareCodeError('INVALID')
    return b
  }

  take(len: number): Uint8Array {
    if (this.pos + len > this.bytes.length) throw new ShareCodeError('INVALID')
    const b = this.bytes.slice(this.pos, this.pos + len)
    this.pos += len
    return b
  }

  utf8(len: number): string {
    if (this.pos + len > this.bytes.length) throw new ShareCodeError('INVALID')
    const s = new TextDecoder().decode(this.bytes.subarray(this.pos, this.pos + len))
    this.pos += len
    return s
  }

  get done(): boolean {
    return this.pos === this.bytes.length
  }
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function toBase32(bytes: Uint8Array): string {
  let out = ''
  let bits = 0
  let value = 0
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

function fromBase32(s: string): Uint8Array {
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const ch of s) {
    const v = B32.indexOf(ch)
    if (v < 0) throw new ShareCodeError('INVALID')
    value = ((value << 5) | v) & 0xffff
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

// id numérique canonique (pas de zéro de tête) → aller-retour exact en v1
function isNumericId(id: string): boolean {
  return /^\d+$/.test(id) && String(Number(id)) === id && Number.isSafeInteger(Number(id))
}

// regroupe par id (plusieurs piles d'une même carte)
function mergeCards(cards: ShareCard[]): Map<string, { qty: number; trade: number }> {
  const byId = new Map<string, { qty: number; trade: number }>()
  for (const c of cards) {
    if (!c.id) throw new ShareCodeError('UNSUPPORTED_ID')
    const cur = byId.get(c.id) ?? { qty: 0, trade: 0 }
    cur.qty += c.qty
    cur.trade += c.trade
    byId.set(c.id, cur)
  }
  return byId
}

function header(payload: SharePayload, count: number): number[] {
  const enc = new TextEncoder()
  const game = enc.encode(payload.game)
  const owner = enc.encode(payload.owner)
  if (game.length > 255) throw new ShareCodeError('INVALID')
  const out: number[] = [game.length, ...game]
  pushVarint(out, owner.length)
  out.push(...owner)
  pushVarint(out, Math.floor(payload.createdAt / 1000))
  pushVarint(out, count)
  return out
}

export function encodeShare(payload: SharePayload): string {
  const byId = mergeCards(payload.cards)
  if (![...byId.keys()].every(isNumericId)) return encodeV2(payload, byId)

  const ids = [...byId.keys()].map(Number).sort((a, b) => a - b)
  const out = header(payload, ids.length)
  let prev = 0
  for (const id of ids) {
    const c = byId.get(String(id))!
    pushVarint(out, id - prev)
    pushVarint(out, c.qty)
    pushVarint(out, Math.min(c.trade, c.qty))
    prev = id
  }
  return SHARE_PREFIX + toBase32(deflateRaw(Uint8Array.from(out)))
}

function encodeV2(payload: SharePayload, byId: Map<string, { qty: number; trade: number }>): string {
  const enc = new TextEncoder()
  const ids = [...byId.keys()].sort()
  const out = header(payload, ids.length)
  let prev = new Uint8Array()
  for (const id of ids) {
    const c = byId.get(id)!
    const bytes = enc.encode(id)
    let common = 0
    while (common < bytes.length && common < prev.length && bytes[common] === prev[common]) common++
    pushVarint(out, common)
    pushVarint(out, bytes.length - common)
    out.push(...bytes.subarray(common))
    pushVarint(out, c.qty)
    pushVarint(out, Math.min(c.trade, c.qty))
    prev = bytes
  }
  return SHARE_PREFIX_V2 + toBase32(deflateRaw(Uint8Array.from(out)))
}

export function decodeShare(text: string): SharePayload {
  const t = text.replace(/\s+/g, '').toUpperCase() // copier-coller : espaces, retours, casse
  const m = /^CMSHARE(\d+):(.*)$/.exec(t)
  if (!m) throw new ShareCodeError('INVALID')
  const version = m[1]
  if (version !== '1' && version !== '2') throw new ShareCodeError('UNSUPPORTED_VERSION')

  let bytes: Uint8Array
  try {
    bytes = inflateRaw(fromBase32(m[2] ?? ''))
  } catch {
    throw new ShareCodeError('INVALID')
  }

  const r = new Reader(bytes)
  const game = r.utf8(r.byte())
  const owner = r.utf8(r.varint())
  const createdAt = r.varint() * 1000
  const count = r.varint()
  const cards: ShareCard[] = []
  let id = 0
  let prev = new Uint8Array()
  for (let i = 0; i < count; i++) {
    let cardId: string
    if (version === '1') {
      id += r.varint()
      cardId = String(id)
    } else {
      const common = r.varint()
      if (common > prev.length) throw new ShareCodeError('INVALID')
      const rest = r.take(r.varint())
      const full = new Uint8Array(common + rest.length)
      full.set(prev.subarray(0, common))
      full.set(rest, common)
      prev = full
      cardId = new TextDecoder().decode(full)
      if (!cardId) throw new ShareCodeError('INVALID')
    }
    const qty = r.varint()
    const trade = r.varint()
    if (qty === 0 || trade > qty) throw new ShareCodeError('INVALID')
    cards.push({ id: cardId, qty, trade })
  }
  if (!r.done || !game) throw new ShareCodeError('INVALID')
  return { game, owner, createdAt, cards }
}
