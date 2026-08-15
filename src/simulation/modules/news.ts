import type { WorldState, NewsEvent } from '@/domain/schemas'

let counter = 0

export function pushNews(
  state: WorldState,
  turn: number,
  headline: string,
  body: string,
  entityIds: string[],
  severity: NewsEvent['severity'],
): void {
  counter += 1
  state.news.push({ id: `NEWS-${turn}-${counter}`, turn, headline, body, entityIds, severity })
  // Keep the log bounded -- old news doesn't need to be recomputed or rendered.
  if (state.news.length > 500) state.news.splice(0, state.news.length - 500)
}
