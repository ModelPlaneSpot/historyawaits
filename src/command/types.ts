import type { WorldState, ParseResult } from '@/domain/schemas'

export interface ParseContext {
  worldState: WorldState
  playerEntityId: string
  /** The region the player currently has selected on the map, if any --
   *  lets commands like "annex this region" / "return this region" resolve
   *  without the player having to name it. */
  selectedRegionId: string | null
}

export interface CommandParser {
  readonly id: 'ai' | 'fallback'
  isAvailable(): boolean
  parse(input: string, ctx: ParseContext): Promise<ParseResult>
}
