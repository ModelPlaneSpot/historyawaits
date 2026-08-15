import type { StructuredAction, StructuredPlan, WorldState } from '@/domain/schemas'

function nameOf(worldState: WorldState, id: string | null): string {
  if (!id) return 'an unspecified target'
  return worldState.entities[id]?.name ?? worldState.regions[id]?.name ?? worldState.organizations[id]?.name ?? id
}

const PHRASES: Record<string, (a: StructuredAction, ws: WorldState) => string> = {
  declare_war: (a, ws) => `Declare war on ${nameOf(ws, a.target)}`,
  propose_peace: (a, ws) => `Propose peace with ${nameOf(ws, a.target)}`,
  mobilize: (a) => `Mobilize ${a.quantity?.toLocaleString() ?? 'additional'} troops`,
  demobilize: (a) => `Demobilize ${a.quantity?.toLocaleString() ?? ''} troops`,
  set_readiness: (a) => `Set military readiness to ${a.percent}%`,
  build_units: (a) => `Build ${a.quantity?.toLocaleString() ?? ''} ${a.unit ?? 'units'}`,
  set_military_spending: (a) => `Set military spending to ${a.percent}% of GDP`,
  annex: (a, ws) => `Annex ${nameOf(ws, a.target)}`,
  cede_territory: (a, ws) => `Cede ${nameOf(ws, a.target)} to ${nameOf(ws, a.organization)}`,
  grant_independence: (a, ws) => `Grant independence to ${nameOf(ws, a.target)}`,
  sign_treaty: (a, ws) => `Sign a ${a.treatyType?.replace(/_/g, ' ') ?? 'treaty'} with ${nameOf(ws, a.target)}`,
  form_alliance: (a, ws) => `Form an alliance with ${nameOf(ws, a.target)}`,
  break_alliance: (a, ws) => `Break the alliance with ${nameOf(ws, a.target)}`,
  recognize: (a, ws) => `Recognize ${nameOf(ws, a.target)}`,
  withdraw_recognition: (a, ws) => `Withdraw recognition of ${nameOf(ws, a.target)}`,
  improve_relations: (a, ws) => `Improve relations with ${nameOf(ws, a.target)}`,
  sanction: (a, ws) => `Impose sanctions on ${nameOf(ws, a.target)}`,
  lift_sanction: (a, ws) => `Lift sanctions on ${nameOf(ws, a.target)}`,
  send_aid: (a, ws) => `Send aid to ${nameOf(ws, a.target)}`,
  set_tax_rate: (a) => `Set tax rate to ${a.percent}%`,
  research_tech: (a) => `Fund research${a.note ? ` into ${a.note}` : ''}`,
  dissolve_organization: (a, ws) => `Dissolve ${nameOf(ws, a.organization)}`,
  call_election: () => 'Call a snap election',
  end_turn: () => 'End the turn',
  unsupported: (a) => a.note ?? 'Acknowledge (no simulated effect)',
  unknown: () => 'Unrecognized action',
}

export function describeAction(a: StructuredAction, worldState: WorldState): string {
  const phrase = PHRASES[a.action]
  return phrase ? phrase(a, worldState) : a.action
}

export function describePlan(plan: StructuredPlan, worldState: WorldState): string {
  return plan.steps.map((s) => describeAction(s, worldState)).join('; ')
}
