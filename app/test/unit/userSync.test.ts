import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabases, type TestDatabases } from './helpers/testDb'
import { createSeeder } from './helpers/seed'

// ============================================================
// synchro entre appareils — deux bases (« PC » et « téléphone ») qui
// partagent un état publié (transport mémoire, qui imite Drive :
// écriture conditionnelle à la version lue). Les données sont créées
// par les vrais services de l'appli.
// ============================================================

const h = vi.hoisted(() => ({ dbs: null as unknown as TestDatabases }))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))

const { syncNow, MemoryTransport, SyncError, lastBackup } = await import('~/services/userSync')
const { USER_SCHEMA_VERSION } = await import('~/services/userSync/tables')
const { mergeTables, repairTables } = await import('~/services/userSync/merge')
const { addCard, updateCard, removeCard, entriesForCard } = await import('~/services/collection')
const containers = await import('~/services/containers')
const decks = await import('~/services/decks')
const settings = await import('~/services/settings')
const { noteUserWrite, resetUserWrites } = await import('~/utils/userWrites')

const DM = '46986414'
const POT = '55144522'
const BEWD = '89631139'

let pc: TestDatabases
let phone: TestDatabases
let cloud: InstanceType<typeof MemoryTransport>
let clock = Date.UTC(2026, 10, 6, 10, 0, 0)

function device(): TestDatabases {
  const dbs = createTestDatabases()
  const seed = createSeeder(dbs)
  seed.card(DM, 'Dark Magician', null, { type: 'Normal Monster' })
  seed.card(POT, 'Pot of Greed', null, { type: 'Spell Card' })
  seed.card(BEWD, 'Blue-Eyes White Dragon', null, { type: 'Normal Monster' })
  return dbs
}

/** exécute `fn` « sur » un appareil (les services lisent h.dbs) */
async function on<T>(dbs: TestDatabases, fn: () => Promise<T>): Promise<T> {
  h.dbs = dbs
  settings.invalidateSettingsCache() // cache module-level, propre à chaque appareil
  vi.setSystemTime((clock += 1000)) // horodatages strictement croissants
  return fn()
}

const sync = (dbs: TestDatabases) => on(dbs, () => syncNow(cloud))

function rows(dbs: TestDatabases, sql: string): any[] {
  return dbs.user.raw.prepare(sql).all() as any[]
}

const owned = (dbs: TestDatabases) =>
  rows(dbs, `SELECT card_id, quantity FROM collection WHERE deleted_at IS NULL ORDER BY card_id`)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  pc = device()
  phone = device()
  cloud = new MemoryTransport()
})

afterEach(() => {
  vi.useRealTimers()
  for (const d of [pc, phone]) {
    d.user.close()
    d.ygo.close()
  }
})

it('la version de schéma suit les migrations user/', () => {
  const dir = fileURLToPath(new URL('../../../src-tauri/migrations/user', import.meta.url))
  expect(readdirSync(dir).filter((f) => f.endsWith('.sql'))).toHaveLength(USER_SCHEMA_VERSION)
})

describe('premières synchros', () => {
  it('le PC publie, le téléphone vide récupère tout', async () => {
    await on(pc, () => addCard({ game: 'ygo', cardId: DM, quantity: 2 }))
    await on(pc, () => containers.createDeckbox('Magiciens'))

    const first = await sync(pc)
    expect(first).toMatchObject({ pulled: false, pushed: true })

    const second = await sync(phone)
    expect(second.pulled).toBe(true)
    expect(second.applied.inserted).toBeGreaterThan(0)
    expect(owned(phone)).toEqual([{ card_id: DM, quantity: 2 }])
    expect(rows(phone, `SELECT name FROM containers`)).toEqual([{ name: 'Magiciens' }])
  })

  it('deux appareils déjà remplis, jamais synchronisés : union, rien de perdu', async () => {
    await on(pc, () => addCard({ game: 'ygo', cardId: DM }))
    await on(phone, () => addCard({ game: 'ygo', cardId: POT }))
    await sync(pc)
    await sync(phone)
    await sync(pc)
    expect(owned(pc)).toEqual(owned(phone))
    expect(owned(pc).map((r) => r.card_id)).toEqual([DM, POT].sort())
  })

  it('resynchroniser sans changement ne republie rien', async () => {
    await on(pc, () => addCard({ game: 'ygo', cardId: DM }))
    await sync(pc)
    const again = await sync(pc)
    expect(again).toMatchObject({ pushed: false, applied: { inserted: 0, updated: 0, deleted: 0 } })
  })
})

