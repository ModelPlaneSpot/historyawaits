import { z } from 'zod'
import { Ideology } from './common'

export const GovernmentType = z.enum([
  'democracy',
  'authoritarian',
  'monarchy',
  'theocracy',
  'military_junta',
  'communist_state',
  'failed_state',
])
export type GovernmentType = z.infer<typeof GovernmentType>

export const PoliticalParty = z.object({
  id: z.string(),
  name: z.string(),
  ideology: Ideology,
  approval: z.number().min(0).max(100),
  seatShare: z.number().min(0).max(100).optional(),
  ruling: z.boolean(),
})
export type PoliticalParty = z.infer<typeof PoliticalParty>

export const Government = z.object({
  type: GovernmentType,
  headOfState: z.string(),
  rulingPartyId: z.string().nullable(),
  stability: z.number().min(0).max(100),
  coupRisk: z.number().min(0).max(100),
  electionDueTurn: z.number().int().nullable(),
})
export type Government = z.infer<typeof Government>
