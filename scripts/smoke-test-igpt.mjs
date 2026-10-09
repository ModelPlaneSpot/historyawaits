// IGPT panel: advice with reasons, executing a suggestion, world decision
// feed, learned tab, autopilot toggle.
//   node scripts/smoke-test-igpt.mjs [baseUrl]
import { chromium } from 'playwright'
import fs from 'node:fs'

const baseUrl = process.argv[2] ?? 'http://localhost:5173'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
fs.mkdirSync('.smoke-screens', { recursive: true })
const shot = (n) => page.screenshot({ path: `.smoke-screens/igpt-${n}.png` })

await page.goto(baseUrl)
await page.waitForSelector('text=HISTORY AWAITS', { timeout: 20000 })
await page.click('text=United States')
await page.waitForSelector('text=January 1, 2026', { timeout: 20000 })

await page.click('.top-bar button:has-text("IGPT")')
await page.waitForSelector('.igpt-card', { timeout: 10000 })
const cards = await page.locator('.igpt-card').count()
const firstSummary = (await page.locator('.igpt-card strong').first().textContent()) ?? ''
console.log(`[${cards > 0 ? 'ok' : 'FAIL'}] IGPT shows ${cards} suggestions; top: "${firstSummary}"`)
await shot('advice')

await page.locator('.igpt-card button:has-text("Do it")').first().click()
await page.waitForTimeout(500)
const log = (await page.textContent('.command-log')) ?? ''
console.log(`[${log.includes('IGPT: ') ? 'ok' : 'FAIL'}] Executed IGPT suggestion -> ${log.split('\n').pop()}`)

await page.click('.igpt-panel .advisor-close')
await page.click('button:has-text("End Turn")')
await page.waitForSelector('.turn-summary-modal', { timeout: 30000 })
await page.locator('button:has-text("Continue")').click()

await page.click('.top-bar button:has-text("IGPT")')
await page.click('.igpt-tabs button:has-text("World decisions")')
const feed = await page.locator('.igpt-feed li').count()
console.log(`[${feed > 1 ? 'ok' : 'FAIL'}] World decisions feed has ${feed} entries`)
await shot('world')

await page.click('.igpt-tabs button:has-text("Learned")')
await shot('learned')

await page.click('.igpt-autopilot input')
await page.waitForSelector('.top-bar button:has-text("IGPT (autopilot)")', { timeout: 10000 })
console.log('[ok] Autopilot turned on')
await page.click('.igpt-panel .advisor-close')
await page.click('button:has-text("End Turn")')
await page.waitForSelector('.turn-summary-modal', { timeout: 30000 })
const summary = (await page.textContent('.turn-summary-modal')) ?? ''
console.log(`[${summary.includes('IGPT Autopilot Decided') ? 'ok' : 'FAIL'}] Turn summary lists what autopilot decided for the United States`)
await shot('autopilot-summary')
await page.locator('button:has-text("Continue")').click()
await page.click('.top-bar button:has-text("IGPT")')
await page.click('.igpt-tabs button:has-text("Advice")')
const panel = (await page.textContent('.igpt-panel')) ?? ''
console.log(`[${panel.includes('Decided for United States on autopilot') ? 'ok' : 'FAIL'}] IGPT panel shows autopilot history`)
await shot('autopilot')

console.log('PAGE ERRORS:', errors.length === 0 ? 'none' : JSON.stringify(errors, null, 2))
await browser.close()
process.exit(errors.length > 0 ? 1 : 0)