describe('modifications des deux côtés', () => {
  beforeEach(async () => {
    await on(pc, () => addCard({ game: 'ygo', cardId: DM, quantity: 3 }))
    await sync(pc)
    await sync(phone)
  })

  const entryId = (dbs: TestDatabases) =>
    rows(dbs, `SELECT id FROM collection WHERE card_id = '${DM}'`)[0].id as string

  it('ajouts en parallèle : tous gardés (un ajout ne crée jamais de conflit)', async () => {
    await on(pc, () => addCard({ game: 'ygo', cardId: POT }))
    await on(phone, () => addCard({ game: 'ygo', cardId: BEWD }))
    await sync(pc)
    const r = await sync(phone)
    await sync(pc)
    expect(r.conflicts).toEqual([])
    expect(owned(pc)).toEqual(owned(phone))
    expect(owned(pc)).toHaveLength(3)
  })

  it('champs différents d’un même exemplaire : les deux modifications sont gardées', async () => {
    await on(pc, () => updateCard(entryId(pc), { tradeQty: 1 }))
    await on(phone, () => updateCard(entryId(phone), { condition: 'LP' }))
    await sync(pc)
    const r = await sync(phone)
    await sync(pc)
    for (const d of [pc, phone]) {
      expect(rows(d, `SELECT condition, trade_qty FROM collection`)).toEqual([
        { condition: 'LP', trade_qty: 1 },
      ])
    }
    expect(r.conflicts.filter((c) => c.kind === 'field')).toEqual([])
  })

  it('même champ modifié des deux côtés : la modification la plus récente gagne', async () => {
    await on(phone, () => updateCard(entryId(phone), { quantity: 5 })) // plus ancienne
    await on(pc, () => updateCard(entryId(pc), { quantity: 1 })) // plus récente
    await sync(phone) // le téléphone publie d'abord
    const r = await sync(pc)
    await sync(phone)
    expect(owned(pc)).toEqual([{ card_id: DM, quantity: 1 }])
    expect(owned(phone)).toEqual([{ card_id: DM, quantity: 1 }])
    expect(r.conflicts).toMatchObject([
      { table: 'collection', kind: 'field', columns: ['quantity'], kept: 'local' },
    ])
  })

  it('retirée sur le téléphone, modifiée sur le PC : retirée partout, modification gardée', async () => {
    await on(phone, () => removeCard(entryId(phone)))
    await on(pc, () => updateCard(entryId(pc), { condition: 'HP' }))
    await sync(phone)
    await sync(pc)
    await sync(phone)
    for (const d of [pc, phone]) {
      const [row] = rows(d, `SELECT condition, deleted_at FROM collection`)
      expect(row.deleted_at).not.toBeNull()
      expect(row.condition).toBe('HP')
    }
  })

  it('suppression simple (ligne de deck) : propagée', async () => {
    const deckId = await on(pc, () => decks.createDeck('ygo', 'Magiciens'))
    await on(pc, () => decks.addCardToDeck(deckId, 'ygo', DM, 'Normal Monster'))
    await sync(pc)
    await sync(phone)
    expect(rows(phone, `SELECT card_id FROM deck_cards`)).toHaveLength(1)

    await on(phone, () => decks.removeCardFromDeck(deckId, DM, 'main'))
    expect(rows(phone, `SELECT * FROM deck_cards`)).toHaveLength(0)
    await sync(phone)
    await sync(pc)
    expect(rows(pc, `SELECT * FROM deck_cards`)).toHaveLength(0)
  })
})

describe('règles de l’appli rétablies après fusion', () => {
  it('rangée dans un conteneur supprimé ailleurs : la carte redevient non rangée', async () => {
    const box = await on(pc, () => containers.createBulkBox('Vrac'))
    await on(pc, () => addCard({ game: 'ygo', cardId: DM }))
    await sync(pc)
    await sync(phone)

    await on(pc, () => containers.deleteContainer(box))
    await on(phone, () => containers.assignCardToContainer('ygo', DM, box, 'bulk_box', 1))
    await sync(pc)
    await sync(phone)
    await sync(pc)
    for (const d of [pc, phone]) {
      expect(await on(d, () => containers.unrangedCount('ygo'))).toBe(1)
    }
  })

  it('plus de copies rangées que d’exemplaires : le rangement est réduit', async () => {
    const box = await on(pc, () => containers.createDeckbox('Deck'))
    await on(pc, () => addCard({ game: 'ygo', cardId: DM, quantity: 3 }))
    await sync(pc)
    await sync(phone)
    const id = rows(pc, `SELECT id FROM collection`)[0].id

    await on(pc, () => updateCard(id, { quantity: 1 })) // le PC n'en a plus qu'une
    await on(phone, () => containers.assignCardToContainer('ygo', DM, box, 'deckbox', 3))
    await sync(pc)
    const r = await sync(phone)
    await sync(pc)
    expect(r.fixes).toBeGreaterThan(0)
    for (const d of [pc, phone]) {
      expect(rows(d, `SELECT SUM(quantity) AS n FROM deckbox_cards`)[0].n).toBe(1)
    }
  })

  it('deux cartes dans la même case de classeur : une seule reste, l’autre redevient non rangée', async () => {
    const binder = await on(pc, () => containers.createBinder('Classeur', 1))
    await on(pc, () => addCard({ game: 'ygo', cardId: DM }))
    await on(pc, () => addCard({ game: 'ygo', cardId: POT }))
    await sync(pc)
    await sync(phone)

    await on(pc, () => containers.assignCardToBinderSlot('ygo', DM, binder, 0, 0, 0))
    await on(phone, () => containers.assignCardToBinderSlot('ygo', POT, binder, 0, 0, 0))
    await sync(pc)
    await sync(phone)
    await sync(pc)
    for (const d of [pc, phone]) {
      expect(
        rows(d, `SELECT card_id FROM binder_slots bs JOIN collection c ON c.id = bs.collection_id`)
      ).toEqual([
        { card_id: DM }, // publiée en premier
      ])
      expect(await on(d, () => containers.unrangedCount('ygo'))).toBe(1)
    }
  })
})

