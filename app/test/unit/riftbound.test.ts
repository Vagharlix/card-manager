import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabases, type TestDatabases } from './helpers/testDb'

// ============================================================
// Riftbound de bout en bout sur un échantillon RiftHunt réel
// (fixtures/rifthunt-sample.json : fichier en masse + objets « carte »)
// écrit par le vrai importeur : mise à jour incrémentale, bannissements,
// recherche, fiche, règles de deck (règle 103), collection, partage, scan.
// ============================================================

const h = vi.hoisted(() => ({
  dbs: null as unknown as TestDatabases,
  invoked: [] as { cmd: string; args: unknown }[],
}))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: unknown) => {
    h.invoked.push({ cmd, args })
    if (cmd === 'image_sources_count') return 0
    if (cmd === 'image_sources_set') return Object.keys((args as { sources: object }).sources).length
    throw new Error(`unexpected invoke ${cmd}`)
  },
  convertFileSrc: (p: string) => p,
}))

const { mapRiftbound, imageHint, collectorFromRiotId, banRows } = await import(
  '~/services/riftboundData/import'
)
const rbSync = await import('~/services/riftboundData/sync')
const { searchCards, countCards } = await import('~/services/search')
const { getCardDetail } = await import('~/services/card/detail')
const { readableText } = await import('~/services/card/riftbound')
const decks = await import('~/services/decks')
const collection = await import('~/services/collection')
const share = await import('~/services/share')
const { identifyCard, canScan } = await import('~/services/scan')
const { rbCollectorNumbers } = await import('~/services/scan/riftbound')
const { riftboundDeckEngine } = await import('~/services/deck/riftbound')

type Bulk = import('~/services/riftboundData/import').RiftHuntBulk
type ApiCard = import('~/services/riftboundData/import').RiftHuntCard

const SAMPLE = JSON.parse(
  readFileSync(new URL('./fixtures/rifthunt-sample.json', import.meta.url), 'utf8')
) as { bulk: Bulk; prints: ApiCard[] }
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

// impression(s) d'après le nom imprimé ; base = variante « base »
const printsOf = (name: string) => SAMPLE.bulk.cards.filter((c) => c.cleanName === name)
const base = (name: string) =>
  (printsOf(name).find((c) => c.variant === 'base') ?? printsOf(name)[0]!).printing_id
const byRiotId = (rid: string) => SAMPLE.bulk.cards.find((c) => c.riftboundId === rid)!.printing_id

let dbs: TestDatabases
beforeEach(async () => {
  dbs = createTestDatabases()
  h.dbs = dbs
  h.invoked = []
  await rbSync.writeRiftbound(dbs.riftbound as never, mapRiftbound(SAMPLE.bulk, SAMPLE.prints))
})
afterEach(() => {
  for (const db of [dbs.user, dbs.ygo, dbs.mtg, dbs.riftbound]) db.close()
})

const q = <T>(sql: string, ...p: (string | number)[]) =>
  dbs.riftbound.raw.prepare(sql).all(...p) as T[]
const one = <T>(sql: string, ...p: (string | number)[]) => q<T>(sql, ...p)[0]!
const names = (r: { name: string }[]) => r.map((x) => x.name)

