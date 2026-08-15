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

await page.click('button:has-text("AI Advisor")')
await page.waitForSelector('text=AI Advisor', { timeout: 10000 })
const disabledMsg = await page.$('.advisor-disabled')
console.log('[ok] Advisor panel opens; shows disabled/enable prompt when AI is off:', !!disabledMsg)
await page.screenshot({ path: 'C:\\Users\\Idan\\AppData\\Local\\Temp\\claude\\C--Users-Idan-vibecoding-Historyawaits\\c626c029-88ae-4b12-85a5-bbe7b7b8757d\\scratchpad\\advisor-01-disabled.png' })

// Close via the X button
await page.click('.advisor-close')
const overlayGone = !(await page.$('.advisor-overlay'))
console.log('[ok] Closing the panel works:', overlayGone)

// Try enabling -- this should transition to loading/error gracefully (no GPU here).
await page.click('button:has-text("AI Advisor")')
const enableBtn = await page.$('.advisor-disabled button:has-text("Enable")')
if (enableBtn) {
  await enableBtn.click()
  await page.waitForTimeout(2000)
  const stillOpen = await page.$('.advisor-overlay')
  console.log('[ok] Clicking enable from within advisor does not crash the panel:', !!stillOpen)
  await page.screenshot({ path: 'C:\\Users\\Idan\\AppData\\Local\\Temp\\claude\\C--Users-Idan-vibecoding-Historyawaits\\c626c029-88ae-4b12-85a5-bbe7b7b8757d\\scratchpad\\advisor-02-loading.png' })
}

console.log('CONSOLE ERRORS:', errors.length === 0 ? 'none' : JSON.stringify(errors))
await browser.close()
process.exit(0)
