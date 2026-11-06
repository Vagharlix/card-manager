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
// Les ids doivent être numériques (passcodes YGO). Un jeu à ids non
// numériques demandera un format v2 : le préfixe porte la version.
// ============================================================

export const SHARE_PREFIX = 'CMSHARE1:'

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

export function encodeShare(payload: SharePayload): string {
  const enc = new TextEncoder()
  const game = enc.encode(payload.game)
  const owner = enc.encode(payload.owner)
  if (game.length > 255) throw new ShareCodeError('INVALID')

  // regroupe par id (plusieurs piles d'une même carte) et trie
  const byId = new Map<number, { qty: number; trade: number }>()
  for (const c of payload.cards) {
    const id = Number(c.id)
    // id numérique canonique (pas de zéro de tête) → aller-retour exact
    if (!/^\d+$/.test(c.id) || String(id) !== c.id || !Number.isSafeInteger(id)) {
      throw new ShareCodeError('UNSUPPORTED_ID')
    }
    const cur = byId.get(id) ?? { qty: 0, trade: 0 }
    cur.qty += c.qty
    cur.trade += c.trade
    byId.set(id, cur)
  }
  const ids = [...byId.keys()].sort((a, b) => a - b)

  const out: number[] = [game.length, ...game]
  pushVarint(out, owner.length)
  out.push(...owner)
  pushVarint(out, Math.floor(payload.createdAt / 1000))
  pushVarint(out, ids.length)
  let prev = 0
  for (const id of ids) {
    const c = byId.get(id)!
    pushVarint(out, id - prev)
    pushVarint(out, c.qty)
    pushVarint(out, Math.min(c.trade, c.qty))
    prev = id
  }
  return SHARE_PREFIX + toBase32(deflateRaw(Uint8Array.from(out)))
}

export function decodeShare(text: string): SharePayload {
  const t = text.replace(/\s+/g, '').toUpperCase() // copier-coller : espaces, retours, casse
  const m = /^CMSHARE(\d+):(.*)$/.exec(t)
  if (!m) throw new ShareCodeError('INVALID')
  if (m[1] !== '1') throw new ShareCodeError('UNSUPPORTED_VERSION')

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
  for (let i = 0; i < count; i++) {
    id += r.varint()
    const qty = r.varint()
    const trade = r.varint()
    if (qty === 0 || trade > qty) throw new ShareCodeError('INVALID')
    cards.push({ id: String(id), qty, trade })
  }
  if (!r.done || !game) throw new ShareCodeError('INVALID')
  return { game, owner, createdAt, cards }
}
