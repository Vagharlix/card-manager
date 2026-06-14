import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, copyFileSync, rmSync } from 'node:fs'

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

    // 1. seed reference DB: copy the already-synced dev DB to .test.db
    const devRef = join(DATA_DIR, 'cards-ygo.dev.db')
    const testRef = join(DATA_DIR, 'cards-ygo.test.db')
    if (!existsSync(devRef)) {
      throw new Error(
        `Reference DB not found at ${devRef}. Run the app in dev once to sync before E2E.`
      )
    }
    copyFileSync(devRef, testRef)

    // 2. fresh user DB
    for (const suffix of ['', '-shm', '-wal']) {
      const f = join(DATA_DIR, `user.test.db${suffix}`)
      if (existsSync(f)) rmSync(f)
    }

    // 3. generate the static frontend in test mode
    console.log('Building test frontend (VITE_TEST_MODE=true)...')
    const gen = spawnSync('pnpm', ['--dir', 'app', 'generate'], {
      cwd: REPO,
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
