import { browser } from '@wdio/globals'
import { existsSync, linkSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ============================================================
// MESURES DE PERFORMANCE (outil, pas un test : rien n'est vérifié).
//   cd e2e && xvfb-run -a npx wdio run ./wdio.conf.ts --spec ./perf/perf.spec.ts
// Collection synthétique de N cartes distinctes possédées, vignettes déjà en
// cache (liens durs vers une vraie image), puis chronométrage des actions et
// comptage des appels JS → Rust (fetch ipc://, interceptés dans la page).
// Sous xvfb le rendu est logiciel : durées pessimistes, écarts fiables.
// Les cartes ajoutées restent dans les bases de test (recopiées / effacées
// au prochain lancement de l'E2E).
// ============================================================

const N = 2000
const CACHE = join(homedir(), '.cache', 'com.card-manager.app', 'card-images', 'small')
const ids = Array.from({ length: N }, (_, k) => `9${String(k + 1).padStart(8, '0')}`)
const rows: { action: string; ms: number; worstFrameMs: number; ipc: string }[] = []

// une vraie vignette (Dark Magician) : celle du cache, sinon téléchargée
async function sourceImage(): Promise<string> {
  mkdirSync(CACHE, { recursive: true })
  const real = join(CACHE, '46986414.jpg')
  if (existsSync(real)) return real
  const res = await fetch('https://images.ygoprodeck.com/images/cards_small/46986414.jpg')
  if (!res.ok) throw new Error(`no source image (HTTP ${res.status}): network needed once`)
  writeFileSync(real, Buffer.from(await res.arrayBuffer()))
  return real
}

async function page<T>(src: string): Promise<T> {
  return browser.execute(
    (s: string) => new Function(`return (async () => { ${s} })()`)(),
    src
  ) as Promise<T>
}

// aides installées dans la page : compteur d'appels Rust, clic, saisie,
// navigation, et mesure d'une action (durée jusqu'à une condition + 2 images,
// pire image pendant ce temps)
async function installHelpers() {
  await page(`
    if (window.__perf) return
    window.__perf = { calls: {} }
    const f0 = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url
      if (url.includes('iconify')) window.__perf.calls['NET iconify'] = (window.__perf.calls['NET iconify'] || 0) + 1
      if (url.startsWith('ipc:')) {
        const cmd = decodeURIComponent(url.slice('ipc://localhost/'.length))
        window.__perf.calls[cmd] = (window.__perf.calls[cmd] || 0) + 1
      }
      return f0(input, init)
    }
    window.__click = (sel, i = 0) => {
      const el = document.querySelectorAll(sel)[i]
      if (!el) throw new Error('no ' + sel + ' ' + i)
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
    }
    window.__type = (sel, val) => {
      const f = document.querySelector(sel)
      const el = f instanceof HTMLInputElement ? f : f.querySelector('input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    window.__go = (p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }
    window.__m = async (action, until, timeout) => {
      window.__perf.calls = {}
      const gaps = []; let last = performance.now(); let run = true
      const loop = (t) => { gaps.push(t - last); last = t; if (run) requestAnimationFrame(loop) }
      requestAnimationFrame(loop)
      const t0 = performance.now()
      await new Function('return (async () => {' + action + '})()')()
      while (!new Function('return ' + until)()) {
        if (performance.now() - t0 > timeout) break
        await new Promise((r) => setTimeout(r, 2))
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      run = false
      return { ms: Math.round(performance.now() - t0), worst: Math.round(Math.max(0, ...gaps)), calls: { ...window.__perf.calls } }
    }
  `)
}

async function measure(action: string, js: string, until: string, timeout = 30000) {
  const r = await page<{ ms: number; worst: number; calls: Record<string, number> }>(
    `return window.__m(${JSON.stringify(js)}, ${JSON.stringify(until)}, ${timeout})`
  )
  const ipc = Object.entries(r.calls)
    .map(([k, v]) => `${k.replace('plugin:sql|', 'sql ')}×${v}`)
    .join(', ')
  rows.push({ action, ms: r.ms, worstFrameMs: r.worst, ipc })
  return r
}

async function sql(db: string, query: string, values: unknown[] = []) {
  return page(
    `return window.__TAURI_INTERNALS__.invoke('plugin:sql|execute', { db: ${JSON.stringify(db)}, query: ${JSON.stringify(query)}, values: ${JSON.stringify(values)} })`
  )
}

describe('performance (outil de mesure)', () => {
  before(async () => {
    const src = await sourceImage()
    for (const id of ids) {
      const p = join(CACHE, `${id}.jpg`)
      if (!existsSync(p)) linkSync(src, p)
    }
  })

  after(() => {
    for (const f of readdirSync(CACHE)) if (/^9\d{8}\.jpg$/.test(f)) rmSync(join(CACHE, f))
    console.log(`\nMesures (${N} cartes distinctes possédées) :`)
    console.table(rows)
  })

  it(`collection de ${N} cartes`, async function () {
    this.timeout(600000)
    await browser.waitUntil(async () => page<boolean>(`return !!document.querySelector('header')`), {
      timeout: 30000,
    })
    await installHelpers()
    await page(`await window.__resetTestDb()`)

    const now = new Date().toISOString()
    for (let s = 0; s < N; s += 400) {
      const part = ids.slice(s, s + 400)
      await sql(
        'sqlite:cards-ygo.test.db',
        `INSERT OR REPLACE INTO cards (id, name) VALUES ${part.map(() => '(?, ?)').join(',')}`,
        part.flatMap((id) => [id, `Perf Card ${id}`])
      )
      await sql(
        'sqlite:cards-ygo.test.db',
        `INSERT OR REPLACE INTO ygo_details (card_id, type) VALUES ${part.map(() => "(?, 'Normal Monster')").join(',')}`,
        part
      )
      await sql(
        'sqlite:user.test.db',
        `INSERT INTO collection (id, game, card_id, quantity, condition, language, created_at, updated_at) VALUES ${part
          .map(() => "(?, 'ygo', ?, 2, 'NM', 'en', ?, ?)")
          .join(',')}`,
        part.flatMap((id) => [`perf-${id}`, id, now, now])
      )
    }

    await page(`window.__go('/search')`)
    await browser.pause(800)

    const visibleLoaded = `(() => { const sc = document.querySelector('#container-content > div'); if (!sc) return false; const r = sc.getBoundingClientRect(); const imgs = [...document.querySelectorAll('#container-content .card-thumb img')].filter((i) => { const b = i.getBoundingClientRect(); return b.bottom > r.top && b.top < r.bottom }); return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0) })()`

    await measure(
      'collection : grille + images visibles',
      `window.__go('/collection')`,
      visibleLoaded
    )

    // défilement de la grille : 120 pas de 250 px
    const scroll = await page<{ avg: number; p95: number; max: number; over50: number }>(`
      const sc = document.querySelector('#container-content > div')
      sc.scrollTop = 0
      await new Promise((r) => requestAnimationFrame(r))
      const gaps = []; let last = performance.now()
      for (let i = 0; i < 120; i++) {
        sc.scrollTop += 250
        await new Promise((r) => requestAnimationFrame(r))
        const t = performance.now(); gaps.push(t - last); last = t
      }
      gaps.sort((a, b) => a - b)
      return { avg: Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length),
               p95: Math.round(gaps[Math.floor(gaps.length * 0.95)]), max: Math.round(gaps[gaps.length - 1]),
               over50: gaps.filter((g) => g > 50).length }
    `)
    rows.push({
      action: `défilement (moy. ${scroll.avg} ms, p95 ${scroll.p95} ms, ${scroll.over50}/120 > 50 ms)`,
      ms: scroll.avg,
      worstFrameMs: scroll.max,
      ipc: '',
    })
    await page(`document.querySelector('#container-content > div').scrollTop = 0`)
    await browser.pause(300)

    await measure(
      'fiche : ouverture',
      `window.__click('#container-content .card-thumb', 2)`,
      `!!document.querySelector('#card-detail-owned[data-owned-count]') && !!document.querySelector('#btn-quick-add')`
    )
    const before = Number(
      await page(`return document.querySelector('#card-detail-owned').getAttribute('data-owned-count')`)
    )
    await measure(
      'fiche : ajout rapide (compteur à jour)',
      `window.__click('#btn-quick-add')`,
      `Number(document.querySelector('#card-detail-owned').getAttribute('data-owned-count')) === ${before + 1}`
    )
    await browser.pause(1500)
    await page(
      `document.querySelector('[role=dialog] button[aria-label="Close"], #card-detail-close')?.click()`
    )
    await browser.pause(800)

    await measure(
      'non rangées : affichage',
      `window.__click('[data-container-id="__unranged__"]')`,
      `document.querySelectorAll('#container-content .card-thumb').length >= 10`
    )
    await measure(
      'sélection : entrer dans le mode',
      `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Select').click()`,
      `[...document.querySelectorAll('#container-content .card-thumb')].every((t) => t.querySelector('.bg-black\\\\/30, .bg-primary\\\\/20'))`
    )
    for (const i of [3, 4]) {
      await measure(
        `sélection : cocher une carte`,
        `window.__click('#container-content .card-thumb', ${i})`,
        `!!document.querySelectorAll('#container-content .card-thumb')[${i}].querySelector('.bg-primary\\\\/20')`
      )
    }

    // deck : ajouts depuis la recherche du deck
    await page(`window.__go('/decks')`)
    await browser.pause(800)
    await page(
      `window.__click(document.querySelector('#deck-create-empty') ? '#deck-create-empty' : '#deck-create-btn')`
    )
    await browser.pause(400)
    await page(`window.__type('#deck-name-input', 'Perf deck')`)
    await page(`window.__click('#deck-create-confirm')`)
    await browser.waitUntil(async () => /^\/decks\/.+/.test(await page<string>(`return location.pathname`)))
    await browser.pause(800)
    await page(`window.__type('#deck-search-input', 'Perf')`)
    await browser.waitUntil(
      async () => (await page<number>(`return document.querySelectorAll('.deck-search-result').length`)) > 0
    )
    await browser.pause(800) // informations des résultats (ajout immédiat)
    for (let i = 0; i < 4; i++) {
      const total = Number(
        await page(`return document.querySelector('[data-total-cards]').getAttribute('data-total-cards')`)
      )
      await measure(
        'deck : ajout d’une carte (affichée)',
        `window.__click('.deck-search-result', ${i})`,
        `Number(document.querySelector('[data-total-cards]').getAttribute('data-total-cards')) === ${total + 1}`
      )
    }
  })
})
