/** The simulation advances in fixed 3-day ticks (`WorldState.turn` counts
 *  ticks), and every tick is one "event round" -- the world gets at least one
 *  event every 3 in-game days. A player turn spans one or more ticks (see
 *  TURN_LENGTH_OPTIONS); the game runs from January 1, 2026 to January 1,
 *  2126, at which point the victory standings are final. */
export const TICK_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000

export const GAME_START_DATE = new Date(Date.UTC(2026, 0, 1))
export const GAME_END_DATE = new Date(Date.UTC(2126, 0, 1))

export const TOTAL_GAME_DAYS = Math.round((GAME_END_DATE.getTime() - GAME_START_DATE.getTime()) / DAY_MS)
/** The tick on which the game ends (the first tick on/after the end date). */
export const FINAL_TICK = Math.ceil(TOTAL_GAME_DAYS / TICK_DAYS)

export const TICKS_PER_YEAR = 365.25 / TICK_DAYS
/** Per-tick drift rates were originally tuned for weekly turns; multiply by
 *  this to keep the same pace per in-game day. */
export const WEEK_FRACTION = TICK_DAYS / 7

export function yearsToTicks(years: number): number {
  return Math.round(years * TICKS_PER_YEAR)
}

export interface TurnLengthOption {
  days: number
  label: string
}

export const TURN_LENGTH_OPTIONS: TurnLengthOption[] = [
  { days: 3, label: '3 days' },
  { days: 30, label: '30 days' },
  { days: 60, label: '60 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '6 months' },
]
export const DEFAULT_TURN_LENGTH_DAYS = 30

export function daysToTicks(days: number): number {
  return Math.max(1, Math.round(days / TICK_DAYS))
}

export function turnToDate(turn: number): Date {
  if (turn >= FINAL_TICK) return GAME_END_DATE
  return new Date(GAME_START_DATE.getTime() + turn * TICK_DAYS * DAY_MS)
}

export function formatGameDate(turn: number): string {
  return turnToDate(turn).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

export function formatShortGameDate(turn: number): string {
  return turnToDate(turn).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function isGameOver(turn: number): boolean {
  return turn >= FINAL_TICK
}

/** 0..1 progress through the century. */
export function gameProgress(turn: number): number {
  return Math.min(1, turn / FINAL_TICK)
}
