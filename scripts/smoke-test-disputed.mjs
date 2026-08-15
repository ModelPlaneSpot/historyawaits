import { chromium } from 'playwright'

const baseUrl = process.argv[2] ?? 'http://localhost:4173'
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message))

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('text=HISTORY AWAITS', { timeout: 20000 })
await page.fill('input[placeholder*="Search countries"]', 'Taiwan')
await page.waitForTimeout(200)
await page.click('.entity-picker-row:has-text("Taiwan")')
await page.waitForSelector('text=Turn 0', { timeout: 20000 })
const title = await page.textContent('.entity-title')
console.log('Started game as disputed entity:', title)
const statusRow = await page.textContent('.side-panel')
console.log('Shows disputed-entity status field:', statusRow.includes('Status'))

console.log('CONSOLE ERRORS:', errors.length === 0 ? 'none' : JSON.stringify(errors, null, 2))
await browser.close()
process.exit(errors.length > 0 ? 1 : 0)