describe('import', () => {
  it('une impression par carte, cartes logiques, impression par défaut, contrat', () => {
    const n = SAMPLE.bulk.cards.length
    expect(one<{ n: number }>(`SELECT COUNT(*) AS n FROM cards`).n).toBe(n)
    expect(one<{ n: number }>(`SELECT COUNT(*) AS n FROM card_hashes`).n).toBe(n)
    expect(one<{ n: number }>(`SELECT COUNT(*) AS n FROM rb_cards`).n).toBe(
      new Set(SAMPLE.bulk.cards.map((c) => c.oracle_id)).size
    )
    // la « base » est l'impression par défaut (pas la promo Metal, pas la signée)
    const jinx = one<{ default_print: string; domains: string; tags: string }>(
      `SELECT default_print, domains, tags FROM rb_cards WHERE name = 'Jinx, Loose Cannon'`
    )
    expect(jinx).toEqual({ default_print: byRiotId('ogn-251-298'), domains: 'Fury,Chaos', tags: 'Jinx' })
    // nom de la carte logique partout, nom imprimé gardé
    expect(
      one(`SELECT c.name, p.printed_name, p.collector_number FROM cards c
           JOIN rb_prints p ON p.card_id = c.id WHERE p.riftbound_id = 'ogn-301*-298'`)
    ).toEqual({
      name: 'Jinx, Loose Cannon',
      printed_name: 'Jinx, Loose Cannon (Signature)',
      collector_number: '301s',
    })
    // contrat : card_meta, printings
    expect(one(`SELECT root, type FROM card_meta WHERE card_id = ?`, base('Jinx, Demolitionist'))).toEqual({
      root: SAMPLE.bulk.cards.find((c) => c.cleanName === 'Jinx, Demolitionist')!.oracle_id,
      type: 'Champion Unit',
    })
    expect(one(`SELECT set_code FROM printings WHERE id = ?`, base('Fury Rune'))).toEqual({
      set_code: 'OGN #007',
    })
    // images : indice relatif, refait par Rust
    expect(one<{ image_url: string }>(`SELECT image_url FROM cards WHERE id = ?`, base('Blazing Scorcher')).image_url).toMatch(
      /^ogn\/001\/blazing-scorcher\.webp\?v=[a-z0-9]+$/
    )
  })

  it('outils : indice d’image sûr, numéro d’après l’id de Riot', () => {
    expect(imageHint('https://images.rifthunt.com/cards/small/front/ogn/001/x.webp?v=1')).toBe(
      'ogn/001/x.webp?v=1'
    )
    expect(imageHint('https://evil.com/cards/small/front/x.webp')).toBeNull()
    expect(imageHint('https://images.rifthunt.com/cards/small/front/../x')).toBeNull()
    expect(collectorFromRiotId('ogn-007a-298')).toBe('007a')
    expect(collectorFromRiotId('ogn-299*-298')).toBe('299s')
    expect(collectorFromRiotId('rad-r01')).toBe('r01')
    expect(collectorFromRiotId('tcg:662914')).toBe('')
  })

  it('légalités : bannissements datés, jetons, limites de deck', () => {
    const brynhir = SAMPLE.bulk.cards.find((c) => c.cleanName === 'Brynhir Thundersong')!.oracle_id
    expect(q(`SELECT format, status FROM card_legality WHERE card_id = ? ORDER BY format`, brynhir)).toEqual([
      { format: '2v2', status: 'banned' },
      { format: 'standard', status: 'banned' },
    ])
    const token = SAMPLE.bulk.cards.find((c) => c.supertype === 'Token')!.oracle_id
    expect(q(`SELECT status FROM card_legality WHERE card_id = ? AND format = 'standard'`, token)).toEqual([
      { status: 'not_legal' },
    ])
    const rune = SAMPLE.bulk.cards.find((c) => c.cleanName === 'Fury Rune')!.oracle_id
    expect(q(`SELECT status FROM card_legality WHERE card_id = ? AND format = 'deck_limit'`, rune)).toEqual([
      { status: '12' },
    ])
    // bannissement annoncé : légal jusqu'à sa date
    dbs.riftbound.raw.exec(`UPDATE rb_legality SET status = 'legal', since = '2999-01-01' WHERE oracle_id = '${brynhir}'`)
    expect(q(`SELECT status FROM card_legality WHERE card_id = ? AND format != 'deck_limit'`, brynhir)).toEqual([])
    dbs.riftbound.raw.exec(`UPDATE rb_legality SET since = '2000-01-01' WHERE oracle_id = '${brynhir}'`)
    expect(q(`SELECT status FROM card_legality WHERE card_id = ?`, brynhir)).toHaveLength(2)
  })
})

