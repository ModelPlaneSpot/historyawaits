import type { ParseResult } from '@/domain/schemas'
import type { ParseContext } from './types'
import { aiParser } from './aiParser'
import { fallbackParser } from './fallbackParser'
import { isQuestion } from './intentClassifier'
import { describePlan } from './describePlan'

export interface OrchestratedResult extends ParseResult {
  source: 'ai' | 'fallback'
}

function withSummary(result: ParseResult, ctx: ParseContext): ParseResult {
  if (!result.ok || !result.plan) return result
  return { ...result, interpretedSummary: describePlan(result.plan, ctx.worldState) }
}

/** Resolution order: questions are filtered out before either parser runs
 *  (a question must never become a command, and it isn't worth an AI
 *  inference call to establish that). Otherwise, try the local AI first if
 *  it's loaded; fall back to the deterministic parser if the AI is
 *  unavailable, fails, or produces a low-confidence/ungrounded result. The
 *  fallback parser is always the guaranteed path -- the game is fully
 *  playable with the AI off entirely. */
export async function interpretCommand(input: string, ctx: ParseContext): Promise<OrchestratedResult> {
  if (isQuestion(input)) {
    return {
      ok: false,
      plan: null,
      confidence: 0.9,
      raw: input,
      error: 'That reads as a question, not an instruction -- ask the AI Advisor (top bar) for analysis, or phrase it as a command (e.g. "attack Iran") to execute it.',
      clarificationQuestion: null,
      interpretedSummary: null,
      source: 'fallback',
    }
  }

  if (aiParser.isAvailable()) {
    const aiResult = await aiParser.parse(input, ctx)
    if (aiResult.ok && aiResult.plan && aiResult.confidence >= 0.5) {
      return { ...withSummary(aiResult, ctx), source: 'ai' }
    }
  }
  const fallbackResult = await fallbackParser.parse(input, ctx)
  return { ...withSummary(fallbackResult, ctx), source: 'fallback' }
}
