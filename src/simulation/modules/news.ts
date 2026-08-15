import type { WorldState, NewsCategory, NewsImportance } from '@/domain/schemas'

let counter = 0

export interface PushNewsOptions {
  category: NewsCategory
  importance: NewsImportance
  locationEntityId?: string | null
  locationRegionId?: string | null
}

export function pushNews(
  state: WorldState,
  turn: number,
  headline: string,
  body: string,
  entityIds: string[],
  opts: PushNewsOptions,
): void {
  counter += 1
  state.news.push({
    id: `NEWS-${turn}-${counter}`,
    turn,
    headline,
    body,
    entityIds,
    category: opts.category,
    importance: opts.importance,
    locationEntityId: opts.locationEntityId ?? entityIds[0] ?? null,
    locationRegionId: opts.locationRegionId ?? null,
  })
  // Keep the log bounded -- old news doesn't need to be recomputed or
  // rendered, but the cap is generous so the "permanent world timeline"
  // (see NewsFeedPanel) still covers a full long game.
  if (state.news.length > 2000) state.news.splice(0, state.news.length - 2000)
}
