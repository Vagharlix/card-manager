import { browser } from '@wdio/globals'

// ============================================================
// SHARED E2E HELPERS — all DOM interaction via injected JS.
//
// WebKitWebDriver (Tauri on Linux) does not reliably support
// elementSendKeys, the Actions API, or native clicks through
// overlays. So every action runs in the page via browser.execute().
//
// Selectors target semantic ids (kebab-case) placed on the app's
// interaction points — robust and deterministic.
// ============================================================

export async function resetDb(): Promise<void> {
  await browser.execute(async () => {
    const w = window as unknown as { __resetTestDb?: () => Promise<void> }
    if (w.__resetTestDb) await w.__resetTestDb()
  })
}

export async function goTo(path: string): Promise<void> {
  await browser.execute((p: string) => {
    window.history.pushState({}, '', p)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await browser.pause(400)
}

// Wait until window.location.pathname satisfies a predicate.
export async function waitForPath(pred: (path: string) => boolean, timeout = 8000): Promise<void> {
  await browser.waitUntil(async () => pred(await browser.execute(() => window.location.pathname)), {
    timeout,
    timeoutMsg: 'navigation did not reach the expected path',
  })
}

// Set an input's (or textarea's) value + fire input/change so Vue v-model updates.
// If the selector hits a wrapper (Nuxt UI), the inner input/textarea is used.
export async function typeInto(selector: string, text: string): Promise<void> {
  await browser.execute(
    (sel: string, val: string) => {
      const found = document.querySelector(sel)
      const el = (
        found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement
          ? found
          : found?.querySelector('input, textarea')
      ) as HTMLInputElement | HTMLTextAreaElement | null
      if (!el) throw new Error(`input not found: ${sel}`)
      const proto =
        el instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      setter?.call(el, val)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    },
    selector,
    text
  )
}

// Wait until a selector matches at least `min` elements (poll in page).
export async function waitFor(
  selector: string,
  opts: { min?: number; timeout?: number } = {}
): Promise<void> {
  const min = opts.min ?? 1
  const timeout = opts.timeout ?? 10000
  await browser.waitUntil(
    async () =>
      browser.execute(
        (sel: string, m: number) => document.querySelectorAll(sel).length >= m,
        selector,
        min
      ),
    { timeout, timeoutMsg: `selector "${selector}" never reached ${min} element(s)` }
  )
}

// Count elements matching a selector.
export async function countOf(selector: string): Promise<number> {
  return browser.execute((sel: string) => document.querySelectorAll(sel).length, selector)
}

// Click the Nth element matching a selector. Dispatches a full mouse
// event sequence (some UI libs bind on mousedown/up, not just .click()).
export async function click(selector: string, index = 0): Promise<void> {
  const ok = await browser.execute(
    (sel: string, i: number) => {
      const el = document.querySelectorAll(sel)[i] as HTMLElement | undefined
      if (!el) return false
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
      }
      return true
    },
    selector,
    index
  )
  if (!ok) throw new Error(`element not found to click: ${selector} [${index}]`)
}

// Read trimmed text of the first element matching a selector ('' if absent).
export async function textOf(selector: string): Promise<string> {
  return browser.execute((sel: string) => {
    const el = document.querySelector(sel)
    return el ? (el.textContent ?? '').trim() : ''
  }, selector)
}

// Wait until the first element matching `selector` has text satisfying `pred`.
export async function waitForTextMatch(
  selector: string,
  pred: (t: string) => boolean,
  timeout = 10000
): Promise<void> {
  await browser.waitUntil(async () => pred(await textOf(selector)), {
    timeout,
    timeoutMsg: `text of "${selector}" never matched predicate`,
  })
}

// Wait until an element matching `selector` exists and is visible.
export async function waitVisible(selector: string, timeout = 10000): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null
        if (!el) return false
        const r = el.getBoundingClientRect()
        const s = window.getComputedStyle(el)
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
      }, selector),
    { timeout, timeoutMsg: `element "${selector}" never became visible` }
  )
}

export async function waitForApp(): Promise<void> {
  await waitFor('header', { timeout: 30000 })
}

// Read an attribute of the first element matching a selector (null if absent).
export async function attrOf(selector: string, attr: string): Promise<string | null> {
  return browser.execute(
    (sel: string, a: string) => {
      const el = document.querySelector(sel)
      return el ? el.getAttribute(a) : null
    },
    selector,
    attr
  )
}

// Wait until an element's attribute satisfies a predicate (language-invariant).
export async function waitForAttr(
  selector: string,
  attr: string,
  pred: (v: string | null) => boolean,
  timeout = 10000
): Promise<void> {
  await browser.waitUntil(async () => pred(await attrOf(selector, attr)), {
    timeout,
    timeoutMsg: `attribute "${attr}" of "${selector}" never matched`,
  })
}

// ── Dropdown menus (Nuxt UI, teleported) ──────────────────
// Open a ⋮ menu by the id on its [data-menu-trigger], then wait for the
// teleported menu content to mount. Works for any element using the
// #item slot + data-menu-action convention (containers, decks, ...).
export async function openMenu(triggerId: string): Promise<void> {
  await click(`[data-menu-trigger="${triggerId}"]`)
  await waitFor('[data-menu-action]', { timeout: 5000 })
}

// Backwards-compatible alias.
export async function openContainerMenu(containerId: string): Promise<void> {
  await openMenu(containerId)
}

// Click a menu entry by its stable action (language-invariant).
export async function clickMenuAction(action: string): Promise<void> {
  await waitFor(`[data-menu-action="${action}"]`, { timeout: 5000 })
  await click(`[data-menu-action="${action}"]`)
}

// ── USelect (Reka combobox, teleported options) ───────────
// Open a USelect by the id on its role="combobox" trigger.
export async function openSelect(triggerId: string): Promise<void> {
  await click(`#${triggerId}`)
  await waitFor('[data-select-value]', { timeout: 5000 })
}

// Click a select option by its stable value (via #item slot data-select-value).
export async function clickSelectOption(value: string): Promise<void> {
  await waitFor(`[data-select-value="${value}"]`, { timeout: 5000 })
  await click(`[data-select-value="${value}"]`)
}
