<template>
  <AppPage sidebar-label="Sections" title="Settings" :mobile-sidebar="false">
    <template #leading>
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        size="lg"
        to="/collection"
        aria-label="Back"
      />
    </template>
    <template #sidebar>
      <nav class="flex flex-col gap-1">
        <button
          v-for="section in sections"
          :key="section.id"
          :data-section="section.id"
          class="text-left px-3 py-2 rounded-md text-sm"
          :class="active === section.id ? 'bg-elevated text-primary' : 'hover:bg-elevated'"
          @click="active = section.id"
        >
          {{ section.label }}
        </button>
      </nav>
    </template>

    <!-- desktop : une section à la fois ; mobile : toutes à la suite, en cartes -->
    <div class="h-full overflow-y-auto" :class="isMobile && 'space-y-4 pb-6'">
      <!-- ── Synchronisation entre appareils (compte Google, Drive) ── -->
      <section v-if="show('devices')" :class="sectionClass" data-section-body="devices">
        <h2 :class="titleClass">Sync between devices</h2>
        <p class="text-xs text-muted">
          Keep your collection, storage and decks the same on your computer and phone, through your
          Google account (a hidden app folder in your Drive, separate from your files).
        </p>

        <p v-if="!gAvailable" class="text-sm text-muted">
          Not available in this version of the app.
        </p>

        <template v-else-if="!gAccount">
          <UButton
            id="gsync-connect"
            label="Sign in with Google"
            icon="i-lucide-log-in"
            :size="fieldSize"
            :block="isMobile"
            :loading="gBusy"
            @click="onGoogleConnect"
          />
          <p v-if="gBusy && !isAndroidDevice" class="text-xs text-muted">
            Finish signing in in the browser that just opened.
          </p>
        </template>

        <template v-else>
          <div class="space-y-1">
            <p class="text-sm font-medium" data-gsync-email>
              {{ gAccount.email ?? 'Google account connected' }}
            </p>
            <p class="text-xs text-muted" :data-gsync-last="gLast?.at ?? ''">
              {{ gLast ? `Last sync: ${formatDateTime(gLast.at)}` : 'Never synced' }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2" :class="isMobile && 'flex-col'">
            <UButton
              id="gsync-now"
              label="Sync now"
              icon="i-lucide-refresh-cw"
              :size="fieldSize"
              :block="isMobile"
              :loading="deviceSync.syncing.value"
              @click="onGoogleSync"
            />
            <UButton
              id="gsync-disconnect"
              label="Sign out"
              icon="i-lucide-log-out"
              color="neutral"
              variant="soft"
              :size="fieldSize"
              :block="isMobile"
              :disabled="deviceSync.syncing.value"
              @click="onGoogleDisconnect"
            />
          </div>
          <p class="text-xs text-muted">
            Sync also runs at every launch. If the same item was changed on both devices, the most
            recent change wins.
          </p>
        </template>
      </section>

      <!-- ── Sauvegarde (fichier, indépendante de Google) ── -->
      <section v-if="show('backup')" :class="sectionClass" data-section-body="backup">
        <h2 :class="titleClass">Backup</h2>
        <p class="text-xs text-muted">
          Save your whole collection (cards, storage, decks) to a file, to keep a copy or move to
          another device.
        </p>
        <div class="flex flex-wrap gap-2" :class="isMobile && 'flex-col'">
          <UButton
            id="backup-export"
            label="Export backup"
            icon="i-lucide-download"
            :size="fieldSize"
            :block="isMobile"
            :loading="backupBusy === 'export'"
            @click="onExportBackup"
          />
          <UButton
            id="backup-import"
            label="Import backup"
            icon="i-lucide-upload"
            color="neutral"
            variant="soft"
            :size="fieldSize"
            :block="isMobile"
            :loading="backupBusy === 'import'"
            @click="onPickBackup"
          />
          <UButton
            id="backup-csv"
            label="Export collection (CSV)"
            icon="i-lucide-sheet"
            color="neutral"
            variant="soft"
            :size="fieldSize"
            :block="isMobile"
            :loading="backupBusy === 'csv'"
            @click="onExportCsv"
          />
        </div>
        <div v-if="restore" class="space-y-1">
          <p class="text-sm font-medium">Undo last sync or import</p>
          <p class="text-xs text-muted" :data-restore-point="restore.createdAt">
            Goes back to your data as it was on {{ formatDateTime(restore.createdAt) }}. You can
            undo this too.
          </p>
          <UButton
            id="backup-restore"
            label="Restore"
            icon="i-lucide-history"
            color="neutral"
            variant="soft"
            :size="fieldSize"
            :block="isMobile"
            :loading="backupBusy === 'restore'"
            @click="onRestore"
          />
        </div>
      </section>

      <UModal v-model:open="importConfirmOpen" title="Import this backup?">
        <template #body>
          <p class="text-sm text-muted">
            Your current data will be replaced by the backup. You can go back with “Undo last sync
            or import” afterwards.
          </p>
        </template>
        <template #footer="{ close }">
          <div class="flex gap-2 justify-end w-full">
            <UButton label="Cancel" color="neutral" variant="ghost" @click="close" />
            <UButton
              id="backup-import-confirm"
              label="Replace my data"
              color="error"
              icon="i-lucide-upload"
              :loading="backupBusy === 'import'"
              @click="onConfirmImport"
            />
          </div>
        </template>
      </UModal>

      <!-- ── Collection ── -->
      <section v-if="show('collection')" :class="sectionClass" data-section-body="collection">
        <h2 :class="titleClass">Adding cards</h2>
        <p class="text-xs text-muted">Values used when you quickly add a card ({{ gameLabel }}).</p>

        <div class="space-y-1">
          <p class="text-sm font-medium">Default condition</p>
          <USelect
            :model-value="games[GAME]?.defaultCondition"
            :items="conditionItems"
            :size="fieldSize"
            :class="fieldClass"
            @update:model-value="onDefaultCondition"
          />
        </div>

        <div class="space-y-1">
          <p class="text-sm font-medium">Default language</p>
          <USelect
            :model-value="games[GAME]?.defaultLanguage"
            :items="languageItems"
            :size="fieldSize"
            :class="fieldClass"
            @update:model-value="onDefaultLanguage"
          />
        </div>
      </section>

      <!-- ── Partage ── -->
      <section v-if="show('share')" :class="sectionClass" data-section-body="share">
        <h2 :class="titleClass">Sharing</h2>
        <div class="space-y-1">
          <p class="text-sm font-medium">My name</p>
          <p class="text-xs text-muted">Shown to people who receive my collection.</p>
          <UInput
            id="settings-owner-name"
            v-model="ownerName"
            placeholder="Your name"
            :size="fieldSize"
            :class="fieldClass"
            @blur="saveOwnerName"
          />
        </div>
      </section>

      <!-- ── Apparence ── -->
      <section v-if="show('appearance')" :class="sectionClass" data-section-body="appearance">
        <h2 :class="titleClass">Appearance</h2>
        <div class="space-y-1">
          <p class="text-sm font-medium">Theme</p>
          <USelect
            id="settings-color-mode"
            v-model="colorMode.preference"
            :items="colorModeItems"
            :size="fieldSize"
            :class="fieldClass"
          />
        </div>
      </section>

      <!-- ── Synchronisation ── -->
      <section v-if="show('sync')" :class="sectionClass" data-section-body="sync">
        <h2 :class="titleClass">Card database</h2>

        <div class="space-y-1">
          <p class="text-sm font-medium">{{ gameLabel }} card database</p>
          <p class="text-xs text-muted" :data-sync-version="localVersion ?? ''">
            {{ localVersion ? `Version ${localVersion}` : 'Never downloaded' }}
          </p>
        </div>

        <div class="flex flex-wrap gap-2" :class="isMobile && 'flex-col'">
          <UButton
            id="sync-check-btn"
            label="Check for updates"
            icon="i-lucide-refresh-cw"
            :size="fieldSize"
            :block="isMobile"
            :loading="isSyncing"
            @click="checkUpdates"
          />
          <UButton
            id="sync-force-btn"
            label="Download everything again"
            icon="i-lucide-download"
            color="neutral"
            variant="soft"
            :size="fieldSize"
            :block="isMobile"
            :disabled="isSyncing"
            @click="forceResync"
          />
        </div>
        <p class="text-xs text-muted">
          Downloads all cards again (needs a connection, a few minutes). Your collection and decks
          are not touched.
        </p>
      </section>

      <!-- ── Stockage ── -->
      <section v-if="show('storage')" :class="sectionClass" data-section-body="storage">
        <h2 :class="titleClass">Storage</h2>

        <div class="space-y-1">
          <p class="text-sm font-medium">Image cache</p>
          <p id="image-cache-size" class="text-xs text-muted" :data-cache-bytes="cacheBytes ?? ''">
            {{ cacheBytes === null ? '…' : `${formatBytes(cacheBytes)} used` }}
          </p>
        </div>

        <div class="space-y-1">
          <p class="text-sm font-medium">Image cache limit (MB)</p>
          <p class="text-xs text-muted">
            Above this, the least recently shown images are deleted (applied when saved and at every
            launch).
          </p>
          <UInput
            v-model.number="cacheLimit"
            type="number"
            min="0"
            :size="fieldSize"
            :class="isMobile ? 'w-full' : 'w-32'"
            @blur="saveCacheLimit"
          />
        </div>

        <div>
          <UButton
            id="image-cache-clear"
            label="Clear image cache"
            icon="i-lucide-trash-2"
            color="error"
            variant="soft"
            :size="fieldSize"
            :block="isMobile"
            :loading="clearing"
            @click="clearCache"
          />
        </div>
      </section>

      <!-- ── Jeux ── -->
      <section v-if="show('games')" :class="sectionClass" data-section-body="games">
        <h2 :class="titleClass">Games</h2>

        <div class="space-y-1">
          <p class="text-sm font-medium">Favorite game</p>
          <p class="text-xs text-muted">Opens this game at launch without asking.</p>
          <USelect
            :model-value="global.favoriteGame || NONE"
            :items="favoriteGameItems"
            :size="fieldSize"
            :class="fieldClass"
            @update:model-value="onFavoriteGame"
          />
        </div>

        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-sm font-medium">Show the game picker</p>
            <p class="text-xs text-muted">Ask which game to open at launch.</p>
          </div>
          <USwitch :model-value="global.showGamePicker" @update:model-value="onShowGamePicker" />
        </div>
      </section>
    </div>
  </AppPage>
</template>

<script setup lang="ts">
import { gameDef, allGames } from '~/services/game'
import {
  imageCacheSize,
  clearImageCache,
  pruneImageCache,
  formatBytes,
} from '~/services/imageCache'
import { syncYgo, localSyncVersion, isSyncing } from '~/services/sync'
import { getShareOwnerName, setShareOwnerName } from '~/services/settings'
import {
  googleAvailable,
  googleAccount,
  connectGoogle,
  disconnectGoogle,
  GoogleError,
} from '~/services/userSync/google'
import { lastSync, type LastSync } from '~/services/userSync/cloud'
import { forgetSyncBase } from '~/services/userSync'
import {
  exportBackup,
  importBackup,
  parseBackup,
  exportCollectionCsv,
  restorePoint,
  restoreLastBackup,
  backupFileName,
  type RestorePoint,
} from '~/services/backup'

// un seul jeu pour l'instant ; quand un 2e arrive, la section Collection
// gagnera un sélecteur de jeu et GAME deviendra réactif.
const GAME = 'ygo'

const sections = [
  { id: 'devices', label: 'Sync' },
  { id: 'backup', label: 'Backup' },
  { id: 'collection', label: 'Adding cards' },
  { id: 'share', label: 'Sharing' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'sync', label: 'Card database' },
  { id: 'storage', label: 'Storage' },
  { id: 'games', label: 'Games' },
]
const active = ref('devices')

const { isMobile } = useResponsive()
const show = (id: string) => isMobile.value || active.value === id
const sectionClass = computed(() =>
  isMobile.value
    ? 'space-y-4 rounded-2xl border border-default bg-elevated p-4'
    : 'space-y-6 max-w-md'
)
const titleClass = computed(() =>
  isMobile.value
    ? 'text-xs font-semibold text-muted uppercase tracking-wide'
    : 'text-lg font-medium'
)
const fieldSize = computed(() => (isMobile.value ? 'lg' : 'sm'))
const fieldClass = computed(() => (isMobile.value ? 'w-full' : 'w-56'))

// ── apparence ──
const colorMode = useColorMode()
const colorModeItems = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
]