describe('mise à jour incrémentale', () => {
  it('même catalogue : rien n’est réécrit', async () => {
    const before = dbs.riftbound.queries
    const stats = await rbSync.writeRiftbound(dbs.riftbound as never, mapRiftbound(SAMPLE.bulk, SAMPLE.prints))
    expect(stats).toEqual({ changed: 0, removed: 0, unchanged: SAMPLE.bulk.cards.length })
    expect(dbs.riftbound.queries - before).toBeLessThan(15)
  })

  it('errata, nouvelle impression, impression retirée', async () => {
    const bulk = clone(SAMPLE.bulk)
    const scorcher = bulk.cards.find((c) => c.cleanName === 'Blazing Scorcher')!
    scorcher.text = 'Errata text.'
    const gone = bulk.cards.findIndex((c) => c.cleanName === 'Pouty Poro')
    bulk.cards.splice(gone, 1)
    bulk.cards.push({ ...clone(scorcher), printing_id: 'new-print', variant: null, rarity: 'Promo', name: 'Blazing Scorcher (Metal)' })
    const stats = await rbSync.writeRiftbound(dbs.riftbound as never, mapRiftbound(bulk, SAMPLE.prints))
    expect(stats.changed).toBe(2) // l'errata + la nouvelle impression
    expect(stats.removed).toBe(1)
    expect(one(`SELECT text FROM rb_cards WHERE name = 'Blazing Scorcher'`)).toEqual({ text: 'Errata text.' })
    expect(q(`SELECT name FROM rb_cards WHERE name = 'Pouty Poro'`)).toEqual([])
    expect(q(`SELECT card_id FROM card_meta WHERE card_id = ?`, base('Pouty Poro'))).toEqual([])
    // index plein texte suivi
    expect(names(await searchCards('riftbound', { query: 'errata', field: 'effect' }))).toEqual(['Blazing Scorcher'])
    expect(await searchCards('riftbound', { query: 'pouty' })).toEqual([])
    // l'impression par défaut reste la « base »
    expect(one(`SELECT default_print FROM rb_cards WHERE name = 'Blazing Scorcher'`)).toEqual({
      default_print: scorcher.printing_id,
    })
  })

  function fakeSource(bulk: Bulk, prints: ApiCard[], bans: ApiCard[] = []) {
    const calls: string[] = []
    const source = {
      sets: async () => {
        calls.push('sets')
        return bulk.sets
      },
      bans: async () => {
        calls.push('bans')
        return bans
      },
      bulk: async () => {
        calls.push('bulk')
        return bulk
      },
      prints: async () => {
        calls.push('prints')
        return prints
      },
    }
    return { source, calls }
  }

  it('vérification quotidienne : bannissements seuls tant que les extensions ne changent pas', async () => {
    const fresh = createTestDatabases()
    h.dbs = fresh
    try {
      const db = fresh.riftbound as never
      let f = fakeSource(SAMPLE.bulk, SAMPLE.prints)
      expect((await rbSync.updateRiftbound(db, f.source)).catalog).toBe(true)
      expect(f.calls).toEqual(['sets', 'bulk', 'prints'])

      // extensions identiques : pas de téléchargement du catalogue
      const poro = SAMPLE.prints.find((p) => p.id === base('Pouty Poro'))!
      const banned = { ...poro, legalities: { standard: { status: 'legal', banned_from: '2999-01-01' } } }
      f = fakeSource(SAMPLE.bulk, SAMPLE.prints, [banned])
      const stats = await rbSync.updateRiftbound(db, f.source)
      // Poro annoncé ; les 3 cartes bannies de l'échantillon ne sont plus listées
      expect(stats).toMatchObject({ catalog: false, changed: 4 })
      expect(f.calls).toEqual(['sets', 'bans'])
      expect(fresh.riftbound.raw.prepare(`SELECT since FROM rb_legality WHERE oracle_id = ?`).all(poro.oracle_id)).toEqual([
        { since: '2999-01-01' },
      ])
      // les jetons gardent leur « not_legal »
      expect(
        fresh.riftbound.raw.prepare(`SELECT COUNT(*) AS n FROM rb_legality WHERE status = 'not_legal'`).get()
      ).toEqual({ n: 2 })

      // une extension complétée : catalogue relu ; force : tout réécrit
      const more = clone(SAMPLE.bulk)
      more.sets[0]!.count += 1
      f = fakeSource(more, SAMPLE.prints)
      expect((await rbSync.updateRiftbound(db, f.source)).catalog).toBe(true)
      f = fakeSource(more, SAMPLE.prints)
      expect((await rbSync.updateRiftbound(db, f.source, { force: true })).changed).toBe(SAMPLE.bulk.cards.length)
      // tous les FULL_DAYS jours : catalogue relu même sans changement d'extension
      f = fakeSource(more, SAMPLE.prints)
      const later = new Date(Date.now() + (rbSync.FULL_DAYS + 1) * 86_400_000)
      expect((await rbSync.updateRiftbound(db, f.source, { now: later })).catalog).toBe(true)
    } finally {
      for (const db of [fresh.user, fresh.ygo, fresh.mtg, fresh.riftbound]) db.close()
      h.dbs = dbs
    }
  })

  it('syncRiftbound : bilan, indices d’images envoyés à Rust, au plus une vérification par jour', async () => {
    const fresh = createTestDatabases()
    h.dbs = fresh
    try {
      const f = fakeSource(SAMPLE.bulk, SAMPLE.prints)
      expect(await rbSync.syncRiftbound({}, f.source)).toEqual({
        changed: SAMPLE.bulk.cards.length,
        removed: 0,
      })
      const set = h.invoked.find((i) => i.cmd === 'image_sources_set')!
      expect(set.args).toMatchObject({ game: 'riftbound' })
      expect(Object.keys((set.args as { sources: object }).sources)).toHaveLength(SAMPLE.bulk.cards.length)
      // au lancement : vérifiée il y a moins de AUTO_HOURS heures → rien
      f.calls.length = 0
      expect(await rbSync.syncRiftbound({ auto: true }, f.source)).toBeNull()
      expect(f.calls).toEqual([])
      expect(await rbSync.localRiftboundVersion()).toBe(SAMPLE.bulk.fetched)
    } finally {
      for (const db of [fresh.user, fresh.ygo, fresh.mtg, fresh.riftbound]) db.close()
      h.dbs = dbs
    }
  })

  it('ban:any / ban:upcoming → lignes de statut', () => {
    expect(
      banRows([
        { id: 'a', oracle_id: 'o1', legalities: { standard: { status: 'banned', banned_from: '2026-01-01' }, '2v2': { status: 'legal', banned_from: null } } },
        { id: 'b', oracle_id: 'o2', legalities: { standard: { status: 'not_legal', banned_from: null } } },
      ])
    ).toEqual([{ oracle_id: 'o1', format: 'standard', status: 'banned', since: '2026-01-01' }])
  })
})

