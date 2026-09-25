import { produce } from 'immer'
import type { StructuredAction, StructuredPlan, WorldState } from '@/domain/schemas'
import { applySetMilitarySpending, applySetTaxRate, applyResearchTech, applySendAid } from '../modules/economy'
import { applyBuildUnits, applyMobilize, applyDemobilize, applySetReadiness } from '../modules/military'
import {
  applyFormAlliance,
  applyBreakAlliance,
  applySignTreaty,
  applySanction,
  applyLiftSanction,
  applyRecognize,
  applyWithdrawRecognition,
  applyImproveRelations,
} from '../modules/diplomacy'
import { applyDeclareWar, applyProposePeace } from '../modules/war'
import { applyAnnex, applyCedeTerritory, applyGrantIndependence } from '../modules/territory'
import { applyDissolveOrganization, applyCallElection } from '../modules/government'

export interface ValidationResult {
  ok: boolean
  state?: WorldState
  message: string
}

export interface PlanResult {
  ok: boolean
  state: WorldState
  message: string
  stepResults: ValidationResult[]
}

/**
 * Runs every step of a plan in order against the SAME evolving state -- a
 * later step sees the effects of earlier ones, and one step failing doesn't
 * undo the ones that already succeeded (see spec: compound commands like
 * "mobilize, then raise spending, then sign a treaty" should get as far as
 * they validly can, not all-or-nothing).
 */
export function validateAndApplyPlan(state: WorldState, plan: StructuredPlan, turn: number): PlanResult {
  let current = state
  const stepResults: ValidationResult[] = []
  for (const step of plan.steps) {
    const result = validateAndApply(current, step, turn)
    stepResults.push(result)
    if (result.ok && result.state) current = result.state
  }
  const message = stepResults.map((r) => r.message).join(' ')
  const ok = stepResults.some((r) => r.ok)
  return { ok, state: current, message, stepResults }
}

/**
 * The sole gate through which a StructuredAction -- produced by either the
 * local AI parser or the deterministic fallback parser -- is allowed to touch
 * world state. Neither parser is trusted; every check below runs against the
 * live worldState regardless of where the action came from.
 */
export function validateAndApply(state: WorldState, action: StructuredAction, turn: number): ValidationResult {
  const actor = state.entities[action.actor]
  if (!actor) return { ok: false, message: `Unknown actor: ${action.actor}` }
  return dispatch(state, actor.id, action, turn)
}

function dispatch(state: WorldState, actorId: string, action: StructuredAction, turn: number): ValidationResult {
  switch (action.action) {
    case 'declare_war':
      return validateDeclareWar(state, actorId, action.target, turn)
    case 'propose_peace':
      return validateProposePeace(state, actorId, action.target, turn)
    case 'mobilize':
      return validateMobilize(state, actorId, action.quantity)
    case 'demobilize':
      return validateDemobilize(state, actorId, action.quantity)
    case 'set_readiness':
      return validateSetReadiness(state, actorId, action.percent)
    case 'set_military_spending':
      return validateSetMilitarySpending(state, actorId, action.percent)
    case 'set_tax_rate':
      return validateSetTaxRate(state, actorId, action.percent)
    case 'research_tech':
      return validateResearchTech(state, actorId, action.quantity)
    case 'sign_treaty':
      return validateSignTreaty(state, actorId, action.target, action.treatyType, turn)
    case 'form_alliance':
      return validateFormAlliance(state, actorId, action.target, turn)
    case 'break_alliance':
      return validateBreakAlliance(state, actorId, action.target)
    case 'build_units':
      return validateBuildUnits(state, actorId, action.unit, action.quantity)
    case 'annex':
      return validateAnnex(state, actorId, action.target, turn)
    case 'cede_territory':
      return validateCedeTerritory(state, actorId, action.target, action.organization, turn)
    case 'grant_independence':
      return validateGrantIndependence(state, actorId, action.target, turn)
    case 'dissolve_organization':
      return validateDissolve(state, actorId, action.organization, turn)
    case 'call_election':
      return validateCallElection(state, actorId, turn)
    case 'sanction':
      return validateSanction(state, actorId, action.target)
    case 'lift_sanction':
      return validateLiftSanction(state, actorId, action.target)
    case 'recognize':
      return validateRecognize(state, actorId, action.target)
    case 'withdraw_recognition':
      return validateWithdrawRecognition(state, actorId, action.target)
    case 'improve_relations':
      return validateImproveRelations(state, actorId, action.target)
    case 'send_aid':
      return validateSendAid(state, actorId, action.target, action.quantity)
    case 'end_turn':
      return { ok: true, state, message: 'Turn ended.' }
    case 'unsupported':
      return { ok: false, message: action.note ?? "I understood what you're asking, but this simulation doesn't model that yet." }
    default:
      return { ok: false, message: "I couldn't understand what you wanted to do." }
  }
}