// ── partage : nom affiché chez les autres (même réglage que la page Partage) ──
const ownerName = ref('')
async function saveOwnerName() {
  await setShareOwnerName(ownerName.value.trim())
}

const {
  global,
  games,
  ensureLoaded,
  ensureGame,
  setFavoriteGame,
  setShowGamePicker,
  setImageCacheLimitMb,
  setGameDefault,
} = useSettings()

// chargement avant rendu (page = Suspense Nuxt, top-level await OK)
await ensureLoaded()
await ensureGame(GAME)

const toast = useToast()

// ── items dérivés du REGISTRE (source unique de vérité) ──
// NONE : Reka UI interdit un item avec value='' (réservé au clear/placeholder),
// donc on utilise une sentinelle qu'on retraduit en '' au stockage.
const NONE = '__none__'
const favoriteGameItems = [
  { label: 'None', value: NONE },
  ...allGames().map((g) => ({ label: g.label, value: g.id })),
]
const def = gameDef(GAME)
const gameLabel = def.label
const conditionItems = def.conditions.map((c) => ({ label: c.label, value: c.id }))
const languageItems = def.languages.map((l) => ({ label: l.label, value: l.id }))

// ── handlers write-through (typés string/bool comme onFormatChange) ──
const onFavoriteGame = (v: string) => setFavoriteGame(v === NONE ? '' : v)
const onShowGamePicker = (v: boolean) => setShowGamePicker(v)
const onDefaultCondition = (v: string) => setGameDefault(GAME, 'default_condition', v)
const onDefaultLanguage = (v: string) => setGameDefault(GAME, 'default_language', v)