describe('recherche', () => {
  it('une ligne par carte logique, nom exact puis « Nom, … » en tête', async () => {
    const jinx = names(await searchCards('riftbound', { query: 'jinx' }))
    expect(jinx.slice(0, 3).sort()).toEqual(['Jinx, Demolitionist', 'Jinx, Loose Cannon', 'Jinx, Rebel'])
    expect(new Set(jinx).size).toBe(jinx.length)
    expect(names(await searchCards('riftbound', { query: "kai'sa daughter" }))).toEqual([
      "Kai'Sa, Daughter of the Void",
    ])
    // l'id renvoyé est l'impression par défaut
    expect((await searchCards('riftbound', { query: 'Jinx, Loose Cannon' }))[0]!.id).toBe(byRiotId('ogn-251-298'))
    // texte et étiquettes
    expect(names(await searchCards('riftbound', { query: 'zaun', field: 'effect' }))).toContain('Chemtech Enforcer')
  })

  it('filtres : domaines, types, supertype, énergie, extension, format', async () => {
    const both = names(await searchCards('riftbound', { filters: { domains: ['Fury', 'Chaos'] } }))
    expect(both).toContain('Jinx, Loose Cannon')
    expect(both).not.toContain('Blazing Scorcher')
    expect(names(await searchCards('riftbound', { filters: { types: ['Battlefield'] } }))).toHaveLength(4)
    expect(names(await searchCards('riftbound', { filters: { supertype: 'Champion', domains: ['Chaos'] } }))).toEqual([
      'Jinx, Rebel',
    ])
    const cheap = await searchCards('riftbound', { filters: { types: ['Unit'], energy: { op: '<=', value: 2 }, domains: ['Fury'] } })
    expect(cheap.length).toBeGreaterThan(0)
    expect(names(await searchCards('riftbound', { filters: { set: 'sfd' } }))).toEqual(['Draven, Vanquisher'])
    const legal = names(await searchCards('riftbound', { filters: { format: 'standard' }, limit: 500 }))
    expect(legal).not.toContain('Brynhir Thundersong')
    expect(legal).not.toContain('Draven, Vanquisher')
    expect(await countCards('riftbound', { filters: { colorless: true, types: ['Battlefield'] } })).toBe(4)
  })
})

