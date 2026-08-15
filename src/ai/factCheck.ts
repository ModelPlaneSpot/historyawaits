import type { WorldState } from '@/domain/schemas'
import { buildResolverIndex } from '@/command/entityResolver'

interface StatCheck {
  label: string
  keywords: RegExp
  value: number
  tolerance: number // fraction, e.g. 0.15 = allow +/-15% as "reasonably rounded"
  isCurrency: boolean
}

function parseNumberToken(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '')
  const match = cleaned.match(/^([\d.]+)\s*(million|billion|thousand|k|m|b)?$/i)
  if (!match) return null
  let n = parseFloat(match[1])
  if (Number.isNaN(n)) return null
  const suffix = match[2]?.toLowerCase()
  if (suffix === 'thousand' || suffix === 'k') n *= 1e3
  if (suffix === 'million' || suffix === 'm') n *= 1e6
  if (suffix === 'billion' || suffix === 'b') n *= 1e9
  return n
}

const NUMBER_TOKEN = /\b(\d[\d,]*(?:\.\d+)?)\s*(million|billion|thousand|k|m|b)?\b/gi

/**
 * The local model is never treated as the source of truth for numbers -- this
 * scans its reply for figures next to a recognized "our own stat" keyword,
 * and appends a correction if a figure is well outside a reasonable rounding
 * of the actual current simulation value. Numbers near a foreign country's
 * name are left alone (those are legitimately fuzzed estimates, not ours).
 */
export function factCheckReply(reply: string, worldState: WorldState): string {
  const player = worldState.entities[worldState.playerEntityId]
  if (!player) return reply

  const checks: StatCheck[] = [
    { label: 'active personnel', keywords: /active (personnel|troops|soldiers|military)|(troops|personnel) active/i, value: player.military.personnelActive, tolerance: 0.15, isCurrency: false },
    { label: 'reserve personnel', keywords: /reserve(s)?/i, value: player.military.personnelReserve, tolerance: 0.2, isCurrency: false },
    { label: 'tanks', keywords: /tanks?/i, value: player.military.equipment.tanks, tolerance: 0.15, isCurrency: false },
    { label: 'aircraft', keywords: /aircraft|fighters?|jets?|planes?/i, value: player.military.equipment.aircraft, tolerance: 0.15, isCurrency: false },
    { label: 'ships', keywords: /ships?|navy|naval vessels?/i, value: player.military.equipment.ships, tolerance: 0.2, isCurrency: false },
    { label: 'artillery', keywords: /artillery/i, value: player.military.equipment.artillery, tolerance: 0.2, isCurrency: false },
    { label: 'GDP', keywords: /\bGDP\b/i, value: player.economy.gdpUsd, tolerance: 0.1, isCurrency: true },
    { label: 'treasury', keywords: /treasury/i, value: player.economy.treasuryUsd, tolerance: 0.25, isCurrency: true },
    { label: 'population', keywords: /population/i, value: player.population.total, tolerance: 0.1, isCurrency: false },
  ]

  const index = buildResolverIndex(worldState)
  const foreignNames = [...index.entities.entries()]
    .filter(([, id]) => id !== player.id)
    .map(([name]) => name)
    .filter((n) => n.length > 3)

  const corrections: string[] = []
  const seen = new Set<string>()

  for (const check of checks) {
    if (seen.has(check.label)) continue
    const keywordMatch = reply.match(check.keywords)
    if (!keywordMatch || keywordMatch.index === undefined) continue

    // Skip if a foreign country's name appears within ~50 chars of the keyword --
    // that number is describing them, not us.
    const windowStart = Math.max(0, keywordMatch.index - 50)
    const windowEnd = Math.min(reply.length, keywordMatch.index + keywordMatch[0].length + 50)
    const window = reply.slice(windowStart, windowEnd)
    if (foreignNames.some((name) => window.toLowerCase().includes(name.toLowerCase()))) continue

    NUMBER_TOKEN.lastIndex = 0
    let closestNumber: number | null = null
    let closestDistance = Infinity
    let m: RegExpExecArray | null
    while ((m = NUMBER_TOKEN.exec(window)) !== null) {
      const n = parseNumberToken(m[0])
      if (n === null || n === 0) continue
      const distance = Math.abs(m.index - (keywordMatch.index - windowStart))
      if (distance < closestDistance) {
        closestDistance = distance
        closestNumber = n
      }
    }
    if (closestNumber === null) continue

    const actual = check.value
    if (actual <= 0) continue
    const ratio = closestNumber / actual
    if (ratio < 1 - check.tolerance || ratio > 1 + check.tolerance) {
      seen.add(check.label)
      corrections.push(`${check.label}: ${formatValue(actual, check.isCurrency)} (not ${formatValue(closestNumber, check.isCurrency)})`)
    }
  }

  if (corrections.length === 0) return reply
  return `${reply}\n\n⚠ Simulation correction -- the actual current values are:\n${corrections.map((c) => `- ${c}`).join('\n')}`
}

function formatValue(n: number, isCurrency: boolean): string {
  if (isCurrency) {
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
    return `$${Math.round(n).toLocaleString()}`
  }
  return Math.round(n).toLocaleString()
}
