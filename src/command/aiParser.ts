import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { MLCEngine, InitProgressReport } from '@mlc-ai/web-llm'
import { ActionType, TreatyKind, UnitType, StructuredAction, type ParseResult } from '@/domain/schemas'
import type { CommandParser, ParseContext } from './types'
import { buildResolverIndex, resolveEntity, resolveOrganization, resolveRegionOrOrganizationOrEntity } from './entityResolver'

export const AI_MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'

/** What we ask the small local model to extract. Names are free text --
 *  grounding them into real entity/region/organization ids is done afterward
 *  by the same deterministic resolver the fallback parser uses. This keeps
 *  the model's job small (intent + names) instead of requiring it to know
 *  hundreds of ISO codes, which a 0.5B model can't reliably memorize. */
const AiExtraction = z.object({
  action: ActionType,
  targetName: z.string().nullable().describe('Country, region, or place name the action targets, in plain text'),
  secondaryAction: ActionType.nullable(),
  organizationName: z.string().nullable().describe('Name of a non-state organization, if mentioned'),
  treatyType: TreatyKind.nullable(),
  quantity: z.number().nullable(),
  unit: UnitType.nullable(),
  percent: z.number().nullable(),
})
type AiExtraction = z.infer<typeof AiExtraction>

const EXTRACTION_JSON_SCHEMA = JSON.stringify(zodToJsonSchema(AiExtraction, 'AiExtraction'))

const SYSTEM_PROMPT = `You are a command interpreter for a geopolitical strategy game. The player issues a natural-language command as the leader of one country. Convert it into a single JSON object matching this schema:

${EXTRACTION_JSON_SCHEMA}

Rules:
- action must be one of: declare_war, propose_peace, annex, mobilize, set_military_spending, sign_treaty, form_alliance, break_alliance, build_units, dissolve_organization, sanction, lift_sanction, end_turn, unknown.
- targetName is the plain-text name of the country, region, or place being acted on (e.g. "Iran", "Gaza", "France"). Use null if there is none.
- If the command has a second clause like "and dissolve X", set secondaryAction to "dissolve_organization" and organizationName to X's name.
- quantity/unit are used for mobilize and build_units (unit is one of troops, tanks, aircraft, ships, artillery).
- percent is used for set_military_spending.
- If you cannot understand the command at all, set action to "unknown".
- Output ONLY the JSON object, nothing else.`

export type AiEngineStatus = 'unloaded' | 'loading' | 'ready' | 'unavailable' | 'error'

type StatusListener = (status: AiEngineStatus, report?: InitProgressReport) => void

class AiParser implements CommandParser {
  readonly id = 'ai' as const
  private engine: MLCEngine | null = null
  private status: AiEngineStatus = 'unloaded'
  private listeners = new Set<StatusListener>()
  private loadPromise: Promise<void> | null = null

  supportsWebGpu(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator
  }

  isAvailable(): boolean {
    return this.status === 'ready' && this.engine !== null
  }

  getStatus(): AiEngineStatus {
    return this.status
  }

  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setStatus(status: AiEngineStatus, report?: InitProgressReport) {
    this.status = status
    for (const listener of this.listeners) listener(status, report)
  }

  /** Explicitly triggered by the UI (e.g. a settings toggle), never on the
   *  hot path of parsing a command -- first load downloads ~1GB. */
  async initialize(): Promise<void> {
    if (this.status === 'ready') return
    if (this.loadPromise) return this.loadPromise
    if (!this.supportsWebGpu()) {
      this.setStatus('unavailable')
      return
    }
    this.setStatus('loading')
    this.loadPromise = (async () => {
      try {
        const webllm = await import('@mlc-ai/web-llm')
        this.engine = await webllm.CreateMLCEngine(AI_MODEL_ID, {
          initProgressCallback: (report) => this.setStatus('loading', report),
        })
        this.setStatus('ready')
      } catch (err) {
        console.error('Local AI model failed to load', err)
        this.setStatus('error')
        this.engine = null
      } finally {
        this.loadPromise = null
      }
    })()
    return this.loadPromise
  }

  unload(): void {
    this.engine = null
    this.setStatus(this.supportsWebGpu() ? 'unloaded' : 'unavailable')
  }

  async parse(input: string, ctx: ParseContext): Promise<ParseResult> {
    if (!this.engine) {
      return { ok: false, action: null, confidence: 0, raw: input, error: 'Local AI model is not loaded.' }
    }
    try {
      const completion = await this.engine.chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: input },
        ],
        response_format: { type: 'json_object', schema: EXTRACTION_JSON_SCHEMA },
        temperature: 0,
        max_tokens: 300,
      })
      const raw = completion.choices[0]?.message?.content ?? ''
      return groundExtraction(raw, input, ctx)
    } catch (err) {
      console.error('AI parse failed', err)
      return { ok: false, action: null, confidence: 0, raw: input, error: 'The local AI model failed to interpret that command.' }
    }
  }
}

function groundExtraction(rawJson: string, originalInput: string, ctx: ParseContext): ParseResult {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(rawJson)
  } catch {
    return { ok: false, action: null, confidence: 0, raw: originalInput, error: 'The model did not return valid JSON.' }
  }
  const extraction = AiExtraction.safeParse(parsedJson)
  if (!extraction.success) {
    return { ok: false, action: null, confidence: 0, raw: originalInput, error: 'The model returned an unexpected shape.' }
  }
  const data: AiExtraction = extraction.data
  if (data.action === 'unknown') {
    return { ok: false, action: null, confidence: 0.2, raw: originalInput, error: 'The AI could not understand that command.' }
  }

  const index = buildResolverIndex(ctx.worldState)
  const target = data.targetName
    ? data.action === 'annex'
      ? (resolveRegionOrOrganizationOrEntity(data.targetName, index)?.id ?? null)
      : resolveEntity(data.targetName, index)
    : null
  const organization = data.organizationName ? resolveOrganization(data.organizationName, index) : null

  const action = StructuredAction.parse({
    actor: ctx.playerEntityId,
    action: data.action,
    target,
    secondaryAction: data.secondaryAction,
    organization,
    treatyType: data.treatyType,
    quantity: data.quantity,
    unit: data.unit,
    percent: data.percent,
  })

  const grounded = (data.targetName === null || target !== null) && (data.organizationName === null || organization !== null)
  return {
    ok: true,
    action,
    confidence: grounded ? 0.75 : 0.4,
    raw: originalInput,
    error: grounded ? null : `Could not identify "${data.targetName ?? data.organizationName}" -- the action may target the wrong thing.`,
  }
}

export const aiParser = new AiParser()
