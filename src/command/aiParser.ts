import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { ActionType, TreatyKind, UnitType, StructuredAction, type ParseResult, type StructuredPlan } from '@/domain/schemas'
import type { CommandParser, ParseContext } from './types'
import { buildResolverIndex, resolveEntity, resolveOrganization, resolveRegionOrOrganizationOrEntity, type ResolveResult } from './entityResolver'
import { localAiEngine } from '@/ai/localAiEngine'
import { levenshtein, toleranceFor } from './fuzzyMatch'

/** What we ask the small local model to extract, one entry per intended
 *  action step. Names are free text -- grounding them into real entity/
 *  region/organization ids is done afterward by the same deterministic
 *  resolver the fallback parser uses. This keeps the model's job to intent +
 *  names + numbers, not memorizing hundreds of ISO codes, which a 0.5B model
 *  can't reliably do. */
const AiStep = z.object({
  action: ActionType,
  targetName: z.string().nullable().describe('Country, region, or place name the action targets, in plain text'),
  organizationName: z.string().nullable().describe('Name of a non-state organization, or (for cede_territory) the recipient country, if mentioned'),
  treatyType: TreatyKind.nullable(),
  quantity: z.number().nullable(),
  unit: UnitType.nullable(),
  percent: z.number().nullable(),
  negated: z.boolean().describe('True if the player said NOT to do this (e.g. "don\'t attack Iran", "stop mobilizing") -- the action must not be executed'),
  note: z.string().nullable().describe('For "unsupported": a short plain-English description of what the player actually asked for'),
})
type AiStep = z.infer<typeof AiStep>

const AiExtraction = z.object({
  steps: z.array(AiStep).max(8).describe('One entry per distinct instruction in the command, in order'),
})
type AiExtraction = z.infer<typeof AiExtraction>

const EXTRACTION_JSON_SCHEMA = JSON.stringify(zodToJsonSchema(AiExtraction, 'AiExtraction'))

const ACTION_LIST = ActionType.options.join(', ')

// The 0.5B extraction model occasionally flips "negated" to true on a plain,
// affirmative command (e.g. "mobilize 400,000 troops" -> negated). Since
// executing a command the player actually gave is far worse than the reverse,
// only trust the model's negation when the input actually contains a
// negation cue -- otherwise force it back to false.
const NEGATION_CUE_RE = /\b(don'?t|do\s+not|doesn'?t|never|avoid(?:ing)?|prevent(?:ing)?|stop|stopping|cancel(?:ing|ling)?|won'?t|will\s+not|shouldn'?t|should\s+not|refuse(?:s|ing)?|no\s+longer)\b/i

const NAME_STOPWORDS = new Set(['the', 'of', 'and', 'de', 'republic', 'democratic', 'united', 'kingdom', 'states', 'people'])

function significantWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !NAME_STOPWORDS.has(w))
}

/** Guards against the same small model inventing a country/organization name
 *  with no relation to what the player actually typed (observed failure
 *  mode: a plain "mobilize 400,000 troops" hallucinating a target like
 *  "Iran" that was never mentioned). Requires at least one significant word
 *  of the name to fuzzy-match a word in the raw input, so legitimate typo
 *  correction the model is asked to do ("Isreal" -> "Israel") still passes. */
function mentionedInInput(input: string, name: string): boolean {
  const nameWords = significantWords(name)
  if (nameWords.length === 0) return true
  const inputWords = significantWords(input)
  return nameWords.some((nw) => inputWords.some((iw) => levenshtein(nw, iw) <= toleranceFor(Math.max(nw.length, iw.length))))
}

