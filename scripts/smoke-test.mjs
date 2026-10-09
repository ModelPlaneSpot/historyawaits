// One-off Playwright smoke test, not part of the app bundle. Usage:
//   node scripts/smoke-test.mjs [baseUrl]
// Defaults to the local dev server; pass the Render URL to test production.
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'

const baseUrl = process.argv[2] ?? 'http://localhost:5173'
const SCREEN_DIR = process.env.SMOKE_SCREEN_DIR ?? path.resolve(import.meta.dirname, '..', '.smoke-screens')
fs.mkdirSync(SCREEN_DIR, { recursive: true })

const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message))

let step = 0
async function shot(name) {
  step += 1
  await page.screenshot({ path: path.join(SCREEN_DIR, `${String(step).padStart(2, '0')}-${name}.png`) })
}

console.log(`Testing ${baseUrl}`)
await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('text=HISTORY AWAITS', { timeout: 20000 })
await shot('menu')
console.log('[ok] Main menu loaded')

await page.click('text=United States')
await page.waitForSelector('text=January 1, 2026', { timeout: 20000 })
await shot('new-game')
console.log('[ok] New game started as United States')

await page.waitForTimeout(500) // let the map's ResizeObserver settle before measuring it
const canvas = await page.$('.map-view canvas')

async function clickUntil(candidates, checkFn, label) {
  const box = await canvas.boundingBox()
  for (const [fx, fy] of candidates) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
    await page.waitForTimeout(250)
    if (await checkFn()) {
      console.log(`[ok] ${label} (hit at ${fx},${fy})`)
      return true
    }
  }
  console.log(`[FAIL] ${label} -- none of ${candidates.length} candidate points hit`)
  return false
}

// Click Russia (country selection across the whole map) -- try a few nearby points.
await clickUntil(
  [[0.75, 0.22], [0.78, 0.25], [0.80, 0.20], [0.72, 0.24], [0.77, 0.28]],
  async () => (await page.textContent('.entity-title'))?.includes('Russia'),
  'Clicking Russia selected it',
)
await shot('select-russia')

// Re-select the US, then click within it to select a specific region/state.
await page.click('text=United States')
await page.waitForTimeout(200)
await clickUntil(
  [[0.27, 0.25], [0.25, 0.27], [0.29, 0.23], [0.23, 0.30], [0.30, 0.28]],
  async () => !!(await page.$('text=Region')),
  'Clicking within a selected country revealed a region panel',
)
await shot('select-region')

// Fallback-parser command flow.
await page.fill('input[placeholder*="Talk to your government"]', 'declare war on Iran')
await page.click('button:has-text("Send")')
await page.waitForTimeout(500)
let logText = await page.textContent('.command-log')
console.log(`[${logText.includes('War declared') ? 'ok' : 'FAIL'}] "declare war on Iran" -> ${logText.split('\n').pop()}`)

await page.fill('input[placeholder*="Talk to your government"]', 'build 100 tanks')
await page.click('button:has-text("Send")')
await page.waitForTimeout(500)
logText = await page.textContent('.command-log')
console.log(`[${logText.includes('Built 100 tanks') ? 'ok' : 'FAIL'}] "build 100 tanks" -> ${logText.split('\n').pop()}`)
await shot('commands')

// Turn progression + autosave.
// Default turn length is 30 days = 10 event rounds.
await page.click('button:has-text("End Turn")')
await page.waitForSelector('text=January 31, 2026', { timeout: 20000 })
const eventsHeader = await page.textContent('.turn-summary-modal')
console.log(`[${/World Events \((\d{2,})\)/.test(eventsHeader) ? 'ok' : 'FAIL'}] 30-day turn advanced to January 31, 2026 with 10+ world events`)
await shot('turn-1')

// The turn summary modal blocks the rest of the UI until acknowledged.
const continueBtn = page.locator('button:has-text("Continue")')
if (await continueBtn.count() > 0) {
  await continueBtn.click()
  console.log('[ok] Turn summary modal shown and dismissed')
}

// A 6-month turn = 60 event rounds.
await page.selectOption('.top-bar select', '180')
await page.click('button:has-text("End Turn")')
await page.waitForSelector('text=July 30, 2026', { timeout: 60000 })
console.log('[ok] 6-month turn advanced to July 30, 2026')
await shot('six-months')
await page.locator('button:has-text("Continue")').click()

await page.click('button:has-text("Standings")')
await page.waitForSelector('text=Largest Country', { timeout: 10000 })
console.log('[ok] Standings show the three victory categories')
await shot('standings')
await page.click('.standings-modal button:has-text("Close")')

await page.click('button:has-text("Menu")')
await page.waitForSelector('text=HISTORY AWAITS', { timeout: 20000 })
await page.waitForSelector('text=Autosave', { timeout: 20000 })
console.log('[ok] Returned to menu, autosave entry visible')
await page.click('text=Autosave')
await page.waitForSelector('text=July 30, 2026', { timeout: 20000 })
console.log('[ok] Loaded autosave, date persisted (July 30, 2026)')
await shot('reloaded')

console.log('CONSOLE ERRORS:', errors.length === 0 ? 'none' : JSON.stringify(errors, null, 2))
await browser.close()
process.exit(errors.length > 0 ? 1 : 0)
