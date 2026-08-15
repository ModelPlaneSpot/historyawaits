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
  await page.waitForTimeout(350)
  const pending = page.locator('.pending-command-row')
  if ((await pending.count()) > 0) {
    const summary = await pending.textContent()
    console.log(`  [confirm prompt] ${summary.replace(/\s+/g, ' ').trim()}`)
    await page.click('.pending-command-actions button:has-text("Confirm")')
    await page.waitForTimeout(350)
  }
  const log = await page.textContent('.command-log')
  const lastLine = log.trim().split('\n').pop()
  console.log(`"${cmd}" -> ${lastLine}`)
  return lastLine
}

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('text=HISTORY AWAITS', { timeout: 20000 })
await page.click('text=United States')
await page.waitForSelector('text=Turn 0', { timeout: 20000 })

console.log('--- Bad spelling ---')
await run('atack iran')
await run('invde camboda')
await run('increse millitary spendng')
await run('moblize 100k')
await run('send troops north')
await run('make frnce our ally')
await run('stop fightng with russia')
await run('start peacetalks with ukrane')

console.log('--- No obvious keywords ---')
await run('I want our army ready for something big.')
await run('Put more soldiers near the northern frontier.')
await run('We need France on our side.')
await run("I don't want to depend on foreign oil anymore.")
// "Get our forces out of there." needs a prior region reference for "there" -- set one up first.
await run('annex Gaza')
await run('Get our forces out of there.')
await run('Make the economy stronger.')

console.log('--- Questions must not execute ---')
await run('Should we invade Iran?')
await run('What would happen if we attacked Iran?')

console.log('--- Negation ---')
await run("Don't attack Iran.")

console.log('--- Corrections ---')
await run('attack Iran, actually I meant Iraq')

console.log('--- Preparation vs execution ---')
await run('Prepare an invasion of Iran.')
await run('Launch the invasion of Iran.')

console.log('CONSOLE ERRORS:', errors.length === 0 ? 'none' : JSON.stringify(errors, null, 2))
await browser.close()
process.exit(errors.length > 0 ? 1 : 0)
