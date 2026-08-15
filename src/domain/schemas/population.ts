import { z } from 'zod'

export const Population = z.object({
  total: z.number().int().min(0),
  growthRatePct: z.number(),
  urbanizationPct: z.number().min(0).max(100),
  unrest: z.number().min(0).max(100),
})
export type Population = z.infer<typeof Population>
