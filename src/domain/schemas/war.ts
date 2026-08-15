import { z } from 'zod'

export const War = z.object({
  id: z.string(),
  attackerIds: z.array(z.string()).min(1),
  defenderIds: z.array(z.string()).min(1),
  startTurn: z.number().int().min(0),
  endTurn: z.number().int().nullable(),
  warGoal: z.enum(['conquest', 'annexation', 'liberation', 'regime_change', 'independence']),
  contestedRegionIds: z.array(z.string()),
  warScore: z.number().min(-100).max(100),
  active: z.boolean(),
})
export type War = z.infer<typeof War>
