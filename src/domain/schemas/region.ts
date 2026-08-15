import { z } from 'zod'

/** Admin-1 (state/province) level region. Stats are derived/proportional from
 *  the controlling entity's aggregates, not independently simulated. */
export const Region = z.object({
  id: z.string(),
  name: z.string(),
  countryId: z.string(),
  controllerId: z.string(),
  populationShare: z.number().min(0).max(1),
  gdpShare: z.number().min(0).max(1),
  unrest: z.number().min(0).max(100),
  infrastructureLevel: z.number().min(0).max(100),
  isCapitalRegion: z.boolean(),
  disputed: z.boolean(),
  contestedByIds: z.array(z.string()),
  occupyingOrganizationId: z.string().nullable(),
})
export type Region = z.infer<typeof Region>
