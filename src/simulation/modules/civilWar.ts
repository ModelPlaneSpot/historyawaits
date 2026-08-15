import type { WorldState, WorldEntity, DisputedEntity } from '@/domain/schemas'
import { transferRegion } from './territory'
import { generateDistinguishableColor } from './colorGen'
import { createStory } from './story'
import { buildCivilWarNarrative } from './storyTemplates'

const STABILITY_THRESHOLD = 15
const MIN_REGIONS_FOR_CIVIL_WAR = 2

function alreadyInCivilWar(state: WorldState, entityId: string): boolean {
  return Object.values(state.wars).some(
    (w) => w.active && w.isCivilWar && (w.attackerIds.includes(entityId) || w.defenderIds.includes(entityId)),
  )
}

/** Fires from very low government stability -- extreme unrest, a collapsing
 *  economy, repression, or a failed coup all funnel into this same low-
 *  stability signal rather than each needing its own bespoke trigger. */
export function considerCivilWar(state: WorldState, entity: WorldEntity, turn: number, rng: () => number): void {
  if (entity.government.stability >= STABILITY_THRESHOLD) return
  if (entity.government.type === 'failed_state') return // already collapsed; nothing left to fragment
  if (entity.territoryRegionIds.length < MIN_REGIONS_FOR_CIVIL_WAR) return
  if (alreadyInCivilWar(state, entity.id)) return

  const risk = (STABILITY_THRESHOLD - entity.government.stability) / STABILITY_THRESHOLD // 0..1
  if (rng() >= risk * 0.05) return

  startCivilWar(state, entity, turn, rng)
}

function startCivilWar(state: WorldState, parent: WorldEntity, turn: number, rng: () => number): void {
  const regions = parent.territoryRegionIds
    .map((id) => state.regions[id])
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => b.unrest - a.unrest)

  const rebelShare = 0.2 + rng() * 0.2 // 20-40% of territory starts under rebel control
  const rebelCount = Math.max(1, Math.round(regions.length * rebelShare))
  const rebelRegions = regions.slice(0, rebelCount)
  const contestedExtra = regions.slice(rebelCount, rebelCount + Math.min(3, regions.length - rebelCount))
  const contestedRegionIds = [...rebelRegions, ...contestedExtra].map((r) => r.id)

  const rebelId = `REBEL-${parent.id}-${turn}`
  const usedColors = Object.values(state.entities).map((e) => e.mapColor)
  const rebelPopulation = rebelRegions.reduce((sum, r) => sum + Math.round(parent.population.total * r.populationShare), 0)

  const rebelEntity: DisputedEntity = {
    kind: 'disputed_entity',
    id: rebelId,
    name: `${parent.name} Rebels`,
    officialName: `Provisional Government of ${parent.name}`,
    capital: rebelRegions[0]?.name ?? parent.capital,
    flagCode: parent.flagCode,
    mapColor: generateDistinguishableColor(rebelId, usedColors),
    latlng: parent.latlng,
    government: {
      type: 'military_junta',
      headOfState: 'Rebel Commander',
      rulingPartyId: 'party-0',
      stability: 35,
      coupRisk: 10,
      electionDueTurn: null,
    },
    parties: [
      { id: 'party-0', name: 'Revolutionary Front', ideology: { economicLeft: 60, socialLiberal: 40, nationalism: 70 }, approval: 60, seatShare: 100, ruling: true },
    ],
    economy: {
      ...parent.economy,
      gdpUsd: parent.economy.gdpUsd * 0.1,
      treasuryUsd: parent.economy.treasuryUsd * 0.05,
    },
    military: {
      personnelActive: Math.round(parent.military.personnelActive * 0.15),
      personnelReserve: Math.round(parent.military.personnelReserve * 0.1),
      equipment: {
        tanks: Math.round(parent.military.equipment.tanks * 0.05),
        aircraft: 0,
        ships: 0,
        artillery: Math.round(parent.military.equipment.artillery * 0.1),
      },
      techLevel: Math.max(10, parent.military.techLevel * 0.5),
      morale: 60,
      mobilizationLevel: 40,
    },
    population: {
      total: rebelPopulation,
      growthRatePct: parent.population.growthRatePct,
      urbanizationPct: parent.population.urbanizationPct,
      unrest: 70,
    },
    relations: [{ otherEntityId: parent.id, opinion: -80, status: 'war', treatyIds: [] }],
    allianceIds: [],
    territoryRegionIds: rebelRegions.map((r) => r.id),
    isPlayerControlled: false,
    dataConfidence: 'estimated',
    claimantIds: [parent.id],
    controllerId: rebelId,
    recognitionCount: 0,
    status: 'contested',
  }

  state.entities[rebelId] = rebelEntity as WorldEntity
  parent.relations.push({ otherEntityId: rebelId, opinion: -80, status: 'war', treatyIds: [] })

  for (const region of rebelRegions) {
    transferRegion(state, region.id, rebelId)
  }

  parent.government.stability = Math.max(0, parent.government.stability - 10)

  const title = `CIVIL WAR ERUPTS IN ${parent.name.toUpperCase()}`
  const headline = `Civil War Erupts in ${parent.name}`
  const body = `Rebel forces have seized control of ${rebelRegions.length} region${rebelRegions.length === 1 ? '' : 's'} in ${parent.name} following a collapse in government stability.`
  const narrative = buildCivilWarNarrative(parent, rebelEntity as WorldEntity, rebelRegions.length / Math.max(1, regions.length))
  const storyId = createStory(state, turn, {
    type: 'civil_war',
    title,
    importance: 'critical',
    category: 'civil_conflict',
    countryIds: [parent.id, rebelId],
    regionIds: contestedRegionIds,
    headline,
    body,
    locationRegionId: rebelRegions[0]?.id ?? null,
    locationEntityId: parent.id,
    ...narrative,
  })

  const warId = `WAR-CIVIL-${parent.id}-${turn}`
  state.wars[warId] = {
    id: warId,
    attackerIds: [rebelId],
    defenderIds: [parent.id],
    startTurn: turn,
    endTurn: null,
    warGoal: 'regime_change',
    contestedRegionIds,
    warScore: 0,
    active: true,
    level: 4,
    isCivilWar: true,
    storyEventId: storyId,
  }
}