function isAtWar(state: WorldState, a: string, b: string): boolean {
  return Object.values(state.wars).some(
    (w) => w.active && ((w.attackerIds.includes(a) && w.defenderIds.includes(b)) || (w.attackerIds.includes(b) && w.defenderIds.includes(a))),
  )
}

function validateDeclareWar(state: WorldState, actorId: string, targetId: string | null, turn: number): ValidationResult {
  if (!targetId) return { ok: false, message: 'Declare war on whom? I could not identify that country.' }
  if (!state.entities[targetId]) {
    const org = state.organizations[targetId]
    if (org) {
      const region = state.regions[org.controlsRegionIds[0]]
      return {
        ok: false,
        message: region
          ? `${org.name} is a non-state organization, not a country -- you can't declare war on it directly. Try "annex ${region.name}" to take the territory it controls by force instead.`
          : `${org.name} is a non-state organization, not a country -- you can't declare war on it directly.`,
      }
    }
    const region = state.regions[targetId]
    if (region) {
      const controllerOrg = state.organizations[region.controllerId]
      return {
        ok: false,
        message: controllerOrg
          ? `${region.name} is controlled by ${controllerOrg.name}, a non-state organization, not a country -- try "annex ${region.name}" instead of declaring war.`
          : `${region.name} is a region, not a country -- you can't declare war on a single region. Try annexing it, or declaring war on whichever country controls it.`,
      }
    }
    return { ok: false, message: 'Declare war on whom? I could not identify that country.' }
  }
  if (targetId === actorId) return { ok: false, message: 'You cannot declare war on yourself.' }
  if (isAtWar(state, actorId, targetId)) return { ok: false, message: 'You are already at war with them.' }
  if (state.entities[actorId].military.personnelActive < 1000) {
    return { ok: false, message: 'Your military is too small to credibly declare war.' }
  }
  const next = produce(state, (draft) => {
    applyDeclareWar(draft, actorId, targetId, turn)
  })
  return { ok: true, state: next, message: `War declared on ${state.entities[targetId].name}.` }
}

function validateProposePeace(state: WorldState, actorId: string, targetId: string | null, turn: number): ValidationResult {
  const war = Object.values(state.wars).find(
    (w) => w.active && (w.attackerIds.includes(actorId) || w.defenderIds.includes(actorId)) &&
      (!targetId || w.attackerIds.includes(targetId) || w.defenderIds.includes(targetId)),
  )
  if (!war) return { ok: false, message: 'You are not currently at war with them.' }
  const opponent = war.attackerIds.includes(actorId) ? war.defenderIds[0] : war.attackerIds[0]
  const next = produce(state, (draft) => {
    applyProposePeace(draft, actorId, opponent, turn)
  })
  return { ok: true, state: next, message: `Peace proposed to ${state.entities[opponent]?.name ?? opponent}.` }
}

function validateMobilize(state: WorldState, actorId: string, quantity: number | null): ValidationResult {
  if (!quantity || quantity <= 0) return { ok: false, message: 'Mobilize how many troops?' }
  const actor = state.entities[actorId]
  const cap = actor.population.total * 0.08
  if (quantity > cap) return { ok: false, message: `Your population cannot sustain mobilizing ${quantity.toLocaleString()} troops.` }
  const next = produce(state, (draft) => {
    applyMobilize(draft.entities[actorId], quantity)
  })
  return { ok: true, state: next, message: `Mobilized ${quantity.toLocaleString()} additional troops.` }
}

function validateDemobilize(state: WorldState, actorId: string, quantity: number | null): ValidationResult {
  if (!quantity || quantity <= 0) return { ok: false, message: 'Demobilize how many troops?' }
  const next = produce(state, (draft) => {
    applyDemobilize(draft.entities[actorId], quantity)
  })
  return { ok: true, state: next, message: `Demobilized ${quantity.toLocaleString()} troops back to reserve.` }
}

