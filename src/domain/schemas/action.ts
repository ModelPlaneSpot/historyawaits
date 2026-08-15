import { z } from 'zod'
import { UnitType } from './common'

export const ActionType = z.enum([
  // Military
  'declare_war',
  'propose_peace',
  'mobilize',
  'demobilize',
  'set_readiness',
  'build_units',
  'set_military_spending',
  // Territory
  'annex',
  'cede_territory',
  'grant_independence',
  // Diplomacy
  'sign_treaty',
  'form_alliance',
  'break_alliance',
  'recognize',
  'withdraw_recognition',
  'improve_relations',
  'sanction',
  'lift_sanction',
  'send_aid',
  // Economy
  'set_tax_rate',
  // Research
  'research_tech',
  // Politics / organizations
  'dissolve_organization',
  'call_election',
  // Meta
  'end_turn',
  /** Understood the player's intent (and which category it falls in) but this
   *  build doesn't simulate it -- e.g. intelligence operations, specific
   *  troop-to-border positioning, naval/air/ground operation distinctions,
   *  military bases as discrete objects. Never silently ignored; always
   *  reported honestly rather than faked. */
  'unsupported',
  'unknown',
])
export type ActionType = z.infer<typeof ActionType>

export const TreatyKind = z.enum(['defense_pact', 'trade_agreement', 'peace_treaty', 'non_aggression'])
export type TreatyKind = z.infer<typeof TreatyKind>

/**
 * One simulation-ready step. Both the local AI parser and the deterministic
 * fallback parser produce these -- neither has any function that can mutate
 * world state, this is only ever a *candidate*, checked by actionValidator
 * before anything is applied. A single player message can decompose into
 * several of these (see StructuredPlan below) for compound commands.
 */
export const StructuredAction = z.object({
  actor: z.string().describe('Entity id performing the action, usually the player entity'),
  action: ActionType,
  target: z.string().nullable().describe('Entity id or region id the action targets'),
  organization: z.string().nullable().describe('Name/id of a non-state organization, if referenced'),
  treatyType: TreatyKind.nullable(),
  quantity: z.number().nullable(),
  unit: UnitType.nullable(),
  percent: z.number().nullable(),
  note: z.string().nullable().describe('Free-text context for an "unsupported" action, e.g. what category it falls in'),
})
export type StructuredAction = z.infer<typeof StructuredAction>

/** An ordered list of steps decomposed from one player message (see spec
 *  section 8: "mobilize troops, move to the border, raise spending, sign a
 *  treaty" -> 4 steps). Executed in order; each step is independently
 *  validated, so a later step failing doesn't undo an earlier one that
 *  already succeeded. */
export const StructuredPlan = z.object({
  steps: z.array(StructuredAction).max(8),
})
export type StructuredPlan = z.infer<typeof StructuredPlan>

export const ParseResult = z.object({
  ok: z.boolean(),
  plan: StructuredPlan.nullable(),
  /** >=0.8 auto-executes, 0.5-0.8 asks the player to confirm the
   *  interpretation first, <0.5 asks a clarifying question instead of
   *  guessing (see command/types.ts ConfidenceTier). */
  confidence: z.number().min(0).max(1),
  raw: z.string(),
  error: z.string().nullable(),
  /** Set when an entity/region reference was ambiguous (e.g. two countries
   *  are both plausible fuzzy matches) -- the player should answer this
   *  directly rather than the command being retried from scratch. */
  clarificationQuestion: z.string().nullable(),
  /** Plain-English restatement of `plan`, shown for medium-confidence
   *  interpretations so the player can confirm before it executes. */
  interpretedSummary: z.string().nullable(),
})
export type ParseResult = z.infer<typeof ParseResult>