describe('fiche', () => {
  it('toutes les impressions (variantes nommées), texte lisible, bannissements', async () => {
    const d = (await getCardDetail('riftbound', base('Jinx, Loose Cannon')))!
    expect(d.name).toBe('Jinx, Loose Cannon')
    expect(d.printings.map((p) => p.cardId).sort()).toEqual(printsOf('Jinx, Loose Cannon').map((c) => c.printing_id).sort())
    const labels = d.printings.map((p) => `${p.setName} — ${p.setCode}`)
    expect(labels).toContain('Origins · Signature — OGN #301s')
    expect(labels.some((l) => l.includes('Metal'))).toBe(true)
    expect(d.facts).toEqual(expect.arrayContaining([{ label: 'Type', value: 'Legend' }, { label: 'Domains', value: 'Fury, Chaos' }]))
    const banned = (await getCardDetail('riftbound', base('Brynhir Thundersong')))!
    expect(banned.badges.map((b) => b.label)).toEqual(['Banned in 2v2', 'Banned in Standard'].sort())
    expect(readableText('Pay :rb_energy_2::rb_rune_fury: or :rb_rune_rainbow:, :rb_might:')).toBe(
      'Pay [2][Fury] or [Any rune], [Might]'
    )
  })
})

describe('decks : règles de construction (règle 103)', () => {
  const FURY = [
    'Blazing Scorcher', 'Brazen Buccaneer', 'Chemtech Enforcer', 'Cleave', 'Disintegrate',
    'Flame Chompers', 'Get Excited!', 'Hextech Ray', 'Legion Rearguard', 'Magma Wurm',
    'Noxus Hopeful', 'Pouty Poro', 'Sky Splitter',
  ]
  const add = async (deck: string, cardId: string, n = 1) => {
    let last = { ok: true } as Awaited<ReturnType<typeof decks.addCardToDeck>>
    for (let i = 0; i < n; i++) last = await decks.addCardToDeck(deck, 'riftbound', cardId)
    return last
  }
  async function legalDeck() {
    const deck = await decks.createDeck('riftbound', 'Jinx', 'standard')
    await add(deck, base('Jinx, Loose Cannon'))
    await add(deck, base('Jinx, Demolitionist'))
    await decks.moveCardBoard(deck, 'riftbound', base('Jinx, Demolitionist'), null, 'main', 'champion')
    for (const n of FURY) await add(deck, base(n), 3) // 39 + champion = 40
    await add(deck, base('Fury Rune'), 6)
    await add(deck, base('Chaos Rune'), 6)
    // (Aspirant's Climb est banni en Standard)
    for (const bf of ['Altar to Unity', 'Back-Alley Bar', 'Bandle Tree']) await add(deck, base(bf))
    return deck
  }
  const codes = async (deck: string) => (await decks.getDeckState(deck)).issues.map((i) => i.code)

  it('placement automatique et limites de copies', async () => {
    const e = riftboundDeckEngine
    expect(e.boardForCard({ cardId: 'x', type: 'Legend' })).toBe('legend')
    expect(e.boardForCard({ cardId: 'x', type: 'Basic Rune' })).toBe('runes')
    expect(e.boardForCard({ cardId: 'x', type: 'Battlefield' })).toBe('battlefields')
    expect(e.boardForCard({ cardId: 'x', type: 'Champion Unit' })).toBe('main')
    const deck = await decks.createDeck('riftbound', 'Limits')
    // 3 copies d'un nom, toutes impressions confondues
    const [a, b] = printsOf('Jinx, Demolitionist').map((c) => c.printing_id)
    await add(deck, a!, 2)
    expect(await add(deck, b!)).toMatchObject({ ok: true })
    expect(await add(deck, b!)).toMatchObject({ ok: false, limit: 3 })
    // runes : 12 ; légende, champ de bataille : 1
    expect((await add(deck, base('Fury Rune'), 12)).ok).toBe(true)
    expect(await add(deck, base('Fury Rune'))).toMatchObject({ ok: false, limit: 12 })
    expect((await add(deck, base('Bandle Tree'))).ok).toBe(true)
    expect(await add(deck, base('Bandle Tree'))).toMatchObject({ ok: false, limit: 1 })
    expect(await add(deck, base("Aspirant's Climb"))).toMatchObject({ ok: false, formatStatus: 'banned' })
    // banni (standard), pas en casual ; jeton : jamais
    expect(await add(deck, base('Brynhir Thundersong'))).toMatchObject({ ok: false, limit: 0, formatStatus: 'banned' })
    const casual = await decks.createDeck('riftbound', 'Casual', 'casual')
    expect((await add(casual, base('Brynhir Thundersong'))).ok).toBe(true)
    const token = SAMPLE.bulk.cards.find((c) => c.supertype === 'Token')!.printing_id
    expect(await add(casual, token)).toMatchObject({ ok: false, limit: 0 })
    const c = await decks.getDeckContents(deck)
    expect(c.runes).toMatchObject([{ quantity: 12 }])
    expect(c.battlefields).toMatchObject([{ quantity: 1 }])
    expect(c.legend ?? []).toEqual([])
  })

  it('un deck complet est légal ; chaque règle manquante est signalée', async () => {
    const deck = await legalDeck()
    expect(await codes(deck)).toEqual([])
    expect((await decks.validateDeck(deck)).valid).toBe(true)

    // pas de légende, deck trop court, runes et champs de bataille incomplets
    const empty = await decks.createDeck('riftbound', 'Empty')
    expect(await codes(empty)).toEqual(['legend', 'champion', 'main', 'runes', 'battlefields'])

    // champion qui ne correspond pas à la légende
    await decks.moveCardBoard(deck, 'riftbound', base('Jinx, Demolitionist'), null, 'champion', 'main')
    await add(deck, base('Draven, Vanquisher'))
    await decks.moveCardBoard(deck, 'riftbound', base('Draven, Vanquisher'), null, 'main', 'champion')
    const issues = (await decks.getDeckState(deck)).issues
    expect(issues.find((i) => i.code === 'champion')?.message).toMatch(/Draven, Vanquisher does not match/)
    // une unité qui n'est pas un champion
    await decks.moveCardBoard(deck, 'riftbound', base('Draven, Vanquisher'), null, 'champion', 'main')
    await decks.moveCardBoard(deck, 'riftbound', base('Blazing Scorcher'), null, 'main', 'champion')
    expect((await decks.getDeckState(deck)).issues.find((i) => i.code === 'champion')?.message).toMatch(
      /not a Champion unit/
    )
  })

  it('identité de domaines, signatures, zones', async () => {
    const deck = await legalDeck()
    // une carte Calm hors de l'identité Fury / Chaos
    await add(deck, base('Clockwork Keeper'))
    // signature d'une autre légende (Kai'Sa) et signature multi-domaines d'Annie
    await add(deck, base('Icathian Rain'))
    await add(deck, base('Tibbers'))
    const issues = (await decks.getDeckState(deck)).issues
    expect(issues.map((i) => i.code).sort()).toEqual(['identity', 'signature-tag'])
    expect(issues.find((i) => i.code === 'identity')!.message).toMatch(/Clockwork Keeper/)
    expect(issues.find((i) => i.code === 'identity')!.message).toMatch(/Icathian Rain/) // Mind
    expect(issues.find((i) => i.code === 'signature-tag')!.message).toMatch(/Icathian Rain, Tibbers/)
    // 4 signatures : trop
    await add(deck, base('Super Mega Death Rocket!'), 2)
    expect(await codes(deck)).toContain('signatures')
    // rune déplacée dans le deck principal : mauvaise zone
    await decks.moveCardBoard(deck, 'riftbound', base('Fury Rune'), null, 'runes', 'main')
    expect(await codes(deck)).toEqual(expect.arrayContaining(['zone', 'runes']))
  })
})

