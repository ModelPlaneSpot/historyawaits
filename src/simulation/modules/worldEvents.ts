import type { WorldState, WorldEntity } from '@/domain/schemas'
import { pushNews } from './news'
import { adjustOpinion, applySanction, getOrCreateRelation } from './diplomacy'
import { createStory, appendStoryStage, findOpenStory } from './story'
import { buildEconomicCrisisNarrative, buildDiplomaticCrisisNarrative } from './storyTemplates'
import { applyDeclareWar } from './war'

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

  considerDiplomaticEscalation(state, turn, rng)
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
    const narrative = buildEconomicCrisisNarrative(entity)
    const title = `${entity.name.toUpperCase()} ENTERS DEEP RECESSION`
    createStory(state, turn, {
      type: 'economic_crisis',
      title,
      importance: 'major',
      category: 'economy',
      countryIds: [entity.id],
      regionIds: [],
      headline: `${entity.name} Enters a Recession`,
      body: `${entity.name}'s economic output has declined for a second consecutive quarter.`,
      locationEntityId: entity.id,
      ...narrative,
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

/** A real escalation ladder between neighboring countries -- approximated via
 *  shared UN subregion, since the simulation doesn't model a precise land-
 *  border graph. Each hostile pair develops through named stages on a single
 *  persistent diplomatic_crisis story (tension -> mobilization -> border
 *  clash), and if it deteriorates far enough, actually escalates into a real
 *  declared war (applyDeclareWar), at which point the story is upgraded to
 *  type "war" rather than left behind as an abandoned thread. This is what
 *  lets something like a Thailand-Cambodia border dispute develop into an
 *  actual war over many turns, fully visible in the news even if the player
 *  is on the other side of the world. */
export function considerDiplomaticEscalation(state: WorldState, turn: number, rng: () => number): void {
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
        if (rel.status === 'war' || rel.status === 'allied' || rel.opinion >= -30) continue
        if (rng() >= 0.012) continue

        adjustOpinion(state, a.id, b.id, -6)
        const existing = findOpenStory(state, 'diplomatic_crisis', [a.id, b.id])
        const stageCount = existing?.stages.length ?? 0

        if (!existing) {
          const title = `Tensions Rise Along the ${a.name}-${b.name} Border`
          createStory(state, turn, {
            type: 'diplomatic_crisis',
            title,
            importance: 'medium',
            category: 'diplomacy',
            countryIds: [a.id, b.id],
            regionIds: [],
            headline: title,
            body: `Diplomatic relations between ${a.name} and ${b.name} have deteriorated sharply following a series of border incidents.`,
            locationEntityId: a.id,
            ...buildDiplomaticCrisisNarrative(a, b, rel.opinion),
          })
        } else if (rel.opinion < -55 && stageCount === 1) {
          appendStoryStage(state, existing.id, turn, {
            headline: `${a.name} and ${b.name} Forces Mobilize`,
            body: `Both ${a.name} and ${b.name} have moved additional forces toward their shared border amid rising tension.`,
            category: 'military',
            importance: 'medium',
            locationEntityId: a.id,
            situation: `${a.name}-${b.name} relations: ${rel.opinion.toFixed(0)}\nStatus: Military mobilization along the border`,
          })
        } else if (rel.opinion < -75 && stageCount === 2) {
          appendStoryStage(state, existing.id, turn, {
            headline: `Border Clash Leaves Casualties Near the ${a.name}-${b.name} Frontier`,
            body: `A clash between ${a.name} and ${b.name} forces along their shared border has resulted in casualties on both sides.`,
            category: 'military',
            importance: 'major',
            locationEntityId: a.id,
            situation: `${a.name}-${b.name} relations: ${rel.opinion.toFixed(0)}\nStatus: Active border clashes, no formal war declared`,
          })
        } else if (rel.opinion <= -85 && stageCount >= 3 && rng() < 0.25) {
          applyDeclareWar(state, a.id, b.id, turn, existing.id)
        }
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
