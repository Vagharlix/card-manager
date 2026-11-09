import { createReadStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { describe, expect, it, vi } from 'vitest'
import { createTestDatabases, type TestDatabases } from './helpers/testDb'

// ============================================================
// Import du VRAI fichier Scryfall complet (~110 000 impressions) : ne tourne
// que si MTG_GZ pointe sur un default-cards-*.jsonl.gz téléchargé, ex.
//   MTG_GZ=/tmp/default.jsonl.gz npx vitest run test/unit/mtgFullImport.test.ts
// Vérifie volumes, durée et nombre de requêtes, recherche et scan réels.
// ============================================================

const h = vi.hoisted(() => ({ dbs: null as unknown as TestDatabases }))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))

const FILE = process.env.MTG_GZ

describe.skipIf(!FILE)('import Scryfall complet', () => {
  it('importe, cherche, identifie', { timeout: 600_000 }, async () => {
    const { importMtg } = await import('~/services/mtgData/sync')
    const { SCRYFALL_KEYS } = await import('~/services/mtgData/import')
    const { searchCards } = await import('~/services/search')
    const { identifyCard } = await import('~/services/scan')
    h.dbs = createTestDatabases()
    const lines = createInterface({ input: createReadStream(FILE!).pipe(createGunzip()) })[
      Symbol.asyncIterator
    ]()
    const next = async () => {
      const items: Record<string, unknown>[] = []
      while (items.length < 500) {
        const r = await lines.next()
        if (r.done) return { items, read: 1, total: 1, done: true }
        const o = JSON.parse(r.value)
        items.push(Object.fromEntries(SCRYFALL_KEYS.filter((k) => k in o).map((k) => [k, o[k]])))
      }
      return { items, read: 0, total: 1, done: false }
    }
    const t0 = performance.now()
    const q0 = h.dbs.mtg.queries
    const stats = await importMtg(h.dbs.mtg as never, next as never, 'full')
    const ms = performance.now() - t0
    console.log(stats, Math.round(ms), 'ms', h.dbs.mtg.queries - q0, 'queries')
    expect(stats.prints).toBeGreaterThan(100_000)
    expect(h.dbs.mtg.queries - q0).toBeLessThan(2_000) // lots, pas une requête par carte

    expect((await searchCards('mtg', { query: 'lightning bolt', limit: 1 }))[0]?.name).toBe(
      'Lightning Bolt'
    )
    const m10 = await identifyCard('mtg', [
      { text: 'Lightning Bolt', y: 10 },
      { text: '0146 C', y: 900 },
      { text: 'M10 • EN', y: 920 },
    ])
    expect(m10).toMatchObject({ via: 'setcode', printingLabel: 'M10 #146', language: 'en' })
  })
})