const SYSTEM_PROMPT = `You are a command interpreter for a geopolitical strategy game. The player issues a natural-language command as the leader of one country, possibly written conversationally, with typos, slang, or without using the "expected" keyword. Understand the MEANING and INTENT of the whole message, not just keywords. Convert it into a JSON object matching this schema:

${EXTRACTION_JSON_SCHEMA}

Rules:
- Produce one entry in "steps" per distinct instruction, in the order given. A simple command produces exactly one step.
- action must be one of: ${ACTION_LIST}.
- Understand intent even without exact keywords. Examples: "I want our forces to cross the border and take control of northern Iran" -> declare_war (or annex if already at war) on Iran. "Put 100,000 soldiers near the Iranian border" -> mobilize, quantity 100000. "I want France to be our closest military partner" -> form_alliance with France. "Make the army much bigger" -> mobilize (pick a reasonable quantity, e.g. 10% of current active personnel, and say so in "note"). "Spend more on the armed forces" -> set_military_spending, a modest increase over the current value. "Gear up the army" -> set_readiness, increased.
- Recognize synonyms: "invade"/"attack"/"launch an offensive against"/"begin military operations against"/"launch the invasion of" all mean declare_war. "make peace"/"end the war"/"stop fighting with"/"start peace talks with" mean propose_peace. "capture"/"seize" mean annex. "release"/"liberate" mean grant_independence. "withdraw from X"/"get our forces out of X"/"pull out of X" mean cede_territory (back to the original owner).
- IMPORTANT -- preparation is not execution: "prepare for war with X" / "prepare an invasion of X" / "get ready for a possible war" means set_readiness (raise it), NOT declare_war. Only "attack X" / "invade X" / "launch the invasion of X" actually declares war.
- Tolerate typos and misspellings (e.g. "atack" = attack, "moblize" = mobilize, "millitary" = military, "Isreal" = Israel, "Camboda" = Cambodia) -- correct them silently.
- negated: set true when the player says NOT to do something ("don't attack Iran", "never invade", "avoid war with X", "stop mobilizing", "cancel the deployment"). Still fill in action/targetName as what was being negated, just mark negated true -- the game will acknowledge without executing it.
- targetName is the plain-text name of the country, region, or place being acted on (e.g. "Iran", "Gaza", "France"). If the player says "this region"/"here", or a pronoun like "there"/"it"/"them"/"that country" referring to something from earlier in the conversation, set targetName to null and let it resolve from context. Use null if there is no target.
- organizationName is the name of a non-state organization for dissolve_organization/recognize actions, OR the recipient country's name for cede_territory. Use null otherwise.
- quantity/unit are used for mobilize, demobilize, and build_units (unit is one of troops, tanks, aircraft, ships, artillery -- map IFV/APC to tanks, SAM to artillery).
- percent is used for set_military_spending, set_readiness, and set_tax_rate. Distinguish "increase BY N percent" (add N to the current value) from "increase TO N percent" (set it to N) -- you don't know the current value, so just extract N into percent and note in "note" whether it was relative ("by") or absolute ("to") if there's any ambiguity. "double"/"triple"/"reduce by half" are relative multipliers, not literal percentages -- describe them in "note" instead of guessing a percent.
- Do NOT execute questions. "Should we invade Iran?" / "What would happen if we attacked Iran?" / "Can we win this war?" are QUESTIONS, not commands -- if the entire message is a question, return a single step with action "unsupported" and a note that this is a question for the AI Advisor, not a command.
- Broad, vague goals ("fix our economy", "we need to be less dependent on foreign oil") do not have one obvious action -- set action to "unsupported" and note the concrete levers that do exist (tax rate, military spending, research, sanctions) instead of picking one arbitrarily.
- If the command describes something this simulation cannot model (e.g. positioning troops on a specific border, building a discrete military base), set action to "unsupported" and put a short plain-English description of what was asked in "note".
- If you cannot understand an instruction at all, set its action to "unknown".
- Output ONLY the JSON object, nothing else.`

class AiParser implements CommandParser {
  readonly id = 'ai' as const

  isAvailable(): boolean {
    return localAiEngine.isReady()
  }

  async parse(input: string, ctx: ParseContext): Promise<ParseResult> {
    const engine = localAiEngine.getEngine()
    if (!engine) {
      return { ok: false, plan: null, confidence: 0, raw: input, error: 'Local AI model is not loaded.', clarificationQuestion: null, interpretedSummary: null }
    }
    try {
      const completion = await engine.chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: input },
        ],
        response_format: { type: 'json_object', schema: EXTRACTION_JSON_SCHEMA },
        temperature: 0,
        max_tokens: 700,
      })
      const raw = completion.choices[0]?.message?.content ?? ''
      return groundExtraction(raw, input, ctx)
    } catch (err) {
      console.error('AI parse failed', err)
      return { ok: false, plan: null, confidence: 0, raw: input, error: 'The local AI model failed to interpret that command.', clarificationQuestion: null, interpretedSummary: null }
    }
  }
}

function resolveTarget(step: AiStep, ctx: ParseContext, index: ReturnType<typeof buildResolverIndex>): ResolveResult | null {
  if (step.targetName === null) {
    if (ctx.selectedRegionId && (step.action === 'annex' || step.action === 'cede_territory' || step.action === 'grant_independence')) {
      return { id: ctx.selectedRegionId, kind: 'region', confidence: 1, ambiguous: false, alternatives: [] }
    }
    if (ctx.lastEntityId) return { id: ctx.lastEntityId, kind: 'entity', confidence: 0.7, ambiguous: false, alternatives: [] }
    if (ctx.lastRegionId) return { id: ctx.lastRegionId, kind: 'region', confidence: 0.7, ambiguous: false, alternatives: [] }
    return null
  }
  const isTerritorial = step.action === 'annex' || step.action === 'cede_territory' || step.action === 'grant_independence'
  return isTerritorial ? resolveRegionOrOrganizationOrEntity(step.targetName, index) : resolveEntity(step.targetName, index)
}

