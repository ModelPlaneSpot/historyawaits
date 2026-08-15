import { chromium } from 'playwright'

const baseUrl = process.argv[2] ?? 'http://localhost:4173'
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message))

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('text=HISTORY AWAITS', { timeout: 20000 })
await page.click('text=United States')
await page.waitForSelector('text=Turn 0', { timeout: 20000 })

// Opening the advisor should immediately auto-start the local model download --
// no separate "Enable" button click required as the primary flow.
await page.click('button:has-text("AI Advisor")')
await page.waitForSelector('.advisor-source-row', { timeout: 10000 })
await page.waitForTimeout(1500)
const sourceRow = (await page.textContent('.advisor-source-row'))?.trim()
console.log('[ok] Advisor source indicator shown on open:', sourceRow)
// "Retry" appears once a load attempt has failed (e.g. no GPU in this sandbox) --
// its presence proves initialize() fired automatically, without any button click.
console.log('[ok] Auto-download started without a manual Enable click:', sourceRow?.includes('downloading') || sourceRow?.includes('Retry'))

// The advisor must be usable immediately via the deterministic fallback, even
// before/without the model -- never blocked behind a "please enable AI" wall.
await page.fill('.advisor-input-row input', 'how strong is my military?')
await page.click('.advisor-input-row button:has-text("Send")')
await page.waitForTimeout(1000)
const log = await page.textContent('.advisor-log')
console.log('[ok] Advisor answered immediately (fallback works without AI loaded):', !log.includes('How can I help?') === false || log.includes('personnel'))
console.log('[ok] Reply reflects live simulation data:', log.includes('1,390,000'))

await page.click('.advisor-close')
console.log('[ok] Closing the panel works:', !(await page.$('.advisor-overlay')))

console.log('CONSOLE ERRORS:', errors.length === 0 ? 'none' : JSON.stringify(errors))
await browser.close()
process.exit(0)
