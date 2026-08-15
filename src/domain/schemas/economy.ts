import { z } from 'zod'
import { ResourceStock } from './common'

export const Economy = z.object({
  gdpUsd: z.number().min(0),
  gdpPerCapitaUsd: z.number().min(0),
  growthRatePct: z.number(),
  treasuryUsd: z.number(),
  debtToGdpPct: z.number().min(0),
  militarySpendingPctOfGdp: z.number().min(0).max(100),
  unemploymentRatePct: z.number().min(0).max(100),
  inflationPct: z.number(),
  tradeBalanceUsd: z.number(),
  resources: ResourceStock,
})
export type Economy = z.infer<typeof Economy>
