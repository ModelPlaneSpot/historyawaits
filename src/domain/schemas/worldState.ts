import { z } from 'zod'
import { WorldEntity } from './entity'
import { Region } from './region'
import { Organization } from './organization'
import { War } from './war'
import { Treaty } from './diplomacy'
import { NewsEvent } from './news'
import { StoryEvent } from './story'

export const SAVE_FORMAT_VERSION = 1

export const WorldState = z.object({
  saveVersion: z.literal(SAVE_FORMAT_VERSION),
  turn: z.number().int().min(0),
  playerEntityId: z.string(),
  entities: z.record(z.string(), WorldEntity),
  regions: z.record(z.string(), Region),
  organizations: z.record(z.string(), Organization),
  wars: z.record(z.string(), War),
  treaties: z.record(z.string(), Treaty),
  news: z.array(NewsEvent),
  storyEvents: z.record(z.string(), StoryEvent),
})
export type WorldState = z.infer<typeof WorldState>
