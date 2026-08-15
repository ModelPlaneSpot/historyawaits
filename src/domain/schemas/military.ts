import { z } from 'zod'

export const Equipment = z.object({
  tanks: z.number().int().min(0),
  aircraft: z.number().int().min(0),
  ships: z.number().int().min(0),
  artillery: z.number().int().min(0),
})
export type Equipment = z.infer<typeof Equipment>

export const Military = z.object({
  personnelActive: z.number().int().min(0),
  personnelReserve: z.number().int().min(0),
  equipment: Equipment,
  techLevel: z.number().min(0).max(100),
  morale: z.number().min(0).max(100),
  mobilizationLevel: z.number().min(0).max(100),
})
export type Military = z.infer<typeof Military>
