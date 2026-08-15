import type { WorldState, ParseResult } from '@/domain/schemas'

export interface ParseContext {
  worldState: WorldState
  playerEntityId: string
}

export interface CommandParser {
  readonly id: 'ai' | 'fallback'
  isAvailable(): boolean
  parse(input: string, ctx: ParseContext): Promise<ParseResult>
}