// ── cache d'images ──
const cacheBytes = ref<number | null>(null)
const clearing = ref(false)

async function refreshCacheSize() {
  try {
    cacheBytes.value = await imageCacheSize()
  } catch {
    cacheBytes.value = null
  }
}

// limite persistée au blur (pas à chaque frappe), puis appliquée tout de suite
const cacheLimit = ref(global.imageCacheLimitMb)
async function saveCacheLimit() {
  await setImageCacheLimitMb(cacheLimit.value)
  try {
    await pruneImageCache(global.imageCacheLimitMb)
  } finally {
    await refreshCacheSize()
  }
}

async function clearCache() {
  clearing.value = true
  try {
    await clearImageCache()
    toast.add({ title: 'Image cache cleared', icon: 'i-lucide-check', color: 'success' })
  } catch {
    toast.add({ title: 'Could not clear the cache', color: 'error' })
  } finally {
    clearing.value = false
    await refreshCacheSize()
  }
}

// ── synchronisation (la progression s'affiche dans l'overlay global d'app.vue) ──
const localVersion = ref<string | null>(null)

async function refreshVersion() {
  try {
    localVersion.value = await localSyncVersion()
  } catch {
    localVersion.value = null
  }
}

async function runSync(force: boolean) {
  try {
    await syncYgo({ force })
    toast.add({ title: 'Card database up to date', icon: 'i-lucide-check', color: 'success' })
  } catch {
    // l'overlay d'app.vue affiche déjà l'erreur avec un bouton « Retry »
  } finally {
    await refreshVersion()
  }
}
const checkUpdates = () => runSync(false)
const forceResync = () => runSync(true)

