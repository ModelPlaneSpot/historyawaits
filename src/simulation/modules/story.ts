import type { WorldState, NewsCategory, NewsImportance, StoryType, StoryStatus, StoryEvent } from '@/domain/schemas'
import { pushNews } from './news'

let counter = 0

export interface CreateStoryOptions {
  type: StoryType
  title: string
  importance: NewsImportance
  category: NewsCategory
  countryIds: string[]
  regionIds: string[]
  headline: string
  body: string
  locationEntityId?: string | null
  locationRegionId?: string | null
  background: string
  trigger: string
  situation: string
  internationalReaction: string
  consequences: string
  status?: StoryStatus
}

/** Starts a new persistent storyline AND pushes its opening news item in one
 *  call -- every StoryEvent begins life as a stage-1 news headline, so
 *  callers never have to remember to keep the two in sync. */
export function createStory(state: WorldState, turn: number, opts: CreateStoryOptions): string {
  counter += 1
  const id = `STORY-${turn}-${counter}`
  state.storyEvents[id] = {
    id,
    type: opts.type,
    title: opts.title,
    status: opts.status ?? 'active',
    importance: opts.importance,
    startTurn: turn,
    endTurn: null,
    countryIds: opts.countryIds,
    regionIds: opts.regionIds,
    background: opts.background,
    trigger: opts.trigger,
    situation: opts.situation,
    internationalReaction: opts.internationalReaction,
    consequences: opts.consequences,
    stages: [{ turn, headline: opts.headline, body: opts.body }],
    followed: false,
  }
  pushNews(state, turn, opts.headline, opts.body, opts.countryIds, {
    category: opts.category,
    importance: opts.importance,
    locationEntityId: opts.locationEntityId,
    locationRegionId: opts.locationRegionId,
    storyEventId: id,
  })
  return id
}

export interface AppendStageOptions {
  headline: string
  body: string
  category: NewsCategory
  importance?: NewsImportance
  locationEntityId?: string | null
  locationRegionId?: string | null
  /** Refreshed narrative sections -- only pass the ones that actually
   *  changed; anything omitted keeps its previous text. */
  situation?: string
  consequences?: string
  status?: StoryStatus
  addCountryIds?: string[]
  addRegionIds?: string[]
}

/** Records the next development in an existing story (a capture, an ally
 *  joining, a ceasefire...) and pushes a linked news item for it. A no-op if
 *  storyId is null/missing so callers can pass an optional link without a
 *  guard at every call site. */
export function appendStoryStage(state: WorldState, storyId: string | null | undefined, turn: number, opts: AppendStageOptions): void {
  if (!storyId) return
  const story = state.storyEvents[storyId]
  if (!story) return

  story.stages.push({ turn, headline: opts.headline, body: opts.body })
  if (opts.situation) story.situation = opts.situation
  if (opts.consequences) story.consequences = opts.consequences
  if (opts.importance) story.importance = opts.importance
  if (opts.status) {
    story.status = opts.status
    if (opts.status === 'resolved') story.endTurn = turn
  }
  for (const id of opts.addCountryIds ?? []) if (!story.countryIds.includes(id)) story.countryIds.push(id)
  for (const id of opts.addRegionIds ?? []) if (!story.regionIds.includes(id)) story.regionIds.push(id)

  pushNews(state, turn, opts.headline, opts.body, story.countryIds, {
    category: opts.category,
    importance: opts.importance ?? story.importance,
    locationEntityId: opts.locationEntityId,
    locationRegionId: opts.locationRegionId,
    storyEventId: story.id,
  })
}

/** Finds an unresolved story of a given type involving ALL of the given
 *  countries -- used to avoid starting a brand-new, disconnected story when
 *  one is already developing (e.g. don't open a second "war" story for a
 *  pair that already has an open "diplomatic_crisis" story; upgrade it). */
export function findOpenStory(state: WorldState, type: StoryType, countryIds: string[]): StoryEvent | null {
  return (
    Object.values(state.storyEvents).find(
      (s) => s.type === type && s.status !== 'resolved' && countryIds.every((id) => s.countryIds.includes(id)),
    ) ?? null
  )
}

export function toggleFollowStory(state: WorldState, storyId: string): boolean {
  const story = state.storyEvents[storyId]
  if (!story) return false
  story.followed = !story.followed
  return true
}
