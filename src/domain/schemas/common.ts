import { z } from 'zod'

export const DataConfidence = z.enum(['authored', 'estimated'])
export type DataConfidence = z.infer<typeof DataConfidence>

export const Ideology = z.object({
  economicLeft: z.number().min(0).max(100),
  socialLiberal: z.number().min(0).max(100),
  nationalism: z.number().min(0).max(100),
})
export type Ideology = z.infer<typeof Ideology>

export const ResourceType = z.enum([
  'oil',
  'naturalGas',
  'coal',
  'freshWater',
  'arableLand',
  'rareMinerals',
  'timber',
])
export type ResourceType = z.infer<typeof ResourceType>

export const ResourceStock = z.record(ResourceType, z.number().min(0))
export type ResourceStock = z.infer<typeof ResourceStock>

export const UnitType = z.enum(['troops', 'tanks', 'aircraft', 'ships', 'artillery'])
export type UnitType = z.infer<typeof UnitType>
