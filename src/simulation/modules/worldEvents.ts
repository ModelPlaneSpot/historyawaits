import type { WorldState, WorldEntity } from '@/domain/schemas'
import { pushNews } from './news'
import { adjustOpinion, applySanction, getOrCreateRelation } from './diplomacy'

/** Emergent, condition-driven world events -- everything here is gated on
 *  actual simulation state (unemployment, stability, opinion, debt, etc.)
 *  rather than a flat random roll, and every event that fires does a real
 *  state mutation before its news is pushed (see spec: "news is a reporter
 *  of the simulation, not a separate fake system"). Entities are processed
 *  in a bounded round-robin slice per turn, same pattern as aiDecisions.ts,
 *  so cost stays flat as the roster grows. */
const EVENT_SLICE = 24

export function generateWorldEvents(state: WorldState, turn: number, rng: () => number): void {
  const allIds = Object.keys(state.entities)
  const start = (turn * EVENT_SLICE) % Math.max(1, allIds.length)
  for (let i = 0; i < Math.min(EVENT_SLICE, allIds.length); i++) {
    const entity = state.entities[allIds[(start + i) % allIds.length]]
    if (!entity) continue
    considerProtest(state, entity, turn, rng)
    considerEconomicShift(state, entity, turn, rng)
    considerNaturalDisaster(state, entity, turn, rng)
    considerResourceEvent(state, entity, turn, rng)
    considerTerroristAttack(state, entity, turn, rng)
  }

  considerBorderTension(state, turn, rng)
  considerAiDiplomacy(state, turn, rng)
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function considerProtest(state: WorldState, entity: WorldEntity, turn: number, rng: () => number): void {
  const unemployment = entity.economy.unemploymentRatePct
  const stability = entity.government.stability
  const risk = Math.max(0, (unemployment - 12) * 0.004) + Math.max(0, (35 - stability) * 0.003)
  if (risk <= 0 || rng() >= risk) return

  entity.population.unrest = clamp(entity.population.unrest + 8, 0, 100)
  entity.government.stability = clamp(entity.government.stability - 4, 0, 100)
  pushNews(
    state,
    turn,
    `Protests erupt in ${entity.name}`,
    `Demonstrations over economic conditions and government performance have spread across ${entity.name}.`,
    [entity.id],
    { category: 'politics', importance: 'medium', locationEntityId: entity.id },
  )
}

export function considerEconomicShift(state: WorldState, entity: WorldEntity, turn: number, rng: () => number): void {
  const econ = entity.economy

  if (econ.growthRatePct > -1 && rng() < 0.004 + Math.max(0, (econ.debtToGdpPct - 80) * 0.0002)) {
    econ.growthRatePct -= 2 + rng() * 2
    econ.unemploymentRatePct = clamp(econ.unemploymentRatePct + 2, 0, 60)
    pushNews(state, turn, `${entity.name} enters a recession`, `${entity.name}'s economic output has declined for a second consecutive quarter.`, [entity.id], {
      category: 'economy',
      importance: 'major',
      locationEntityId: entity.id,
    })
    return
  }

  if (econ.growthRatePct < 6 && rng() < 0.003) {
    econ.growthRatePct += 1.5 + rng() * 1.5
    pushNews(state, turn, `Economic boom in ${entity.name}`, `${entity.name} is experiencing rapid economic expansion.`, [entity.id], {
      category: 'economy',
      importance: 'medium',
      locationEntityId: entity.id,
    })
    return
  }

  if (rng() < 0.003) {
    econ.inflationPct += 3 + rng() * 5
    pushNews(state, turn, `Inflation surges in ${entity.name}`, `Consumer prices in ${entity.name} have risen sharply, straining household budgets.`, [entity.id], {
      category: 'economy',
      importance: 'medium',
      locationEntityId: entity.id,
    })
  }
}

const DISASTER_KINDS = ['an earthquake', 'severe flooding', 'a major hurricane', 'a drought', 'wildfires', 'a heat wave']

export function considerNaturalDisaster(state: WorldState, entity: WorldEntity, turn: number, rng: () => number): void {
  if (entity.territoryRegionIds.length === 0 || rng() >= 0.0015) return
  const regionId = entity.territoryRegionIds[Math.floor(rng() * entity.territoryRegionIds.length)]
  const region = state.regions[regionId]
  if (!region) return

  const kind = DISASTER_KINDS[Math.floor(rng() * DISASTER_KINDS.length)]
  region.infrastructureLevel = clamp(region.infrastructureLevel - (10 + rng() * 15), 0, 100)
  region.unrest = clamp(region.unrest + 6, 0, 100)
  entity.economy.gdpUsd = Math.max(0, entity.economy.gdpUsd * (1 - 0.002 - rng() * 0.003))

  const headline = `${kind[0].toUpperCase()}${kind.slice(1)} strikes ${region.name}`
  pushNews(state, turn, headline, `${headline[0].toUpperCase()}${headline.slice(1)}, in ${entity.name}, damaging local infrastructure.`, [entity.id], {
    category: 'disaster',
    importance: 'major',
    locationRegionId: regionId,
    locationEntityId: entity.id,
  })
}

const RESOURCE_LABELS: Record<string, string> = {
  oil: 'Oil',
  naturalGas: 'Natural gas',
  coal: 'Coal',
  freshWater: 'Fresh water',
  arableLand: 'Arable land',
  rareMinerals: 'Rare mineral',
  timber: 'Timber',
}

export function considerResourceEvent(state: WorldState, entity: WorldEntity, turn: number, rng: () => number): void {
  const resources = Object.keys(entity.economy.resources)
  if (resources.length === 0 || rng() >= 0.002) return

  const resource = resources[Math.floor(rng() * resources.length)]
  const label = RESOURCE_LABELS[resource] ?? resource
  const current = entity.economy.resources[resource as keyof typeof entity.economy.resources] ?? 0
  const isDiscovery = rng() < 0.6

  if (isDiscovery) {
    entity.economy.resources[resource as keyof typeof entity.economy.resources] = current * (1.2 + rng() * 0.3)
    entity.economy.gdpUsd *= 1 + 0.002 + rng() * 0.003
    pushNews(state, turn, `${label} discovery in ${entity.name}`, `New ${label.toLowerCase()} reserves have been discovered in ${entity.name}, boosting economic prospects.`, [entity.id], {
      category: 'resources',
      importance: 'medium',
      locationEntityId: entity.id,
    })
  } else {
    entity.economy.resources[resource as keyof typeof entity.economy.resources] = Math.max(0, current * (0.6 - rng() * 0.2))
    pushNews(state, turn, `${label} shortage in ${entity.name}`, `A shortage of ${label.toLowerCase()} is affecting ${entity.name}'s economy.`, [entity.id], {
      category: 'resources',
      importance: 'medium',
      locationEntityId: entity.id,
    })
  }
}

export function considerTerroristAttack(state: WorldState, entity: WorldEntity, turn: number, rng: () => number): void {
  if (entity.government.stability >= 40 || entity.territoryRegionIds.length === 0) return
  const risk = (40 - entity.government.stability) * 0.0006
  if (rng() >= risk) return

  const regionId = entity.territoryRegionIds[Math.floor(rng() * entity.territoryRegionIds.length)]
  const region = state.regions[regionId]
  if (!region) return

  region.unrest = clamp(region.unrest + 10, 0, 100)
  entity.government.stability = clamp(entity.government.stability - 3, 0, 100)
  pushNews(state, turn, `Terrorist attack in ${region.name}`, `A terrorist attack has struck ${region.name} in ${entity.name}, raising security concerns nationwide.`, [entity.id], {
    category: 'terrorism',
    importance: 'major',
    locationRegionId: regionId,
    locationEntityId: entity.id,
  })
}

/** Pre-war tension between neighboring countries -- approximated via shared
 *  UN subregion, since the simulation doesn't model a precise land-border
 *  graph. Represents escalation levels 1-3 (diplomatic tension/border
 *  incident/skirmish) from the spec, short of an actual declared war. */
export function considerBorderTension(state: WorldState, turn: number, rng: () => number): void {
  const bySubregion = new Map<string, string[]>()
  for (const e of Object.values(state.entities)) {
    if (e.kind !== 'country') continue
    const list = bySubregion.get(e.subregion) ?? []
    list.push(e.id)
    bySubregion.set(e.subregion, list)
  }

  for (const ids of bySubregion.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = state.entities[ids[i]]
        const b = state.entities[ids[j]]
        if (!a || !b) continue
        // Lazily seed the relation rather than requiring one to already
        // exist -- diplomacy is sparse by design, but neighboring countries
        // should still be *capable* of border tension from turn one.
        const rel = getOrCreateRelation(a, b.id)
        if (rel.status === 'war' || rel.status === 'allied' || rel.opinion >= -40) continue
        if (rng() >= 0.01) continue

        const isSkirmish = rel.opinion < -70 && rng() < 0.4
        adjustOpinion(state, a.id, b.id, -8)
        pushNews(
          state,
          turn,
          isSkirmish ? `Skirmish between ${a.name} and ${b.name}` : `Border incident between ${a.name} and ${b.name}`,
          `Tensions have flared between ${a.name} and ${b.name} along their shared border.`,
          [a.id, b.id],
          { category: 'military', importance: isSkirmish ? 'major' : 'medium', locationEntityId: a.id },
        )
      }
    }
  }
}