function validateSetReadiness(state: WorldState, actorId: string, percent: number | null): ValidationResult {
  if (percent === null || Number.isNaN(percent)) return { ok: false, message: 'Set readiness to what level?' }
  const next = produce(state, (draft) => {
    applySetReadiness(draft.entities[actorId], percent)
  })
  return { ok: true, state: next, message: `Military readiness set to ${Math.round(percent)}%.` }
}

function validateSetMilitarySpending(state: WorldState, actorId: string, percent: number | null): ValidationResult {
  if (percent === null || Number.isNaN(percent)) return { ok: false, message: 'Set military spending to what percentage?' }
  if (percent < 0 || percent > 60) return { ok: false, message: 'Military spending must be between 0% and 60% of GDP.' }
  const next = produce(state, (draft) => {
    applySetMilitarySpending(draft.entities[actorId], percent)
  })
  return { ok: true, state: next, message: `Military spending set to ${percent}% of GDP.` }
}

function validateSetTaxRate(state: WorldState, actorId: string, percent: number | null): ValidationResult {
  if (percent === null || Number.isNaN(percent)) return { ok: false, message: 'Set the tax rate to what percentage?' }
  if (percent < 0 || percent > 80) return { ok: false, message: 'Tax rate must be between 0% and 80%.' }
  const next = produce(state, (draft) => {
    applySetTaxRate(draft.entities[actorId], percent)
  })
  return { ok: true, state: next, message: `Tax rate set to ${percent}%.` }
}

function validateResearchTech(state: WorldState, actorId: string, budgetUsd: number | null): ValidationResult {
  const budget = budgetUsd && budgetUsd > 0 ? budgetUsd : state.entities[actorId].economy.gdpUsd * 0.01
  let ok = false
  const next = produce(state, (draft) => {
    ok = applyResearchTech(draft.entities[actorId], budget)
  })
  if (!ok) return { ok: false, message: 'Insufficient treasury to fund a research program.' }
  return { ok: true, state: next, message: `Research funded -- military technology is advancing.` }
}

function validateSignTreaty(
  state: WorldState,
  actorId: string,
  targetId: string | null,
  treatyType: StructuredAction['treatyType'],
  turn: number,
): ValidationResult {
  if (!targetId || !state.entities[targetId]) return { ok: false, message: 'Sign a treaty with whom? I could not identify that country.' }
  if (targetId === actorId) return { ok: false, message: 'You cannot sign a treaty with yourself.' }
  if (treatyType !== 'peace_treaty' && isAtWar(state, actorId, targetId)) {
    return { ok: false, message: 'You are at war with them -- propose peace first.' }
  }
  const next = produce(state, (draft) => {
    applySignTreaty(draft, actorId, targetId, treatyType ?? 'non_aggression', turn)
  })
  return { ok: true, state: next, message: `Treaty signed with ${state.entities[targetId].name}.` }
}

function validateFormAlliance(state: WorldState, actorId: string, targetId: string | null, turn: number): ValidationResult {
  if (!targetId || !state.entities[targetId]) return { ok: false, message: 'Form an alliance with whom? I could not identify that country.' }
  if (targetId === actorId) return { ok: false, message: 'You cannot ally with yourself.' }
  if (isAtWar(state, actorId, targetId)) return { ok: false, message: 'You are at war with them.' }
  const next = produce(state, (draft) => {
    applyFormAlliance(draft, actorId, targetId, turn)
  })
  return { ok: true, state: next, message: `Alliance formed with ${state.entities[targetId].name}.` }
}

function validateBreakAlliance(state: WorldState, actorId: string, targetId: string | null): ValidationResult {
  if (!targetId || !state.entities[targetId]) return { ok: false, message: 'Break the alliance with whom?' }
  const actor = state.entities[actorId]
  const allied = actor.allianceIds.some((tid) => state.treaties[tid]?.memberIds.includes(targetId))
  if (!allied) return { ok: false, message: 'You are not allied with them.' }
  const next = produce(state, (draft) => {
    applyBreakAlliance(draft, actorId, targetId)
  })
  return { ok: true, state: next, message: `Alliance with ${state.entities[targetId].name} broken.` }
}

