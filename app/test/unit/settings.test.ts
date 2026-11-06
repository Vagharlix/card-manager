import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabases, type TestDatabases } from './helpers/testDb'

// ============================================================
// settings — clé/valeur en base, cache mémoire, réglages typés,
// défauts par jeu venant du registre (jamais en base).
// ============================================================

const h = vi.hoisted(() => ({ dbs: null as unknown as TestDatabases }))
vi.mock('~/composables/useDatabase', () => ({
  useDatabase: async () => h.dbs,
  resetDatabaseInstance: () => {},
}))

const s = await import('~/services/settings')
const { gameDef } = await import('~/services/game')

let dbs: TestDatabases

beforeEach(() => {
  dbs = createTestDatabases()
  h.dbs = dbs
  s.invalidateSettingsCache() // cache module-level
})

const stored = (key: string) =>
  (
    dbs.user.raw.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
      | { value: string }
      | undefined
  )?.value

describe('réglages globaux', () => {
  it('valeurs initiales (graines de la migration 002), décodées en vrais types', async () => {
    expect(await s.getGlobalSettings()).toEqual({
      favoriteGame: '',
      showGamePicker: true,
      imageCacheLimitMb: 200,
    })
  })

  it('écriture : en base et dans le cache', async () => {
    await s.getGlobalSettings() // remplit le cache
    await s.setFavoriteGame('ygo')
    await s.setShowGamePicker(false)
    expect(stored('favorite_game')).toBe('ygo')
    expect(stored('show_game_picker')).toBe('false')
    expect(await s.getGlobalSettings()).toMatchObject({
      favoriteGame: 'ygo',
      showGamePicker: false,
    })
  })

  it('limite du cache d’images : entière et jamais négative', async () => {
    await s.setImageCacheLimitMb(150.6)
    expect(stored('image_cache_limit_mb')).toBe('151')
    await s.setImageCacheLimitMb(-20)
    expect((await s.getGlobalSettings()).imageCacheLimitMb).toBe(0)
  })

  it('nom de partage : vide par défaut, espaces retirés', async () => {
    expect(await s.getShareOwnerName()).toBe('')
    await s.setShareOwnerName('  Félix  ')
    expect(await s.getShareOwnerName()).toBe('Félix')
  })

  it('une clé absente de la base retombe sur son défaut', async () => {
    dbs.user.raw.exec(`DELETE FROM settings WHERE key = 'image_cache_limit_mb'`)
    expect((await s.getGlobalSettings()).imageCacheLimitMb).toBe(200)
  })

  it('le cache évite de relire la base ; invalidate force la relecture', async () => {
    await s.getShareOwnerName()
    dbs.user.raw.exec(
      `INSERT INTO settings (key, value, updated_at) VALUES ('share_owner_name', 'Ailleurs', '')`
    )
    expect(await s.getShareOwnerName()).toBe('') // valeur en cache
    s.invalidateSettingsCache()
    expect(await s.getShareOwnerName()).toBe('Ailleurs')
  })

  it('setSetting remplace une valeur existante (pas de doublon)', async () => {
    await s.setSetting('favorite_game', 'a')
    await s.setSetting('favorite_game', 'b')
    const n = dbs.user.raw
      .prepare(`SELECT COUNT(*) AS n FROM settings WHERE key = 'favorite_game'`)
      .get() as { n: number }
    expect(n.n).toBe(1)
    expect(stored('favorite_game')).toBe('b')
  })
})

describe('réglages par jeu', () => {
  it('sans réglage : défauts du registre du jeu, rien en base', async () => {
    const def = gameDef('ygo')
    expect(await s.getGameSettings('ygo')).toEqual({
      defaultCondition: def.defaultCondition,
      defaultLanguage: def.defaultLanguage,
    })
    expect(await s.getGameOverride('ygo', 'default_condition')).toBeNull()
    expect(stored('ygo.default_condition')).toBeUndefined()
  })

  it('un réglage par jeu, stocké sous « jeu.clé », ne touche pas les autres jeux', async () => {
    await s.setGameSetting('ygo', 'default_language', 'fr')
    expect(stored('ygo.default_language')).toBe('fr')
    expect(await s.getDefaultLanguage('ygo')).toBe('fr')
    expect(await s.getDefaultLanguage('mtg')).not.toBe('fr')
  })

  it('jeu inconnu : défauts génériques, sans erreur', async () => {
    expect(typeof (await s.getDefaultCondition('inconnu'))).toBe('string')
    expect(typeof (await s.getDefaultLanguage('inconnu'))).toBe('string')
  })

  it('l’ancienne clé globale default_language ne s’applique plus aux jeux', async () => {
    await s.setSetting('default_language', 'de')
    expect(await s.getDefaultLanguage('ygo')).toBe(gameDef('ygo').defaultLanguage)
  })
})
