import { z } from 'zod'

/** A non-state armed/political organization, e.g. a militia or paramilitary group. */
export const Organization = z.object({
  id: z.string(),
  name: z.string(),
  hostEntityId: z.string(),
  controlsRegionIds: z.array(z.string()),
  strength: z.number().min(0).max(100),
  active: z.boolean(),
  dissolvedTurn: z.number().int().nullable(),
})
export type Organization = z.infer<typeof Organization>