function groundExtraction(rawJson: string, originalInput: string, ctx: ParseContext): ParseResult {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(rawJson)
  } catch {
    return { ok: false, plan: null, confidence: 0, raw: originalInput, error: 'The model did not return valid JSON.', clarificationQuestion: null, interpretedSummary: null }
  }
  const extraction = AiExtraction.safeParse(parsedJson)
  if (!extraction.success) {
    return { ok: false, plan: null, confidence: 0, raw: originalInput, error: 'The model returned an unexpected shape.', clarificationQuestion: null, interpretedSummary: null }
  }
  const data = extraction.data
  if (data.steps.length === 0) {
    return { ok: false, plan: null, confidence: 0.2, raw: originalInput, error: 'The AI could not understand that command.', clarificationQuestion: null, interpretedSummary: null }
  }

  const index = buildResolverIndex(ctx.worldState)
  const steps: StructuredAction[] = []
  let ungroundedCount = 0
  let unknownCount = 0
  let fuzzyCount = 0
  let clarificationQuestion: string | null = null
  const inputHasNegationCue = NEGATION_CUE_RE.test(originalInput)

  for (const step of data.steps) {
    if (step.action === 'unknown') {
      unknownCount += 1
      continue
    }

    if (step.negated && !inputHasNegationCue) step.negated = false
    if (step.targetName && !mentionedInInput(originalInput, step.targetName)) step.targetName = null
    if (step.organizationName && !mentionedInInput(originalInput, step.organizationName)) step.organizationName = null

    if (step.negated) {
      steps.push(
        StructuredAction.parse({
          actor: ctx.playerEntityId,
          action: 'unsupported',
          target: null,
          organization: null,
          treatyType: null,
          quantity: null,
          unit: null,
          percent: null,
          note: `Understood -- not going to ${step.action.replace(/_/g, ' ')}${step.targetName ? ` (${step.targetName})` : ''}.`,
        }),
      )
      continue
    }

    let target: string | null = null
    if (step.targetName !== null || step.action === 'annex' || step.action === 'cede_territory' || step.action === 'grant_independence' || step.action === 'declare_war' || step.action === 'sanction') {
      const resolved = resolveTarget(step, ctx, index)
      if (resolved?.ambiguous) {
        clarificationQuestion = `I found more than one possible match -- did you mean ${resolved.alternatives.map((n) => `"${n}"`).join(' or ')}?`
      } else if (resolved?.id) {
        target = resolved.id
        if (resolved.confidence < 1) fuzzyCount += 1
      } else if (step.targetName) {
        ungroundedCount += 1
      }
    }

    let organization: string | null = null
    if (step.organizationName) {
      const resolved = step.action === 'cede_territory' ? resolveEntity(step.organizationName, index) : resolveOrganization(step.organizationName, index)
      if (resolved.ambiguous) {
        clarificationQuestion = `I found more than one possible match -- did you mean ${resolved.alternatives.map((n) => `"${n}"`).join(' or ')}?`
      } else if (resolved.id) {
        organization = resolved.id
        if (resolved.confidence < 1) fuzzyCount += 1
      } else {
        ungroundedCount += 1
      }
    }

    steps.push(
      StructuredAction.parse({
        actor: ctx.playerEntityId,
        action: step.action,
        target,
        organization,
        treatyType: step.treatyType,
        quantity: step.quantity,
        unit: step.unit,
        percent: step.percent,
        note: step.note,
      }),
    )
  }

  if (clarificationQuestion) {
    return { ok: false, plan: null, confidence: 0.3, raw: originalInput, error: clarificationQuestion, clarificationQuestion, interpretedSummary: null }
  }

  if (steps.length === 0) {
    return { ok: false, plan: null, confidence: 0.2, raw: originalInput, error: 'The AI could not understand that command.', clarificationQuestion: null, interpretedSummary: null }
  }

  const plan: StructuredPlan = { steps }
  const grounded = ungroundedCount === 0
  const confidence = !grounded ? 0.4 : unknownCount > 0 ? 0.6 : fuzzyCount > 0 ? 0.65 : 0.85
  return {
    ok: true,
    plan,
    confidence,
    raw: originalInput,
    error: grounded ? null : 'Could not identify one or more names in that command -- part of the action may target the wrong thing.',
    clarificationQuestion: null,
    interpretedSummary: null,
  }
}

export const aiParser = new AiParser()