// ── synchronisation entre appareils ──
const deviceSync = useDeviceSync()
const gAvailable = googleAvailable()
const isAndroidDevice = isAndroid()
const gAccount = ref<{ email: string | null } | null>(null)
const gLast = ref<LastSync | null>(null)
const gBusy = ref(false)

async function refreshGoogle() {
  gAccount.value = await googleAccount()
  gLast.value = await lastSync()
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

async function onGoogleSync() {
  try {
    const r = await deviceSync.run()
    if (!r) return
    const changes = r.applied.inserted + r.applied.updated + r.applied.deleted
    toast.add({
      title: changes ? `Synced: ${changes} change(s) received` : 'Already up to date',
      description: r.conflicts.length
        ? `${r.conflicts.length} item(s) changed on both devices: the most recent change was kept.`
        : undefined,
      icon: 'i-lucide-check',
      color: 'success',
    })
  } catch (e) {
    toast.add({ title: syncErrorMessage(e), color: 'error' })
  } finally {
    await refreshGoogle()
    await refreshRestore()
  }
}

async function onGoogleConnect() {
  gBusy.value = true
  try {
    await connectGoogle()
    await refreshGoogle()
    await onGoogleSync()
  } catch (e) {
    if (!(e instanceof GoogleError && e.code === 'CANCELLED'))
      toast.add({ title: syncErrorMessage(e), color: 'error' })
  } finally {
    gBusy.value = false
  }
}

async function onGoogleDisconnect() {
  await disconnectGoogle()
  await forgetSyncBase() // reconnecté plus tard : on repart d'une union, rien n'est supprimé
  await refreshGoogle()
  toast.add({ title: 'Google account signed out', icon: 'i-lucide-check', color: 'success' })
}

// ── sauvegarde ──
const backupBusy = ref<'' | 'export' | 'import' | 'csv' | 'restore'>('')
const restore = ref<RestorePoint | null>(null)
const importConfirmOpen = ref(false)
let pendingImport = ''

async function refreshRestore() {
  restore.value = await restorePoint()
}

async function saveTextFile(content: string, name: string, ext: string) {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await save({
    defaultPath: name,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  })
  if (!path) return false
  await writeTextFile(path, content)
  return true
}

async function onExportBackup() {
  backupBusy.value = 'export'
  try {
    if (await saveTextFile(await exportBackup(), backupFileName('json'), 'json'))
      toast.add({ title: 'Backup saved', icon: 'i-lucide-check', color: 'success' })
  } catch {
    toast.add({ title: 'Could not save the backup', color: 'error' })
  } finally {
    backupBusy.value = ''
  }
}

async function onExportCsv() {
  backupBusy.value = 'csv'
  try {
    if (await saveTextFile(await exportCollectionCsv(), backupFileName('csv'), 'csv'))
      toast.add({ title: 'Collection exported', icon: 'i-lucide-check', color: 'success' })
  } catch {
    toast.add({ title: 'Could not export the collection', color: 'error' })
  } finally {
    backupBusy.value = ''
  }
}

async function onPickBackup() {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const path = await open({ multiple: false, filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (!path || Array.isArray(path)) return
    const text = await readTextFile(path)
    parseBackup(text) // refuse tout de suite un fichier invalide
    pendingImport = text
    importConfirmOpen.value = true
  } catch (e) {
    toast.add({ title: e instanceof Error ? e.message : 'Could not read the file', color: 'error' })
  }
}

async function onConfirmImport() {
  backupBusy.value = 'import'
  try {
    const s = await importBackup(pendingImport)
    importConfirmOpen.value = false
    deviceSync.dataChanged()
    toast.add({
      title: `Backup imported: ${s.cards} card entries`,
      icon: 'i-lucide-check',
      color: 'success',
    })
  } catch (e) {
    toast.add({ title: e instanceof Error ? e.message : 'Import failed', color: 'error' })
  } finally {
    pendingImport = ''
    backupBusy.value = ''
    await refreshRestore()
  }
}

async function onRestore() {
  backupBusy.value = 'restore'
  try {
    await restoreLastBackup()
    deviceSync.dataChanged()
    toast.add({ title: 'Previous data restored', icon: 'i-lucide-check', color: 'success' })
  } catch {
    toast.add({ title: 'Restore failed', color: 'error' })
  } finally {
    backupBusy.value = ''
    await refreshRestore()
  }
}

onMounted(async () => {
  refreshGoogle()
  refreshRestore()
  ownerName.value = await getShareOwnerName()
  refreshCacheSize()
  refreshVersion()
})
</script>
