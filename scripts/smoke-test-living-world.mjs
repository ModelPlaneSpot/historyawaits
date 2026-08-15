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

const TURNS = 40
for (let i = 0; i < TURNS; i++) {
  await page.click('button:has-text("End Turn")')
  await page.waitForTimeout(120)
  // Dismiss the turn summary modal if it's showing so it doesn't block the next click.
  const continueBtn = page.locator('button:has-text("Continue")')
  if (await continueBtn.count() > 0) {
    await continueBtn.click()
  }
}
console.log(`Advanced ${TURNS} turns.`)

const turnLabel = await page.textContent('.turn-label')
console.log('Turn label:', turnLabel)

// Open the full World News panel and inspect the accumulated history.
await page.click('.top-bar button:has-text("World News")')
await page.waitForTimeout(300)
const newsText = await page.textContent('.news-feed-list')
const newsItemCount = await page.locator('.news-feed-item').count()
console.log(`News feed items: ${newsItemCount}`)

const categoryHits = {}
for (const cat of ['war', 'economy', 'politics', 'disaster', 'territorial', 'civil_conflict', 'diplomacy', 'military', 'terrorism', 'resources']) {
  categoryHits[cat] = 0
}
// Cheap keyword sniff over headlines to confirm a variety of world-driven events fired.
const keywordChecks = {
  war: /declares war|wins the war|joins the war|Peace between/i,
  economy: /recession|economic boom|inflation surges/i,
  politics: /protests erupt|wins election|coup/i,
  disaster: /strikes /i,
  territorial: /annexes|cedes|declares independence|captures|recaptures/i,
  civil_conflict: /civil war/i,
  diplomacy: /sanctions|diplomatic summit/i,
  resources: /discovery in|shortage in/i,
  military: /border incident|skirmish/i,
}
for (const [cat, re] of Object.entries(keywordChecks)) {
  categoryHits[cat] = re.test(newsText) ? 1 : 0
}
console.log('Category signal presence (1 = seen at least once):', JSON.stringify(categoryHits, null, 2))

// Category filter chips should narrow the list.
await page.click('.news-filter-chip:has-text("Wars")')
await page.waitForTimeout(200)
const filteredCount = await page.locator('.news-feed-item').count()
console.log(`Items after filtering to "Wars" only: ${filteredCount} (should be <= ${newsItemCount})`)
await page.click('.news-filter-chip:has-text("Wars")') // toggle back off

// Clicking a located news item should not throw, and should pan the map.
const firstClickable = page.locator('.news-feed-item.clickable').first()
if (await firstClickable.count() > 0) {
  await firstClickable.click()
  await page.waitForTimeout(1000)
  console.log('Clicked a located news item without error.')
} else {
  console.log('No clickable (located) news item found to test camera-jump.')
}

await page.click('.news-feed-panel .advisor-close') // close panel via its own close button

console.log('CONSOLE ERRORS:', errors.length === 0 ? 'none' : JSON.stringify(errors, null, 2))
await browser.close()
process.exit(errors.length > 0 ? 1 : 0)
