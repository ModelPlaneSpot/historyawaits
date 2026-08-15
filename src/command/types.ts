import type { WorldState, ParseResult } from '@/domain/schemas'

export interface ParseContext {
  worldState: WorldState
  playerEntityId: string
  /** The region the player currently has selected on the map, if any --
   *  lets commands like "annex this region" / "return this region" resolve
   *  without the player having to name it. */
  selectedRegionId: string | null
  /** The entity/region targeted by the player's last command, if any -- lets
   *  "send another 20,000 there" / "attack them" resolve pronouns against
   *  what was just being discussed instead of requiring the name again. */
  lastEntityId: string | null
  lastRegionId: string | null
}

/** >=0.8: execute immediately. 0.5-0.8: show the interpreted plan and ask
 *  the player to confirm before executing. <0.5: ask a clarifying question
 *  and don't execute anything. Never guess on a coin flip. */
export type ConfidenceTier = 'high' | 'medium' | 'low'
export function confidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= 0.8) return 'high'
  if (confidence >= 0.5) return 'medium'
  return 'low'
}

export interface CommandParser {
  readonly id: 'ai' | 'fallback'
  isAvailable(): boolean
  parse(input: string, ctx: ParseContext): Promise<ParseResult>
}
