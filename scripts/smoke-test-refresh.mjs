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
await page.click('button:has-text("End Turn")')
await page.waitForSelector('text=Turn 1', { timeout: 20000 })
await page.click('button:has-text("End Turn")')
await page.waitForSelector('text=Turn 2', { timeout: 20000 })
console.log('[ok] Reached turn 2 before refresh')

await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('text=HISTORY AWAITS', { timeout: 20000 })
console.log('[ok] Browser refresh did not crash -- back at main menu')
await page.waitForSelector('text=Autosave', { timeout: 20000 })
await page.click('text=Autosave')
await page.waitForSelector('text=Turn 2', { timeout: 20000 })
console.log('[ok] Continue from autosave restored Turn 2 state after refresh')

console.log('CONSOLE ERRORS:', errors.length === 0 ? 'none' : JSON.stringify(errors, null, 2))
await browser.close()
process.exit(errors.length > 0 ? 1 : 0)