function validateBuildUnits(state: WorldState, actorId: string, unit: StructuredAction['unit'], quantity: number | null): ValidationResult {
  if (!unit) return { ok: false, message: 'Build what -- troops, tanks, aircraft, ships, or artillery?' }
  if (!quantity || quantity <= 0) return { ok: false, message: 'Build how many?' }
  let built = false
  const next = produce(state, (draft) => {
    built = applyBuildUnits(draft.entities[actorId], unit, quantity)
  })
  if (!built) return { ok: false, message: `Insufficient treasury to build ${quantity.toLocaleString()} ${unit}.` }
  return { ok: true, state: next, message: `Built ${quantity.toLocaleString()} ${unit}.` }
}

function validateAnnex(state: WorldState, actorId: string, targetId: string | null, turn: number): ValidationResult {
  if (!targetId) return { ok: false, message: 'Annex what? I could not identify that region or country.' }
  const actor = state.entities[actorId]
  if (actor.military.personnelActive < 1000) return { ok: false, message: 'Your military is too small to annex territory.' }

  const region = state.regions[targetId]
  if (region) {
    if (region.controllerId === actorId) return { ok: false, message: 'You already control that region.' }
    const controllerEntity = state.entities[region.controllerId]
    // A region held by a non-state organization is still, legally, part of
    // that organization's host country -- taking it by force still requires
    // being at war with that host, same as annexing any other region (you
    // can't declare war on the organization itself; see validateDeclareWar).
    const controllerOrg = state.organizations[region.controllerId]
    const warTarget = controllerEntity?.id ?? controllerOrg?.hostEntityId
    const winningWar = warTarget ? isAtWar(state, actorId, warTarget) : false
    if (warTarget && !winningWar) {
      const controllerName = controllerEntity?.name ?? controllerOrg?.name ?? region.controllerId
      const hostName = controllerOrg ? (state.entities[controllerOrg.hostEntityId]?.name ?? controllerOrg.hostEntityId) : null
      return {
        ok: false,
        message: hostName
          ? `${controllerName} controls that region, as part of ${hostName} -- you must be at war with ${hostName} to annex it.`
          : `${controllerName} controls that region -- you must be at war with them to annex it.`,
      }
    }
    const next = produce(state, (draft) => {
      applyAnnex(draft, actorId, targetId, turn)
    })
    return { ok: true, state: next, message: `${region.name} annexed.` }
  }

  const targetEntity = state.entities[targetId]
  if (targetEntity) {
    if (targetEntity.id === actorId) return { ok: false, message: 'You cannot annex yourself.' }
    const war = Object.values(state.wars).find(
      (w) => w.active && w.attackerIds.includes(actorId) && w.defenderIds.includes(targetEntity.id),
    )
    if (!war || war.warScore < 50) {
      return { ok: false, message: `You must be decisively winning a war against ${targetEntity.name} to annex it outright.` }
    }
    const next = produce(state, (draft) => {
      applyAnnex(draft, actorId, targetEntity.id, turn)
    })
    return { ok: true, state: next, message: `${targetEntity.name} annexed.` }
  }

  return { ok: false, message: 'That is not a region, organization, or country I recognize.' }
}

function validateCedeTerritory(state: WorldState, actorId: string, targetId: string | null, toId: string | null, turn: number): ValidationResult {
  if (!targetId || !state.regions[targetId]) return { ok: false, message: 'Cede which region? I could not identify it.' }
  const recipientId = toId && state.entities[toId] ? toId : null
  if (!recipientId) return { ok: false, message: 'Cede that region to whom?' }
  const region = state.regions[targetId]
  if (region.controllerId !== actorId) return { ok: false, message: 'You do not control that region.' }
  let ok = false
  const next = produce(state, (draft) => {
    ok = applyCedeTerritory(draft, actorId, targetId, recipientId, turn)
  })
  if (!ok) return { ok: false, message: 'That territory transfer could not be completed.' }
  return { ok: true, state: next, message: `${region.name} ceded to ${state.entities[recipientId].name}.` }
}

function validateGrantIndependence(state: WorldState, actorId: string, targetId: string | null, turn: number): ValidationResult {
  if (!targetId || !state.regions[targetId]) return { ok: false, message: 'Grant independence to which region? I could not identify it.' }
  const region = state.regions[targetId]
  if (region.controllerId !== actorId) return { ok: false, message: 'You do not control that region.' }
  let newId: string | null = null
  const next = produce(state, (draft) => {
    newId = applyGrantIndependence(draft, actorId, targetId, turn)
  })
  if (!newId) return { ok: false, message: 'Independence could not be granted for that region.' }
  return { ok: true, state: next, message: `${region.name} is now independent as the Republic of ${region.name}.` }
}

