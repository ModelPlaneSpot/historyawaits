// Start a game as the Palestinian Authority and as Western Sahara from the
// main menu; their own country panel and IGPT advice must load.
//   node scripts/smoke-test-new-nations.mjs [baseUrl]
import { chromium } from 'playwright'

const baseUrl = process.argv[2] ?? 'http://localhost:5173'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

let failed = false
for (const name of ['Palestinian Authority', 'Western Sahara']) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=HISTORY AWAITS', { timeout: 20000 })
  await page.fill('input[placeholder*="Search countries"]', name)
  await page.waitForTimeout(200)
  const row = (await page.textContent(`.entity-picker-row:has-text("${name}")`)) ?? ''
  await page.click(`.entity-picker-row:has-text("${name}")`)
  await page.waitForSelector('text=January 1, 2026', { timeout: 20000 })
  const title = (await page.textContent('.entity-title')) ?? ''
  await page.click('.top-bar button:has-text("IGPT")')
  await page.waitForSelector('.igpt-panel', { timeout: 10000 })
  const igpt = (await page.textContent('.igpt-panel')) ?? ''
  const ok = title.includes(name) && !row.includes('disputed') && igpt.includes(`${name} doctrine`)
  if (!ok) failed = true
  console.log(`[${ok ? 'ok' : 'FAIL'}] Playing as ${name}: menu row "${row.trim()}", panel title "${title.trim()}", IGPT doctrine loaded=${igpt.includes(`${name} doctrine`)}`)
  await page.screenshot({ path: `.smoke-screens/play-as-${name.replace(/\W+/g, '-')}.png` })
  await page.click('.igpt-panel .advisor-close')
  await page.click('button:has-text("Menu")')
}

console.log('PAGE ERRORS:', errors.length === 0 ? 'none' : JSON.stringify(errors, null, 2))
await browser.close()
process.exit(errors.length > 0 || failed ? 1 : 0)
