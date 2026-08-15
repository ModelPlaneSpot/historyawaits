import { chromium } from 'playwright'

const baseUrl = process.argv[2] ?? 'http://localhost:4173'
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message))

async function run(cmd) {
  await page.fill('input[placeholder*="Talk to your government"]', cmd)
  await page.click('button:has-text("Send")')
  await page.waitForTimeout(400)
  const log = await page.textContent('.command-log')
  const lastLine = log.trim().split('\n').pop()
  console.log(`"${cmd}" -> ${lastLine}`)
  return lastLine
}

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('text=HISTORY AWAITS', { timeout: 20000 })
await page.click('text=United States')
await page.waitForSelector('text=Turn 0', { timeout: 20000 })

console.log('--- individual stress-test commands ---')
await run('declare war on Iran')
await run('mobilize 200000 troops')
await run('increase military spending to 7 percent')
await run('build 100 tanks')
await run('build 20 fighter jets')
await run('sign a defense treaty with France')
await run('improve relations with Egypt')
await run('impose sanctions on Russia')
await run('increase taxes by 5 percent')
await run('reduce military spending')
await run('start researching advanced fighter technology')
await run('send military aid to Ukraine')
await run('establish a military base here')
await run('what would happen if China joined the war?')

console.log('--- compound multi-step command ---')
await run('mobilize 200000 troops, move them to the northern border, increase military spending to 6 percent, and sign a defense agreement with France')

console.log('--- region-targeted commands (Israel / Gaza-West Bank) ---')
await page.click('button:has-text("Menu")')
await page.waitForSelector('text=HISTORY AWAITS', { timeout: 20000 })
await page.click('text=Israel')
await page.waitForSelector('text=Turn 0', { timeout: 20000 })
await run('annex Gaza')
await run('withdraw troops from Gaza')

console.log('CONSOLE ERRORS:', errors.length === 0 ? 'none' : JSON.stringify(errors, null, 2))
await browser.close()
process.exit(errors.length > 0 ? 1 : 0)