function validateDissolve(state: WorldState, actorId: string, organizationId: string | null, turn: number): ValidationResult {
  if (!organizationId || !state.organizations[organizationId]) {
    return { ok: false, message: 'Dissolve which organization? I could not identify that group.' }
  }
  const org = state.organizations[organizationId]
  if (!org.active) return { ok: false, message: `${org.name} has already been dissolved.` }
  const controlsHostTerritory = org.hostEntityId === actorId
  const controlsOccupiedRegion = org.controlsRegionIds.some((rid) => state.regions[rid]?.controllerId === actorId)
  if (!controlsHostTerritory && !controlsOccupiedRegion) {
    return { ok: false, message: `You have no forces in position to dissolve ${org.name}.` }
  }
  const next = produce(state, (draft) => {
    applyDissolveOrganization(draft, organizationId, turn)
  })
  return { ok: true, state: next, message: `${org.name} dissolved.` }
}

function validateCallElection(state: WorldState, actorId: string, turn: number): ValidationResult {
  let ok = false
  const next = produce(state, (draft) => {
    ok = applyCallElection(draft, draft.entities[actorId], turn)
  })
  if (!ok) return { ok: false, message: 'Elections can only be called in a democracy.' }
  return { ok: true, state: next, message: 'A snap election has been held.' }
}

function validateSanction(state: WorldState, actorId: string, targetId: string | null): ValidationResult {
  if (!targetId || !state.entities[targetId]) return { ok: false, message: 'Sanction whom?' }
  const next = produce(state, (draft) => {
    applySanction(draft, actorId, targetId)
  })
  return { ok: true, state: next, message: `Sanctions imposed on ${state.entities[targetId].name}.` }
}

function validateLiftSanction(state: WorldState, actorId: string, targetId: string | null): ValidationResult {
  if (!targetId || !state.entities[targetId]) return { ok: false, message: 'Lift sanctions on whom?' }
  const next = produce(state, (draft) => {
    applyLiftSanction(draft, actorId, targetId)
  })
  return { ok: true, state: next, message: `Sanctions lifted on ${state.entities[targetId].name}.` }
}

function validateRecognize(state: WorldState, actorId: string, targetId: string | null): ValidationResult {
  if (!targetId || !state.entities[targetId]) return { ok: false, message: 'Recognize whom?' }
  const next = produce(state, (draft) => {
    applyRecognize(draft, actorId, targetId)
  })
  return { ok: true, state: next, message: `${state.entities[targetId].name} formally recognized.` }
}

function validateWithdrawRecognition(state: WorldState, actorId: string, targetId: string | null): ValidationResult {
  if (!targetId || !state.entities[targetId]) return { ok: false, message: 'Withdraw recognition from whom?' }
  const next = produce(state, (draft) => {
    applyWithdrawRecognition(draft, actorId, targetId)
  })
  return { ok: true, state: next, message: `Recognition of ${state.entities[targetId].name} withdrawn.` }
}

function validateImproveRelations(state: WorldState, actorId: string, targetId: string | null): ValidationResult {
  if (!targetId || !state.entities[targetId]) return { ok: false, message: 'Improve relations with whom?' }
  if (targetId === actorId) return { ok: false, message: 'You cannot improve relations with yourself.' }
  if (isAtWar(state, actorId, targetId)) return { ok: false, message: 'You are at war with them -- propose peace first.' }
  const next = produce(state, (draft) => {
    applyImproveRelations(draft, actorId, targetId)
  })
  return { ok: true, state: next, message: `Diplomatic relations with ${state.entities[targetId].name} have improved.` }
}

function validateSendAid(state: WorldState, actorId: string, targetId: string | null, amount: number | null): ValidationResult {
  if (!targetId || !state.entities[targetId]) return { ok: false, message: 'Send aid to whom?' }
  const amountUsd = amount && amount > 0 ? amount : state.entities[actorId].economy.gdpUsd * 0.001
  let ok = false
  const next = produce(state, (draft) => {
    ok = applySendAid(draft.entities[actorId], draft.entities[targetId], amountUsd)
  })
  if (!ok) return { ok: false, message: 'Insufficient treasury to send that aid.' }
  return { ok: true, state: next, message: `Aid sent to ${state.entities[targetId].name}.` }
}
