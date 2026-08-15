import { z } from 'zod'
import { UnitType } from './common'

export const ActionType = z.enum([
  'declare_war',
  'propose_peace',
  'annex',
  'mobilize',
  'set_military_spending',
  'sign_treaty',
  'form_alliance',
  'break_alliance',
  'build_units',
  'dissolve_organization',
  'sanction',
  'lift_sanction',
  'end_turn',
  'unknown',
])
export type ActionType = z.infer<typeof ActionType>

export const TreatyKind = z.enum(['defense_pact', 'trade_agreement', 'peace_treaty', 'non_aggression'])
export type TreatyKind = z.infer<typeof TreatyKind>

/**
 * The single contract both the local AI parser and the deterministic fallback
 * parser must produce. Neither parser (nor the AI) has any function that can
 * mutate world state -- this is only ever a *candidate* action, checked by
 * actionValidator before anything is applied.
 */
export const StructuredAction = z.object({
  actor: z.string().describe('Entity id performing the action, usually the player entity'),
  action: ActionType,
  target: z.string().nullable().describe('Entity id or region id the action targets'),
  secondaryAction: ActionType.nullable(),
  organization: z.string().nullable().describe('Name/id of a non-state organization, if referenced'),
  treatyType: TreatyKind.nullable(),
  quantity: z.number().nullable(),
  unit: UnitType.nullable(),
  percent: z.number().nullable(),
})
export type StructuredAction = z.infer<typeof StructuredAction>

export const ParseResult = z.object({
  ok: z.boolean(),
  action: StructuredAction.nullable(),
  confidence: z.number().min(0).max(1),
  raw: z.string(),
  error: z.string().nullable(),
})
export type ParseResult = z.infer<typeof ParseResult>
