import { z } from 'zod'

export const NewsEvent = z.object({
  id: z.string(),
  turn: z.number().int().min(0),
  headline: z.string(),
  body: z.string(),
  entityIds: z.array(z.string()),
  severity: z.enum(['info', 'notable', 'major']),
})
export type NewsEvent = z.infer<typeof NewsEvent>
