import { chromium } from 'playwright'

const baseUrl = process.argv[2] ?? 'http://localhost:4173'
const TURNS = Number(process.argv[3] ?? 100)
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message))

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('text=HISTORY AWAITS', { timeout: 20000 })
await page.click('text=Israel')
await page.waitForSelector('text=Turn 0', { timeout: 20000 })

async function dismissTurnSummary() {
  const continueBtn = page.locator('button:has-text("Continue")')
  if ((await continueBtn.count()) > 0) await continueBtn.click()
}

console.log(`Playing ${TURNS} turns as Israel (unrelated to Thailand/Cambodia) to let the world develop on its own...`)
const start = Date.now()
for (let i = 1; i <= TURNS; i++) {
  await page.click('button:has-text("End Turn")')
  await page.waitForSelector(`text=Turn ${i}`, { timeout: 20000 })
  await dismissTurnSummary()
}
console.log(`[ok] Played ${TURNS} turns in ${Date.now() - start}ms with no crash`)

// Open the full World News panel.
await page.click('.top-bar button:has-text("World News")')
await page.waitForTimeout(300)
const newsItemCount = await page.locator('.news-feed-item').count()
console.log(`News feed items: ${newsItemCount}`)

const readStoryLinks = page.locator('.read-full-story-link')
const storyLinkCount = await readStoryLinks.count()
console.log(`News items with a linked full story: ${storyLinkCount}`)
if (storyLinkCount === 0) {
  console.log('[FAIL] No story-linked news items appeared after', TURNS, 'unattended turns.')
  await browser.close()
  process.exit(1)
}

// Search box filters the feed.
await page.fill('.news-search-input', 'zzzzznomatch')
await page.waitForTimeout(150)
const noMatchCount = await page.locator('.news-feed-item').count()
console.log(`Items matching a nonsense search string: ${noMatchCount} (should be 0)`)
await page.fill('.news-search-input', '')
await page.waitForTimeout(150)

// Scan across several distinct stories looking for one that developed across
// multiple turns (not just a single-shot event) -- proves stories accrue
// stages live, not just in the isolated unit test.
const scanCount = Math.min(storyLinkCount, 20)
let bestTitle = null
let bestStages = 0
let bestType = null
for (let i = 0; i < scanCount; i++) {
  await readStoryLinks.nth(i).click()
  await page.waitForSelector('.event-detail-panel', { timeout: 10000 })
  const stages = await page.locator('.event-timeline-stage').count()
  if (stages > bestStages) {
    bestStages = stages
    bestTitle = (await page.textContent('.event-detail-panel .advisor-header strong'))?.trim()
    bestType = (await page.textContent('.event-meta-grid')).replace(/\s+/g, ' ').trim()
  }
  await page.click('.event-detail-panel .advisor-close')
  await page.waitForTimeout(80)
}
console.log(`Scanned ${scanCount} stories -- most-developed: "${bestTitle}" with ${bestStages} stage(s) [${bestType}]`)

// Open the first full story for the detailed field checks below.
await readStoryLinks.first().click()
await page.waitForSelector('.event-detail-panel', { timeout: 10000 })
const metaText = await page.textContent('.event-meta-grid')
console.log('Event meta grid:', metaText.replace(/\s+/g, ' ').trim())
const storyBody = await page.textContent('.event-story-body')
console.log(`Story body length: ${storyBody.length} chars`)
const timelineStages = await page.locator('.event-timeline-stage').count()
console.log(`Timeline stages: ${timelineStages}`)

const followBtn = page.locator('.event-detail-actions button:has-text("Follow Event")')
if ((await followBtn.count()) > 0) {
  await followBtn.click()
  await page.waitForTimeout(200)
  const followingBtn = await page.textContent('.event-detail-actions button:has-text("Following")')
  console.log('After clicking Follow:', followingBtn?.trim())
}

const viewOnMapBtn = page.locator('.event-detail-actions button:has-text("View on Map")')
await viewOnMapBtn.click()
await page.waitForTimeout(1000)
console.log('[ok] Clicked View on Map without error (also closes the event detail panel)')

// The News panel was never closed, so it should still be open behind the
// event detail panel, now showing the followed story in its own row.
const followedRow = await page.locator('.followed-events-row').count()
console.log(`Followed-events row visible after following a story: ${followedRow > 0}`)

console.log('CONSOLE ERRORS:', errors.length === 0 ? 'none' : JSON.stringify(errors, null, 2))
await browser.close()
process.exit(errors.length > 0 ? 1 : 0)