describe('réglages', () => {
  it('les réglages d’ajout et le nom se partagent, pas ceux propres à l’appareil', async () => {
    await on(pc, () => settings.setShareOwnerName('Félix'))
    await on(pc, () => settings.setGameSetting('ygo', 'default_language', 'fr'))
    await on(pc, () => settings.setImageCacheLimitMb(999))
    await sync(pc)
    await sync(phone)
    expect(await on(phone, () => settings.getShareOwnerName())).toBe('Félix')
    expect(await on(phone, () => settings.getDefaultLanguage('ygo'))).toBe('fr')
    expect((await on(phone, () => settings.getGlobalSettings())).imageCacheLimitMb).toBe(200)
  })
})

// dans l'appli, useDatabase compte les écritures de user.db : ici, la base
// de test ne les compte pas, on les note à la main après chaque service
describe('synchro au retour dans l’appli (compteur d’écritures)', () => {
  afterEach(() => resetUserWrites(false))

  it('rien écrit ici, rien publié ailleurs : une vérification de version, aucune requête', async () => {
    resetUserWrites(true)
    await on(pc, () => addCard({ game: 'ygo', cardId: DM }))
    noteUserWrite()
    await sync(pc) // complète (1re de la session)
    const queries = pc.user.queries
    const checks = cloud.versionChecks
    const r = await sync(pc)
    expect(pc.user.queries).toBe(queries)
    expect(cloud.versionChecks).toBe(checks + 1)
    expect(r).toMatchObject({ pushed: false, applied: { inserted: 0, updated: 0, deleted: 0 } })
  })

  it('une écriture locale relance une vraie synchro', async () => {
    resetUserWrites(true)
    await on(pc, () => addCard({ game: 'ygo', cardId: DM }))
    noteUserWrite()
    await sync(pc)
    await on(pc, () => addCard({ game: 'ygo', cardId: POT }))
    noteUserWrite()
    expect((await sync(pc)).pushed).toBe(true)
    resetUserWrites(false)
    await sync(phone)
    expect(owned(phone).map((r) => r.card_id)).toEqual([DM, POT].sort())
  })

  it('une publication d’un autre appareil relance une vraie synchro', async () => {
    resetUserWrites(true)
    await on(pc, () => addCard({ game: 'ygo', cardId: DM }))
    noteUserWrite()
    await sync(pc)
    // un autre appareil republie (nouvelle version) ; rien écrit ici
    const published = await cloud.pull()
    cloud.publish(published!.snapshot)
    const queries = pc.user.queries
    await sync(pc)
    expect(pc.user.queries).toBeGreaterThan(queries) // relue et comparée
  })
})

describe('synchro sans changement', () => {
  it('rien de neuf ni ici ni ailleurs : ni téléchargement ni réécriture', async () => {
    await on(pc, () => addCard({ game: 'ygo', cardId: DM }))
    await sync(pc)
    const pull = vi.spyOn(cloud, 'pull')
    const r = await sync(pc)
    expect(pull).not.toHaveBeenCalled()
    expect(cloud.versionChecks).toBeGreaterThan(0)
    expect(r).toMatchObject({ pushed: false, applied: { inserted: 0, updated: 0, deleted: 0 } })
  })

  it('un changement local, ou publié ailleurs, relance une vraie synchro', async () => {
    await on(pc, () => addCard({ game: 'ygo', cardId: DM }))
    await sync(pc)
    await sync(phone)
    await on(pc, () => addCard({ game: 'ygo', cardId: POT })) // changement local
    expect((await sync(pc)).pushed).toBe(true)
    const r = await sync(phone) // publié ailleurs
    expect(r.applied.inserted).toBe(1)
  })
})