describe('collection, partage', () => {
  it('impressions regroupées par carte logique ; partage v2 croisé', async () => {
    const [a, b] = printsOf('Jinx, Demolitionist').map((c) => c.printing_id)
    await collection.addCard({ game: 'riftbound', cardId: a!, printingId: a!, quantity: 1 })
    await collection.addCard({ game: 'riftbound', cardId: b!, printingId: b!, quantity: 2, tradeQty: 1 })
    expect(await collection.listCollectionCards('riftbound')).toMatchObject([
      { name: 'Jinx, Demolitionist', totalQty: 3, tradeQty: 1, displayId: b },
    ])
    const code = await share.shareCode('riftbound', { owner: 'Félix' })
    expect(code).toMatch(/^CMSHARE2:/)
    expect(await share.resolveShare(share.decodeShare(code))).toMatchObject([
      { name: 'Jinx, Demolitionist', qty: 3, trade: 1, mine: 3 },
    ])
  })
})

describe('scan', () => {
  it('numéros de collection lus en bas de carte', () => {
    expect(rbCollectorNumbers([{ text: 'OGN • 030/298' }, { text: '007a / 298  R' }, { text: '301★/298' }])).toEqual([
      { number: '030', total: '298' },
      { number: '007a', total: '298' },
      { number: '301*', total: '298' },
    ])
    expect(rbCollectorNumbers([{ text: 'O3O/298' }])).toEqual([{ number: '030', total: '298' }])
    expect(rbCollectorNumbers([{ text: '2025 Riot Games' }])).toEqual([])
  })

  it('identifie l’impression exacte (même la promo Metal), sinon la carte par son nom', async () => {
    expect(canScan('riftbound')).toBe(true)
    expect(
      await identifyCard('riftbound', [
        { text: 'Jinx, Demolitionist', y: 5 },
        { text: 'OGN • 030/298', y: 900 },
      ])
    ).toMatchObject({ cardId: byRiotId('ogn-030-298'), printingLabel: 'OGN #030', via: 'setcode' })
    expect(await identifyCard('riftbound', [{ text: '030a/298', y: 900 }])).toMatchObject({
      cardId: byRiotId('ogn-030a-298'),
    })
    expect(await identifyCard('riftbound', [{ text: 'OGN 301*/298', y: 900 }])).toMatchObject({
      printingLabel: 'OGN #301s',
    })
    // l'id de Riot est partagé avec des promos : l'extension lue départage
    expect(
      await identifyCard('riftbound', [
        { text: 'Jinx, Loose Cannon', y: 5 },
        { text: 'OPP 251/298', y: 900 },
      ])
    ).toMatchObject({ printingLabel: 'OPP #251' })
    expect(
      await identifyCard('riftbound', [
        { text: 'Jinx, Loose Cannon', y: 5 },
        { text: '251/298', y: 900 },
      ])
    ).toMatchObject({ cardId: byRiotId('ogn-251-298') })
    // nom seul, légèrement mal lu
    expect(await identifyCard('riftbound', [{ text: 'Blazing Scorchcr', y: 5 }])).toMatchObject({
      cardId: base('Blazing Scorcher'),
      via: 'name',
    })
    expect(await identifyCard('riftbound', [{ text: 'Totally Unknown Card', y: 5 }])).toBeNull()
  })
})
