import type { ParseResult } from '@/domain/schemas'
import type { ParseContext } from './types'
import { aiParser } from './aiParser'
import { fallbackParser } from './fallbackParser'

export interface OrchestratedResult extends ParseResult {
  source: 'ai' | 'fallback'
}

/** Resolution order: try the local AI first if it's loaded; fall back to the
 *  deterministic parser if the AI is unavailable, fails, or produces a
 *  low-confidence/ungrounded result. The fallback parser is always the
 *  guaranteed path -- the game is fully playable with the AI off entirely. */
export async function interpretCommand(input: string, ctx: ParseContext): Promise<OrchestratedResult> {
  if (aiParser.isAvailable()) {
    const aiResult = await aiParser.parse(input, ctx)
    if (aiResult.ok && aiResult.confidence >= 0.5) {
      return { ...aiResult, source: 'ai' }
    }
  }
  const fallbackResult = await fallbackParser.parse(input, ctx)
  return { ...fallbackResult, source: 'fallback' }
}
