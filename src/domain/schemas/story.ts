import { z } from 'zod'
import { NewsImportance } from './news'

export const StoryType = z.enum(['war', 'civil_war', 'economic_crisis', 'coup', 'election', 'diplomatic_crisis'])
export type StoryType = z.infer<typeof StoryType>

export const StoryStatus = z.enum(['developing', 'active', 'resolved'])
export type StoryStatus = z.infer<typeof StoryStatus>

/** One dated development within a story -- "Thai and Cambodian Forces
 *  Mobilize", three turns later "Border Clash Leaves Dozens Dead", etc. This
 *  is what lets a single conflict read as a developing narrative across many
 *  turns instead of a series of disconnected one-line news blips. */
export const StoryStage = z.object({
  turn: z.number().int().min(0),
  headline: z.string(),
  body: z.string(),
})
export type StoryStage = z.infer<typeof StoryStage>

/** A persistent, developing storyline behind one or more short news items.
 *  Created once (e.g. when a war is declared or a civil war erupts) and
 *  updated in place as the situation develops (captures, allies joining,
 *  ceasefires...) rather than the player only ever seeing isolated
 *  headlines. Lives in WorldState so it survives save/load, and every field
 *  is generated from real simulation state at the point it's written --
 *  never invented independent of what actually happened. */
export const StoryEvent = z.object({
  id: z.string(),
  type: StoryType,
  title: z.string(),
  status: StoryStatus,
  importance: NewsImportance,
  startTurn: z.number().int().min(0),
  endTurn: z.number().int().nullable(),
  countryIds: z.array(z.string()),
  regionIds: z.array(z.string()),
  background: z.string(),
  trigger: z.string(),
  situation: z.string(),
  internationalReaction: z.string(),
  consequences: z.string(),
  stages: z.array(StoryStage),
  followed: z.boolean(),
})
export type StoryEvent = z.infer<typeof StoryEvent>
