import { produce } from 'immer'
import type { StructuredAction, WorldState } from '@/domain/schemas'
import { applySetMilitarySpending } from '../modules/economy'
import { applyBuildUnits, applyMobilize } from '../modules/military'
import {
  applyFormAlliance,
  applyBreakAlliance,
  applySignTreaty,
  applySanction,
  applyLiftSanction,
} from '../modules/diplomacy'
import { applyDeclareWar, applyProposePeace } from '../modules/war'
import { applyAnnex } from '../modules/territory'
import { applyDissolveOrganization } from '../modules/government'

export interface ValidationResult {
  ok: boolean
  state?: WorldState
  message: string
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

  const result = dispatch(state, actor.id, action, turn)
  if (!result.ok) return result

  if (action.secondaryAction === 'dissolve_organization' && action.organization) {
    const secondary = validateDissolve(result.state!, actor.id, action.organization, turn)
    if (!secondary.ok) {
      return { ok: true, state: result.state, message: `${result.message} (secondary action failed: ${secondary.message})` }
    }
    return { ok: true, state: secondary.state, message: `${result.message} ${secondary.message}` }
  }

  return result
}

function dispatch(state: WorldState, actorId: string, action: StructuredAction, turn: number): ValidationResult {
  switch (action.action) {
    case 'declare_war':
      return validateDeclareWar(state, actorId, action.target, turn)
    case 'propose_peace':
      return validateProposePeace(state, actorId, action.target, turn)
    case 'mobilize':
      return validateMobilize(state, actorId, action.quantity)
    case 'set_military_spending':
      return validateSetMilitarySpending(state, actorId, action.percent)
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
    case 'dissolve_organization':
      return validateDissolve(state, actorId, action.organization, turn)
    case 'sanction':
      return validateSanction(state, actorId, action.target)
    case 'lift_sanction':
      return validateLiftSanction(state, actorId, action.target)
    case 'end_turn':
      return { ok: true, state, message: 'Turn ended.' }
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
  if (!targetId || !state.entities[targetId]) return { ok: false, message: 'Declare war on whom? I could not identify that country.' }
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

function validateSetMilitarySpending(state: WorldState, actorId: string, percent: number | null): ValidationResult {
  if (percent === null || Number.isNaN(percent)) return { ok: false, message: 'Set military spending to what percentage?' }
  if (percent < 0 || percent > 60) return { ok: false, message: 'Military spending must be between 0% and 60% of GDP.' }
  const next = produce(state, (draft) => {
    applySetMilitarySpending(draft.entities[actorId], percent)
  })
  return { ok: true, state: next, message: `Military spending set to ${percent}% of GDP.` }
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
    const controllerIsOrganization = !controllerEntity
    const winningWar = controllerEntity ? isAtWar(state, actorId, controllerEntity.id) : false
    if (!controllerIsOrganization && !winningWar) {
      return { ok: false, message: `${controllerEntity?.name ?? region.controllerId} controls that region -- you must be at war with them to annex it.` }
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
