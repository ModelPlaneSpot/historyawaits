import type { WorldState, WorldEntity, DisputedEntity } from '@/domain/schemas'
import { pushNews } from './news'
import { generateDistinguishableColor } from './colorGen'

export function transferRegion(state: WorldState, regionId: string, newControllerId: string): void {
  const region = state.regions[regionId]
  if (!region) return
  const oldControllerId = region.controllerId
  if (oldControllerId === newControllerId) return

  const oldController = state.entities[oldControllerId]
  if (oldController) {
    oldController.territoryRegionIds = oldController.territoryRegionIds.filter((id) => id !== regionId)
  }
  const newController = state.entities[newControllerId]
  if (newController && !newController.territoryRegionIds.includes(regionId)) {
    newController.territoryRegionIds.push(regionId)
  }
  region.controllerId = newControllerId
  region.disputed = true
}

/** Annexation outside of a war: only permitted by the validator when the
 *  target has no defended claim (see actionValidator) -- this function just
 *  performs the mechanical transfer once legality has already been checked. */
export function applyAnnex(state: WorldState, actorId: string, targetId: string, turn: number): boolean {
  const actor = state.entities[actorId]
  const targetEntity = state.entities[targetId]
  const targetRegion = state.regions[targetId]

  if (targetRegion) {
    transferRegion(state, targetId, actorId)
    pushNews(state, turn, `${actor?.name ?? actorId} annexes ${targetRegion.name}`, `${actor?.name ?? actorId} has annexed ${targetRegion.name}.`, [actorId], 'major')
    return true
  }
  if (targetEntity) {
    for (const regionId of [...targetEntity.territoryRegionIds]) {
      transferRegion(state, regionId, actorId)
    }
    pushNews(state, turn, `${actor?.name ?? actorId} annexes ${targetEntity.name}`, `${actor?.name ?? actorId} has annexed all territory of ${targetEntity.name}.`, [actorId, targetId], 'major')
    return true
  }
  return false
}

/** Peaceful transfer -- unlike applyAnnex this has already been validated to
 *  require no war, i.e. the actor is voluntarily giving up territory. */
export function applyCedeTerritory(state: WorldState, actorId: string, regionId: string, toEntityId: string, turn: number): boolean {
  const region = state.regions[regionId]
  const actor = state.entities[actorId]
  const to = state.entities[toEntityId]
  if (!region || !actor || !to || region.controllerId !== actorId) return false
  transferRegion(state, regionId, toEntityId)
  pushNews(state, turn, `${actor.name} cedes ${region.name} to ${to.name}`, `${actor.name} has ceded ${region.name} to ${to.name}.`, [actorId, toEntityId], 'notable')
  return true
}

function slugId(name: string, existing: Record<string, unknown>): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'NEWSTATE'
  let id = base
  let n = 1
  while (existing[id]) {
    id = `${base}${n}`
    n += 1
  }
  return id
}

/** Creates a brand-new self-governing entity out of one region the actor
 *  currently controls -- "grant independence" / "release" / "partition". Its
 *  stats are proportionally split from the parent by that region's
 *  population/GDP share, and it gets a fresh, permanent, collision-free map
 *  color (same policy as every other entity: generated once, never reassigned). */
export function applyGrantIndependence(state: WorldState, actorId: string, regionId: string, turn: number): string | null {
  const region = state.regions[regionId]
  const parent = state.entities[actorId]
  if (!region || !parent || region.controllerId !== actorId) return null

  const newId = slugId(region.name, state.entities)
  const usedColors = Object.values(state.entities).map((e) => e.mapColor)

  const newEntity: DisputedEntity = {
    kind: 'disputed_entity',
    id: newId,
    name: region.name,
    officialName: `Republic of ${region.name}`,
    capital: region.name,
    flagCode: parent.flagCode,
    mapColor: generateDistinguishableColor(newId, usedColors),
    latlng: parent.latlng,
    government: {
      type: 'democracy',
      headOfState: 'Interim President',
      rulingPartyId: 'party-0',
      stability: 40,
      coupRisk: 15,
      electionDueTurn: turn + 52,
    },
    parties: [
      { id: 'party-0', name: 'National Unity', ideology: { economicLeft: 50, socialLiberal: 50, nationalism: 60 }, approval: 50, seatShare: 100, ruling: true },
    ],
    economy: {
      gdpUsd: parent.economy.gdpUsd * region.gdpShare,
      gdpPerCapitaUsd: parent.economy.gdpPerCapitaUsd,
      growthRatePct: parent.economy.growthRatePct,
      treasuryUsd: parent.economy.gdpUsd * region.gdpShare * 0.02,
      debtToGdpPct: 40,
      militarySpendingPctOfGdp: parent.economy.militarySpendingPctOfGdp,
      taxRatePct: parent.economy.taxRatePct,
      unemploymentRatePct: parent.economy.unemploymentRatePct,
      inflationPct: parent.economy.inflationPct,
      tradeBalanceUsd: 0,
      resources: { ...parent.economy.resources },
    },
    military: {
      personnelActive: Math.round(parent.military.personnelActive * region.populationShare * 0.4),
      personnelReserve: Math.round(parent.military.personnelReserve * region.populationShare * 0.4),
      equipment: {
        tanks: Math.round(parent.military.equipment.tanks * region.populationShare * 0.3),
        aircraft: Math.round(parent.military.equipment.aircraft * region.populationShare * 0.2),
        ships: Math.round(parent.military.equipment.ships * region.populationShare * 0.2),
        artillery: Math.round(parent.military.equipment.artillery * region.populationShare * 0.3),
      },
      techLevel: parent.military.techLevel,
      morale: 55,
      mobilizationLevel: 10,
    },
    population: {
      total: Math.round(parent.population.total * region.populationShare),
      growthRatePct: parent.population.growthRatePct,
      urbanizationPct: parent.population.urbanizationPct,
      unrest: Math.min(100, parent.population.unrest + 15),
    },
    relations: [{ otherEntityId: actorId, opinion: -20, status: 'hostile', treatyIds: [] }],
    allianceIds: [],
    territoryRegionIds: [regionId],
    isPlayerControlled: false,
    dataConfidence: 'estimated',
    claimantIds: [actorId],
    controllerId: newId,
    recognitionCount: 0,
    status: 'self_governing',
  }

  state.entities[newId] = newEntity as WorldEntity
  parent.territoryRegionIds = parent.territoryRegionIds.filter((id) => id !== regionId)
  parent.relations.push({ otherEntityId: newId, opinion: -20, status: 'hostile', treatyIds: [] })
  region.countryId = newId
  region.controllerId = newId
  region.isCapitalRegion = true
  region.disputed = true

  pushNews(state, turn, `${region.name} declares independence from ${parent.name}`, `${parent.name} has granted independence to ${region.name}, which is now the Republic of ${region.name}.`, [actorId, newId], 'major')
  return newId
}
