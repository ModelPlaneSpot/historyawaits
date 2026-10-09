// Clicking contested territories on the map must open their country's panel
// (not just the news): the Palestinian Authority, Western Sahara, Kosovo,
// South Sudan.
//   node scripts/smoke-test-disputed-click.mjs [baseUrl]
import { chromium } from 'playwright'
import fs from 'node:fs'

const baseUrl = process.argv[2] ?? 'http://localhost:5173'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
fs.mkdirSync('.smoke-screens', { recursive: true })

await page.goto(baseUrl)
await page.waitForSelector('text=HISTORY AWAITS', { timeout: 20000 })
await page.click('text=United States')
await page.waitForSelector('text=January 1, 2026', { timeout: 20000 })
await page.waitForTimeout(1500)

// [label, focus target, expected selected entity, text expected in panel]
const CASES = [
  ['Gaza Strip', { regionId: 'PSE-GAZA' }, 'PSE', 'Palestinian Authority'],
  ['West Bank', { regionId: 'PSE-WBK' }, 'PSE', 'Palestinian Authority'],
  ['Western Sahara (Laayoune)', { regionId: 'MAR-3456' }, 'ESH', 'Western Sahara'],
  ['Western Sahara (Free Zone)', { regionId: 'SAH+00?' }, 'ESH', 'Western Sahara'],
  ['Kosovo', { entityId: 'XKX' }, 'XKX', 'Kosovo'],
  ['South Sudan', { entityId: 'SSD' }, 'SSD', 'South Sudan'],
]

let failed = false
for (const [label, target, expectEntity, expectText] of CASES) {
  // Center the map on the place through the app's store (dev-only handle),
  // then click the middle of the map.
  await page.evaluate((t) => {
    const store = window.__gameStore.getState()
    store.selectEntity(null)
    store.focusOn({ entityId: t.entityId ?? null, regionId: t.regionId ?? null })
  }, target)
  await page.waitForTimeout(1800)
  const box = await page.locator('.map-view canvas').first().boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(500)
  const selected = await page.evaluate(() => {
    const s = window.__gameStore.getState()
    return { entity: s.selectedEntityId, region: s.selectedRegionId }
  })
  const side = (await page.textContent('.side-panel')) ?? ''
  const ok = selected.entity === expectEntity && side.includes(expectText)
  if (!ok) failed = true
  console.log(`[${ok ? 'ok' : 'FAIL'}] ${label}: selected ${selected.entity} / region ${selected.region}`)
  await page.screenshot({ path: `.smoke-screens/click-${label.replace(/\W+/g, '-')}.png` })
}

console.log('PAGE ERRORS:', errors.length === 0 ? 'none' : JSON.stringify(errors, null, 2))
await browser.close()
process.exit(errors.length > 0 || failed ? 1 : 0)
