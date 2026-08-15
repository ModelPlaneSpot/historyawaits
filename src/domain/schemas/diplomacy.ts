import { z } from 'zod'

export const RelationStatus = z.enum(['war', 'hostile', 'neutral', 'friendly', 'allied'])
export type RelationStatus = z.infer<typeof RelationStatus>

export const Relation = z.object({
  otherEntityId: z.string(),
  opinion: z.number().min(-100).max(100),
  status: RelationStatus,
  treatyIds: z.array(z.string()),
})
export type Relation = z.infer<typeof Relation>

export const TreatyType = z.enum(['defense_pact', 'trade_agreement', 'peace_treaty', 'non_aggression'])
export type TreatyType = z.infer<typeof TreatyType>

export const Treaty = z.object({
  id: z.string(),
  type: TreatyType,
  memberIds: z.array(z.string()).min(2),
  signedTurn: z.number().int().min(0),
  active: z.boolean(),
})
export type Treaty = z.infer<typeof Treaty>
