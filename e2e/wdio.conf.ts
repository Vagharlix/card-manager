import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, copyFileSync, rmSync, mkdirSync } from 'node:fs'

// ============================================================
// WebdriverIO config — E2E for the Tauri app (card-manager)
//
// tauri-driver proxies WebDriver to the native WebView (port 4444).
// The binary is built with the Tauri CLI so the static frontend is
// embedded. VITE_TEST_MODE=true makes db-names.ts open *.test.db.
// ============================================================

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, '..')
const TAURI_DIR = join(REPO, 'src-tauri')
const BINARY = join(TAURI_DIR, 'target', 'release', 'card-manager')
const DATA_DIR = join(homedir(), '.config', 'com.card-manager.app')

// Committed reference fixture (deterministic, used in CI and as the
// default locally). See e2e/fixtures/build-fixture.sh to (re)generate.
const FIXTURE = join(REPO, 'e2e', 'fixtures', 'cards-ygo.test.db')

let tauriDriver: ChildProcess

// kill any leftover driver/app processes (avoids "port in use" / "max sessions")
function killStaleProcesses() {
  for (const name of ['tauri-driver', 'WebKitWebDriver']) {
    spawnSync('pkill', ['-f', name], { stdio: 'ignore' })
  }
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./specs/**/*.spec.ts'],
  maxInstances: 1,
  hostname: '127.0.0.1',
  port: 4444,
  capabilities: [
    {
      // @ts-expect-error tauri:options is a custom capability
      'tauri:options': {
        application: BINARY,
      },
    },
  ],
  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  // ── prepare test databases + build the test binary ──
  onPrepare: () => {
    // clear any stale drivers from a previous failed run
    killStaleProcesses()

    // 1. seed reference DB
    //    En CI (ou pour quiconque sans dev DB synchronisée), on utilise la
    //    fixture committée. En local, si la fixture est absente, on retombe
    //    sur la dev DB déjà synchronisée. Le dossier n'existe pas forcément
    //    sur un runner CI neuf, donc on le crée.
    mkdirSync(DATA_DIR, { recursive: true })
    const devRef = join(DATA_DIR, 'cards-ygo.dev.db')
    const testRef = join(DATA_DIR, 'cards-ygo.test.db')
    if (existsSync(FIXTURE)) {
      copyFileSync(FIXTURE, testRef)
    } else if (existsSync(devRef)) {
      copyFileSync(devRef, testRef)
    } else {
      throw new Error(
        `No reference DB available. Expected a committed fixture at ${FIXTURE} ` +
          `or a synced dev DB at ${devRef}. Run the app in dev once to sync, ` +
          `or build the fixture with e2e/fixtures/build-fixture.sh.`
      )
    }

    // 2. fresh user DB + Magic card DB (le spec mtg y importe un échantillon)
    for (const base of ['user.test.db', 'cards-mtg.test.db'])
      for (const suffix of ['', '-shm', '-wal']) {
        const f = join(DATA_DIR, `${base}${suffix}`)
        if (existsSync(f)) rmSync(f)
      }

    // 3. generate the static frontend in test mode
    console.log('Building test frontend (VITE_TEST_MODE=true)...')
    const gen = spawnSync('pnpm', ['--ignore-workspace', 'generate'], {
      cwd: join(REPO, 'app'),
      stdio: 'inherit',
      env: { ...process.env, VITE_TEST_MODE: 'true' },
    })
    if (gen.status !== 0) throw new Error('Frontend build failed')

    // 4. build the Tauri binary WITH the embedded frontend (no installers)
    console.log('Building Tauri binary (tauri build --no-bundle)...')
    const build = spawnSync('pnpm', ['tauri', 'build', '--no-bundle'], {
      cwd: REPO,
      stdio: 'inherit',
      env: { ...process.env, VITE_TEST_MODE: 'true' },
    })
    if (build.status !== 0) throw new Error('Tauri build failed')
  },

  // ── start tauri-driver before the session ──
  beforeSession: () => {
    killStaleProcesses()
    tauriDriver = spawn(join(homedir(), '.cargo', 'bin', 'tauri-driver'), [], {
      stdio: [null, process.stdout, process.stderr],
    })
  },

  afterSession: () => {
    tauriDriver?.kill()
  },

  // last-resort cleanup so nothing lingers on 4444
  onComplete: () => {
    tauriDriver?.kill()
    killStaleProcesses()
  },
}