/** AI-vs-AI diplomacy that doesn't require the player's involvement at all --
 *  sanctions and summits happen between other countries whether or not the
 *  player is watching. */
export function considerAiDiplomacy(state: WorldState, turn: number, rng: () => number): void {
  const ids = Object.keys(state.entities)
  const sampleSize = 6
  for (let i = 0; i < sampleSize; i++) {
    const a = state.entities[ids[Math.floor(rng() * ids.length)]]
    const b = state.entities[ids[Math.floor(rng() * ids.length)]]
    if (!a || !b || a.id === b.id) continue
    // Same rationale as border tension: seed the relation on demand instead
    // of only acting on pairs that already happen to have one.
    const rel = getOrCreateRelation(a, b.id)

    if (rel.status === 'hostile' && rel.opinion < -60 && rng() < 0.05) {
      applySanction(state, a.id, b.id)
      pushNews(state, turn, `${a.name} sanctions ${b.name}`, `${a.name} has imposed economic sanctions on ${b.name} over deteriorating relations.`, [a.id, b.id], {
        category: 'diplomacy',
        importance: 'medium',
        locationEntityId: a.id,
      })
    } else if (rel.status === 'friendly' && rel.opinion > 60 && rng() < 0.03) {
      adjustOpinion(state, a.id, b.id, 5)
      pushNews(state, turn, `${a.name} and ${b.name} hold a diplomatic summit`, `Leaders of ${a.name} and ${b.name} met to strengthen bilateral ties.`, [a.id, b.id], {
        category: 'diplomacy',
        importance: 'minor',
        locationEntityId: a.id,
      })
    }
  }
}
