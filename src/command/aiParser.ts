import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { ActionType, TreatyKind, UnitType, StructuredAction, type ParseResult, type StructuredPlan } from '@/domain/schemas'
import type { CommandParser, ParseContext } from './types'
import { buildResolverIndex, resolveEntity, resolveOrganization, resolveRegionOrOrganizationOrEntity } from './entityResolver'
import { localAiEngine } from '@/ai/localAiEngine'

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
  note: z.string().nullable().describe('For "unsupported": a short plain-English description of what the player actually asked for'),
})
type AiStep = z.infer<typeof AiStep>

const AiExtraction = z.object({
  steps: z.array(AiStep).max(8).describe('One entry per distinct instruction in the command, in order'),
})
type AiExtraction = z.infer<typeof AiExtraction>

const EXTRACTION_JSON_SCHEMA = JSON.stringify(zodToJsonSchema(AiExtraction, 'AiExtraction'))

const ACTION_LIST = ActionType.options.join(', ')

const SYSTEM_PROMPT = `You are a command interpreter for a geopolitical strategy game. The player issues a natural-language command as the leader of one country, possibly a compound command with several instructions in one sentence. Convert it into a JSON object matching this schema:

${EXTRACTION_JSON_SCHEMA}

Rules:
- Produce one entry in "steps" per distinct instruction, in the order given. A simple command produces exactly one step.
- action must be one of: ${ACTION_LIST}.
- Recognize synonyms: "invade"/"attack"/"launch an offensive against"/"begin military operations against" all mean declare_war. "make peace"/"end the war"/"negotiate peace" mean propose_peace. "capture"/"seize" mean annex. "release"/"liberate" mean grant_independence.
- targetName is the plain-text name of the country, region, or place being acted on (e.g. "Iran", "Gaza", "France"). If the player says "this region" or "here", set targetName to null and leave it to be resolved from the current map selection. Use null if there is no target.
- organizationName is the name of a non-state organization for dissolve_organization/recognize actions, OR the recipient country's name for cede_territory. Use null otherwise.
- quantity/unit are used for mobilize, demobilize, and build_units (unit is one of troops, tanks, aircraft, ships, artillery).
- percent is used for set_military_spending, set_readiness, and set_tax_rate. If the player says "by N percent" (a relative change) rather than "to N percent" (absolute), you do not know the current value -- still extract N into percent and rely on the game to interpret it.
- If the command describes something this simulation cannot model (e.g. positioning troops on a specific border, building a discrete military base, hypothetical "what if" questions), set action to "unsupported" and put a short plain-English description of what was asked in "note".
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
      return { ok: false, plan: null, confidence: 0, raw: input, error: 'Local AI model is not loaded.' }
    }
    try {
      const completion = await engine.chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: input },
        ],
        response_format: { type: 'json_object', schema: EXTRACTION_JSON_SCHEMA },
        temperature: 0,
        max_tokens: 600,
      })
      const raw = completion.choices[0]?.message?.content ?? ''
      return groundExtraction(raw, input, ctx)
    } catch (err) {
      console.error('AI parse failed', err)
      return { ok: false, plan: null, confidence: 0, raw: input, error: 'The local AI model failed to interpret that command.' }
    }
  }
}

function groundExtraction(rawJson: string, originalInput: string, ctx: ParseContext): ParseResult {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(rawJson)
  } catch {
    return { ok: false, plan: null, confidence: 0, raw: originalInput, error: 'The model did not return valid JSON.' }
  }
  const extraction = AiExtraction.safeParse(parsedJson)
  if (!extraction.success) {
    return { ok: false, plan: null, confidence: 0, raw: originalInput, error: 'The model returned an unexpected shape.' }
  }
  const data = extraction.data
  if (data.steps.length === 0) {
    return { ok: false, plan: null, confidence: 0.2, raw: originalInput, error: 'The AI could not understand that command.' }
  }

  const index = buildResolverIndex(ctx.worldState)
  const steps: StructuredAction[] = []
  let ungroundedCount = 0
  let unknownCount = 0

  for (const step of data.steps) {
    if (step.action === 'unknown') {
      unknownCount += 1
      continue
    }

    let target: string | null = null
    if (step.targetName === null && ctx.selectedRegionId && (step.action === 'annex' || step.action === 'cede_territory' || step.action === 'grant_independence')) {
      target = ctx.selectedRegionId
    } else if (step.targetName) {
      target =
        step.action === 'annex' || step.action === 'cede_territory' || step.action === 'grant_independence'
          ? (resolveRegionOrOrganizationOrEntity(step.targetName, index)?.id ?? null)
          : resolveEntity(step.targetName, index)
      if (target === null) ungroundedCount += 1
    }

    let organization: string | null = null
    if (step.organizationName) {
      organization = step.action === 'cede_territory' ? resolveEntity(step.organizationName, index) : resolveOrganization(step.organizationName, index)
      if (organization === null) ungroundedCount += 1
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

  if (steps.length === 0) {
    return { ok: false, plan: null, confidence: 0.2, raw: originalInput, error: 'The AI could not understand that command.' }
  }

  const plan: StructuredPlan = { steps }
  const grounded = ungroundedCount === 0
  return {
    ok: true,
    plan,
    confidence: grounded ? (unknownCount > 0 ? 0.6 : 0.75) : 0.4,
    raw: originalInput,
    error: grounded ? null : 'Could not identify one or more names in that command -- part of the action may target the wrong thing.',
  }
}

export const aiParser = new AiParser()
