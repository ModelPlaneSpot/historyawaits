// Checks that clicking "Enable local AI" doesn't immediately throw and starts
// the model download -- doesn't wait for the full ~1GB download to finish.
import { chromium } from 'playwright'

const baseUrl = process.argv[2] ?? 'http://localhost:5173'
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('console', (msg) => {
  const text = msg.text()
  if (msg.type() === 'error') errors.push(text)
  if (/webllm|webgpu|model/i.test(text)) console.log('[console]', msg.type(), text)
})
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message))

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('text=HISTORY AWAITS', { timeout: 20000 })
await page.click('text=United States')
await page.waitForSelector('text=Turn 0', { timeout: 20000 })

const hasWebGpu = await page.evaluate(() => 'gpu' in navigator)
console.log('navigator.gpu present in this browser:', hasWebGpu)

const enableBtn = await page.$('button:has-text("Enable")')
console.log('Enable button visible:', !!enableBtn)
if (enableBtn) {
  await enableBtn.click()
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(10000)
    const status = await page.textContent('.ai-status')
    console.log(`AI status after ${(i + 1) * 10}s:`, status?.trim())
    if (status?.includes('ready') || status?.includes('failed')) break
  }
}

console.log('CONSOLE ERRORS:', errors.length === 0 ? 'none' : JSON.stringify(errors, null, 2))
await browser.close()
