import type { WorldState, WorldEntity } from '@/domain/schemas'
import { pushNews } from './news'

export function advanceGovernment(state: WorldState, entity: WorldEntity, turn: number, rng: () => number): void {
  const gov = entity.government
  const unrest = entity.population.unrest
  const economyHealth = clamp(entity.economy.growthRatePct * 5 - entity.economy.unemploymentRatePct, -30, 30)

  gov.stability = clamp(gov.stability + (60 - unrest) * 0.01 + economyHealth * 0.01, 0, 100)
  entity.population.unrest = clamp(
    entity.population.unrest + (entity.economy.unemploymentRatePct - 8) * 0.05 - (gov.stability - 50) * 0.01,
    0,
    100,
  )

  for (const party of entity.parties) {
    const isRuling = party.id === gov.rulingPartyId
    const perf = isRuling ? economyHealth - unrest * 0.2 : 0
    party.approval = clamp(party.approval + perf * 0.05 + (rng() - 0.5) * 0.4, 0, 100)
  }

  if (gov.type === 'democracy' && gov.electionDueTurn !== null && turn >= gov.electionDueTurn) {
    resolveElection(state, entity, turn)
  }

  if (gov.type === 'military_junta' || gov.type === 'authoritarian' || gov.type === 'failed_state') {
    if (gov.stability < 20 && rng() < gov.coupRisk / 1000) {
      triggerCoup(state, entity, turn)
    }
  }
}

export function applyCallElection(state: WorldState, entity: WorldEntity, turn: number): boolean {
  if (entity.government.type !== 'democracy') return false
  resolveElection(state, entity, turn)
  return true
}

function resolveElection(state: WorldState, entity: WorldEntity, turn: number): void {
  const gov = entity.government
  const winner = [...entity.parties].sort((a, b) => b.approval - a.approval)[0]
  const changed = winner.id !== gov.rulingPartyId
  for (const party of entity.parties) party.ruling = party.id === winner.id
  gov.rulingPartyId = winner.id
  gov.electionDueTurn = turn + 208 // ~4 years, in weekly turns
  if (changed) {
    gov.stability = clamp(gov.stability + 10, 0, 100)
    pushNews(state, turn, `${winner.name} wins election in ${entity.name}`, `${winner.name} has won the general election in ${entity.name}, forming a new government.`, [entity.id], 'notable')
  }
}

function triggerCoup(state: WorldState, entity: WorldEntity, turn: number): void {
  entity.government.type = 'military_junta'
  entity.government.stability = 40
  entity.government.coupRisk = 5
  entity.government.electionDueTurn = null
  pushNews(state, turn, `Coup in ${entity.name}`, `The military has seized power in ${entity.name}.`, [entity.id], 'major')
}

export function applyDissolveOrganization(state: WorldState, organizationId: string, turn: number): boolean {
  const org = state.organizations[organizationId]
  if (!org || !org.active) return false
  org.active = false
  org.dissolvedTurn = turn
  for (const region of Object.values(state.regions)) {
    if (region.occupyingOrganizationId === organizationId) region.occupyingOrganizationId = null
  }
  pushNews(state, turn, `${org.name} dissolved`, `${org.name} has been dissolved.`, [org.hostEntityId], 'major')
  return true
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}