describe('écriture conditionnelle', () => {
  it('un autre appareil publie pendant la synchro : on refusionne, rien n’est écrasé', async () => {
    await on(pc, () => addCard({ game: 'ygo', cardId: DM }))
    await sync(pc)
    await sync(phone)
    await on(phone, () => addCard({ game: 'ygo', cardId: POT }))
    await on(pc, () => addCard({ game: 'ygo', cardId: BEWD }))
    // le PC lit l'état publié… puis le téléphone publie avant que le PC n'écrive
    const stale = await cloud.pull()
    await sync(phone)
    const realPull = cloud.pull.bind(cloud)
    let first = true
    cloud.pull = async () => {
      if (!first) return realPull()
      first = false
      return stale
    }
    const r = await on(pc, () => syncNow(cloud))
    expect(r.attempts).toBe(2)
    await sync(phone)
    expect(owned(pc)).toEqual(owned(phone))
    expect(owned(pc)).toHaveLength(3)
  })

  it('état publié par une version plus récente de l’appli : refusé', async () => {
    cloud.publish({
      protocol: 1,
      schema: USER_SCHEMA_VERSION + 1,
      deviceId: 'futur',
      createdAt: '',
      tables: {},
    })
    await expect(sync(pc)).rejects.toThrow(SyncError)
    await expect(sync(pc)).rejects.toMatchObject({ code: 'REMOTE_NEWER' })
  })

  it('état publié par une version plus ancienne : colonnes manquantes conservées', async () => {
    await on(pc, () => addCard({ game: 'ygo', cardId: DM, rarity: 'Ultra Rare' }))
    await sync(pc)
    const old = structuredClone(cloud.published!.snapshot)
    old.schema = 7
    for (const r of old.tables.collection!) {
      delete r.rarity
      delete r.first_edition
    }
    old.tables.collection![0]!.quantity = 4 // modifié par l'ancienne appli
    cloud.publish(old)
    await sync(pc)
    expect(rows(pc, `SELECT quantity, rarity FROM collection`)).toEqual([
      { quantity: 4, rarity: 'Ultra Rare' },
    ])
  })

  it('l’état local est sauvegardé avant d’être modifié par une fusion', async () => {
    await on(pc, () => addCard({ game: 'ygo', cardId: DM }))
    await sync(pc)
    await on(phone, () => addCard({ game: 'ygo', cardId: POT }))
    await sync(phone)
    const backup = await on(phone, () => lastBackup())
    expect(backup?.tables.collection?.map((r) => r.card_id)).toEqual([POT])
  })
})

describe('fusion (fonctions pures)', () => {
  const row = (id: string, extra: object = {}) => ({ id, name: 'x', updated_at: 'a', ...extra })

  it('sans base, une ligne présente d’un seul côté est gardée', () => {
    const out = mergeTables(null, { decks: [row('1')] }, { decks: [row('2')] })
    expect(out.tables.decks!.map((r) => r.id).sort()).toEqual(['1', '2'])
  })

  it('avec base, une ligne absente d’un côté et inchangée de l’autre est supprimée', () => {
    const base = { decks: [row('1')] }
    const out = mergeTables(base, { decks: [] }, { decks: [row('1')] })
    expect(out.tables.decks).toEqual([])
  })

  it('les horodatages seuls ne comptent pas comme conflit', () => {
    const base = { settings: [{ key: 'share_owner_name', value: 'a', updated_at: '1' }] }
    const out = mergeTables(
      base,
      { settings: [{ key: 'share_owner_name', value: 'a', updated_at: '2' }] },
      { settings: [{ key: 'share_owner_name', value: 'a', updated_at: '3' }] }
    )
    expect(out.conflicts).toEqual([])
    expect(out.tables.settings![0]!.updated_at).toBe('3')
  })

  it('réparation : trade_qty ramené à la quantité', () => {
    const r = repairTables({
      collection: [{ id: 'c', quantity: 1, trade_qty: 3, deleted_at: null }],
    })
    expect(r.tables.collection![0]!.trade_qty).toBe(1)
    expect(r.fixes).toBe(1)
  })
})

it('les entrées d’un appareil sont relisibles par les services après synchro', async () => {
  await on(pc, () => addCard({ game: 'ygo', cardId: DM, firstEdition: true, rarity: 'Ultra Rare' }))
  await sync(pc)
  await sync(phone)
  const [e] = await on(phone, () => entriesForCard('ygo', DM))
  expect(e).toMatchObject({ firstEdition: true, rarity: 'Ultra Rare' })
})
