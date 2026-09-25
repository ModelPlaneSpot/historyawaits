import type { GovernmentType } from './schemas'

/** Real-world rivalries seeded as hostile relations at world-gen (see
 *  RIVALRY_SEEDS in scripts/generate-baseline-data.ts) and treated, at
 *  runtime, as a natural equilibrium the relation drifts back toward even
 *  after cooling off from a war -- see naturalEquilibrium below. Unlike an
 *  ordinary dispute, these don't fade to neutral on their own. */
export const HISTORICAL_RIVALRIES: [string, string][] = [
  ['PRK', 'KOR'],
  ['IND', 'PAK'],
  ['ISR', 'IRN'],
  ['RUS', 'UKR'],
  ['ARE', 'IRN'],
  ['SAU', 'IRN'],
  ['MAR', 'ESH'],
  ['CHN', 'TWN'],
  ['SOM', 'SOL'],
]

const RIVALRY_KEYS = new Set(HISTORICAL_RIVALRIES.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]))

export function isHistoricalRivalry(aId: string, bId: string): boolean {
  return RIVALRY_KEYS.has(`${aId}|${bId}`)
}

/** Loose ideological camp used only to give governments a natural (small)
 *  pull toward or away from each other -- not a hard alliance system. A
 *  government with no strong camp (monarchy, failed_state) doesn't pull
 *  either way. */
export function governmentCamp(type: GovernmentType): 'open' | 'autocratic' | null {
  if (type === 'democracy') return 'open'
  if (type === 'authoritarian' || type === 'military_junta' || type === 'communist_state' || type === 'theocracy') return 'autocratic'
  return null
}

/** The opinion value a relation drifts toward absent any actual event
 *  (war, treaty, explicit diplomacy) -- this is what lets rivalries persist
 *  and ideological blocs emerge on their own instead of everything settling
 *  at neutral. */
export function naturalEquilibrium(aId: string, aGov: GovernmentType, bId: string, bGov: GovernmentType): number {
  if (isHistoricalRivalry(aId, bId)) return -50
  const campA = governmentCamp(aGov)
  const campB = governmentCamp(bGov)
  if (campA && campB) return campA === campB ? 15 : -15
  return 0
}
