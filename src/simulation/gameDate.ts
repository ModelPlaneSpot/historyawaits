/** Every turn is one week; the game clock starts on a fixed in-world date so
 *  "current date" is a real calendar date, not just an abstract turn number. */
const GAME_START_DATE = new Date(Date.UTC(2026, 0, 5)) // a Monday

export function turnToDate(turn: number): Date {
  const ms = GAME_START_DATE.getTime() + turn * 7 * 24 * 60 * 60 * 1000
  return new Date(ms)
}

export function formatGameDate(turn: number): string {
  return turnToDate(turn).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
