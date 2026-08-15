import { chromium } from 'playwright'

const baseUrl = process.argv[2] ?? 'http://localhost:4173'
const TURNS = Number(process.argv[3] ?? 40)
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message))

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('text=HISTORY AWAITS', { timeout: 20000 })
await page.click('text=United States')
await page.waitForSelector('text=Turn 0', { timeout: 20000 })

const start = Date.now()
for (let i = 1; i <= TURNS; i++) {
  await page.click('button:has-text("End Turn")')
  await page.waitForSelector(`text=Turn ${i}`, { timeout: 20000 })
  const continueBtn = page.locator('button:has-text("Continue")')
  if (await continueBtn.count() > 0) await continueBtn.click()
}
console.log(`[ok] Played ${TURNS} turns in ${Date.now() - start}ms with no crash`)

const newsText = await page.textContent('.side-panel')
const newsMatches = (newsText.match(/T\d+/g) ?? []).length
console.log(`News panel shows ${newsMatches} dated entries after ${TURNS} turns`)

const gdp = await page.textContent('.stat-row:has-text("GDP") span:last-child')
console.log('Player GDP after long play:', gdp)

console.log('CONSOLE ERRORS:', errors.length === 0 ? 'none' : JSON.stringify(errors, null, 2))
await browser.close()
process.exit(errors.length > 0 ? 1 : 0)
