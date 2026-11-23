import { afterAll, describe, expect, it, vi } from 'vitest'
import { createTestDatabases, type TestDatabases } from './helpers/testDb'

// ============================================================
// Mise à jour Riftbound sur le VRAI catalogue RiftHunt (réseau), avec la
// vraie source (requêtes card_data_get remplacées par fetch) : pagination
// par extension, jointure fichier en masse ↔ objets « carte », indices
// d'images, puis une 2e mise à jour qui ne doit rien réécrire.
// Lancé seulement avec RB_LIVE=1 :
//   cd app && RB_LIVE=1 npx vitest run test/unit/riftboundLive.test.ts
// ============================================================

const h = vi.hoisted(() => ({ dbs: null as unknown as TestDatabases }))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: { url: string }) => {
    if (cmd !== 'card_data_get') throw new Error(`unexpected invoke ${cmd}`)
    const res = await fetch(args.url, {
      headers: { 'User-Agent': 'card-manager/0.1 (+https://github.com/Vagharlix/card-manager)' },
    })
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
    return res.text()
  },
}))

const { updateRiftbound, riftHuntSource } = await import('~/services/riftboundData/sync')

describe.skipIf(!process.env.RB_LIVE)('RiftHunt réel', () => {
  const dbs = createTestDatabases()
  h.dbs = dbs
  afterAll(() => {
    for (const db of [dbs.user, dbs.ygo, dbs.mtg, dbs.riftbound]) db.close()
  })
  const q = <T>(sql: string) => dbs.riftbound.raw.prepare(sql).all() as T[]

  it('catalogue complet, puis rien à réécrire', async () => {
    const t0 = Date.now()
    const first = await updateRiftbound(dbs.riftbound as never, riftHuntSource)
    const ms = Date.now() - t0
    console.log('RiftHunt', first, `${ms} ms`, `${dbs.riftbound.queries} requêtes`)
    expect(first.catalog).toBe(true)
    expect(first.changed).toBeGreaterThan(1500)
    const [stats] = q<{ prints: number; oracles: number; noImage: number; noNumber: number }>(
      `SELECT (SELECT COUNT(*) FROM rb_prints) AS prints, (SELECT COUNT(*) FROM rb_cards) AS oracles,
              (SELECT COUNT(*) FROM cards WHERE image_url IS NULL) AS noImage,
              (SELECT COUNT(*) FROM rb_prints WHERE collector_number = '') AS noNumber`
    )
    console.log(stats)
    expect(stats!.noImage).toBe(0)
    expect(stats!.noNumber).toBe(0)
    expect(q(`SELECT COUNT(*) AS n FROM rb_cards WHERE default_print NOT IN (SELECT card_id FROM rb_prints)`)).toEqual([{ n: 0 }])
    expect(q<{ n: number }>(`SELECT COUNT(DISTINCT card_id) AS n FROM card_legality WHERE status = 'banned'`)[0]!.n).toBeGreaterThan(5)

    // 2e passage forcé sur le catalogue (même contenu) : rien d'écrit
    const again = await updateRiftbound(dbs.riftbound as never, riftHuntSource, {
      now: new Date(Date.now() + 40 * 86_400_000),
    })
    expect(again).toMatchObject({ catalog: true, changed: 0, removed: 0 })
  }, 300_000)
})
