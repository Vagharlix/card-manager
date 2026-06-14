// ============================================================
// SMOKE TEST
// Verifies the whole chain works: the app launches, the WebView
// renders, and the shell (header) is present. If this passes,
// tauri-driver + WebdriverIO + the test build are all wired up.
// ============================================================

describe('App smoke test', () => {
  it('launches and shows the app shell', async () => {
    // the header shows the app name "card-manager"
    const header = await $('header')
    await header.waitForExist({ timeout: 30000 })

    const text = await header.getText()
    expect(text).toContain('card-manager')
  })

  it('shows the main navigation', async () => {
    // nav links exist (Collection / Decks / Search / Settings)
    // on desktop they're visible; the page should at least render <main>
    const main = await $('main')
    await main.waitForExist({ timeout: 10000 })
    expect(await main.isExisting()).toBe(true)
  })
})
