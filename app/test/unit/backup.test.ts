import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabases, type TestDatabases } from './helpers/testDb'
import { createSeeder } from './helpers/seed'

// ============================================================
// sauvegarde — export / import complet, annulation, CSV.
// ============================================================

const h = vi.hoisted(() => ({ dbs: null as unknown as TestDatabases }))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))

const backup = await import('~/services/backup')
const { addCard } = await import('~/services/collection')
const containers = await import('~/services/containers')
const { USER_SCHEMA_VERSION } = await import('~/services/userSync/tables')

const DM = '46986414'
const POT = '55144522'

let a: TestDatabases
let b: TestDatabases

function device() {
  const dbs = createTestDatabases()
  const seed = createSeeder(dbs)
  seed.card(DM, 'Dark Magician')
  seed.card(POT, 'Pot of Greed, "the" card')
  return dbs
}

const owned = (d: TestDatabases) =>
  d.user.raw
    .prepare(`SELECT card_id, quantity FROM collection WHERE deleted_at IS NULL ORDER BY card_id`)
    .all()

beforeEach(() => {
  a = device()
  b = device()
})

afterEach(() => {
  for (const d of [a, b]) {
    d.user.close()
    d.ygo.close()
  }
})

describe('export / import', () => {
  it('un fichier exporté sur un appareil se réimporte tel quel sur un autre', async () => {
    h.dbs = a
    await addCard({ game: 'ygo', cardId: DM, quantity: 2, rarity: 'Ultra Rare' })
    const box = await containers.createDeckbox('Magiciens')
    await containers.assignCardToContainer('ygo', DM, box, 'deckbox', 2)
    const file = await backup.exportBackup()

    h.dbs = b
    await addCard({ game: 'ygo', cardId: POT }) // remplacé par l'import
    const s = await backup.importBackup(file)
    expect(s.cards).toBe(1)
    expect(owned(b)).toEqual([{ card_id: DM, quantity: 2 }])
    expect(b.user.raw.prepare(`SELECT name FROM containers`).all()).toEqual([{ name: 'Magiciens' }])
    expect(b.user.raw.prepare(`SELECT quantity FROM deckbox_cards`).all()).toEqual([
      { quantity: 2 },
    ])
  })

  it('l’import s’annule, et l’annulation s’annule aussi', async () => {
    h.dbs = a
    await addCard({ game: 'ygo', cardId: DM })
    const file = await backup.exportBackup()
    h.dbs = b
    await addCard({ game: 'ygo', cardId: POT })
    await backup.importBackup(file)
    expect(await backup.restorePoint()).not.toBeNull()

    await backup.restoreLastBackup()
    expect(owned(b)).toEqual([{ card_id: POT, quantity: 1 }])
    await backup.restoreLastBackup()
    expect(owned(b)).toEqual([{ card_id: DM, quantity: 1 }])
  })

  it('rien à restaurer → erreur explicite', async () => {
    h.dbs = a
    expect(await backup.restorePoint()).toBeNull()
    await expect(backup.restoreLastBackup()).rejects.toMatchObject({ code: 'NOTHING' })
  })

  it('fichier invalide ou d’une version plus récente : refusé', () => {
    expect(() => backup.parseBackup('pas du json')).toThrow(/not a card-manager backup/)
    expect(() => backup.parseBackup('{"kind":"autre","tables":{}}')).toThrow(/not a card-manager/)
    const newer = JSON.stringify({
      kind: backup.BACKUP_KIND,
      schema: USER_SCHEMA_VERSION + 1,
      tables: {},
    })
    expect(() => backup.parseBackup(newer)).toThrow(backup.BackupError)
  })

  it('l’état de synchro (compte Google, base) ne fait pas partie de la sauvegarde', async () => {
    h.dbs = a
    a.user.raw
      .prepare(
        `INSERT INTO sync_state (key, value, updated_at) VALUES ('google_account', '{}', '')`
      )
      .run()
    const file = JSON.parse(await backup.exportBackup())
    expect(Object.keys(file.tables)).not.toContain('sync_state')
    expect(JSON.stringify(file)).not.toContain('google_account')
  })
})

describe('CSV', () => {
  it('une ligne par exemplaire, avec le nom, échappé si besoin', async () => {
    h.dbs = a
    await addCard({ game: 'ygo', cardId: DM, quantity: 3, firstEdition: true, tradeQty: 1 })
    await addCard({ game: 'ygo', cardId: POT, notes: 'abîmée, coin plié' })
    const csv = await backup.exportCollectionCsv()
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe(
      'game,card_id,name,set_code,rarity,first_edition,language,condition,quantity,for_trade,foil,notes'
    )
    expect(lines).toHaveLength(3)
    expect(lines[1]).toMatch(/^ygo,46986414,Dark Magician,,,yes,en,NM,3,1,,$/)
    expect(lines[2]).toContain('"Pot of Greed, ""the"" card"')
    expect(lines[2]).toContain('"abîmée, coin plié"')
  })

  it('noms de fichiers datés', () => {
    const d = new Date('2026-11-09T10:00:00Z')
    expect(backup.backupFileName('json', d)).toBe('card-manager-backup-2026-11-09.json')
    expect(backup.backupFileName('csv', d)).toBe('card-manager-collection-2026-11-09.csv')
  })
})
