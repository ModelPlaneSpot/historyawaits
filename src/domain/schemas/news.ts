import { z } from 'zod'

export const NewsCategory = z.enum([
  'breaking',
  'war',
  'military',
  'diplomacy',
  'economy',
  'politics',
  'disaster',
  'technology',
  'terrorism',
  'civil_conflict',
  'international',
  'territorial',
  'resources',
])
export type NewsCategory = z.infer<typeof NewsCategory>

/** Drives how loudly an event surfaces to the player: minor events are kept
 *  in the permanent world history but not pushed at them, medium events show
 *  up in the news feed, major events also raise a notification, and critical
 *  events additionally pull the camera to their location (see MapView). */
export const NewsImportance = z.enum(['minor', 'medium', 'major', 'critical'])
export type NewsImportance = z.infer<typeof NewsImportance>

export const NewsEvent = z.object({
  id: z.string(),
  turn: z.number().int().min(0),
  headline: z.string(),
  body: z.string(),
  entityIds: z.array(z.string()),
  category: NewsCategory,
  importance: NewsImportance,
  /** Where to point the camera if the player clicks this event, if anywhere. */
  locationEntityId: z.string().nullable(),
  locationRegionId: z.string().nullable(),
  /** The persistent StoryEvent this news item is one stage of, if any --
   *  lets the player open the full developing narrative behind a headline. */
  storyEventId: z.string().nullable(),
})
export type NewsEvent = z.infer<typeof NewsEvent>
