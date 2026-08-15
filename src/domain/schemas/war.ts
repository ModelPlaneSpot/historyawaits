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
  /** Escalation scale: 1 diplomatic tension, 2 border incident, 3 skirmish,
   *  4 limited conflict, 5 regional war, 6 full-scale war, 7 international
   *  war. A formally declared war always starts at 4; it climbs as more
   *  countries are drawn in (see considerAllyDrawIn in war.ts). */
  level: z.number().int().min(1).max(7),
  isCivilWar: z.boolean(),
  /** The persistent StoryEvent tracking this war's long-form narrative. */
  storyEventId: z.string().nullable(),
})
export type War = z.infer<typeof War>
