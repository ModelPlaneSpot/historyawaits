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

const commands = [
  'mobilize 100000 troops',
  'increase military spending to 5 percent',
  'sign a treaty with France',
  'form an alliance with Japan',
  'sanction Russia',
]
for (const cmd of commands) {
  await page.fill('input[placeholder*="declare war"]', cmd)
  await page.click('button:has-text("Send")')
  await page.waitForTimeout(400)
  const log = await page.textContent('.command-log')
  const lastLine = log.trim().split('\n').pop()
  console.log(`"${cmd}" -> ${lastLine}`)
}

console.log('CONSOLE ERRORS:', errors.length === 0 ? 'none' : JSON.stringify(errors, null, 2))
await browser.close()
process.exit(errors.length > 0 ? 1 : 0)
