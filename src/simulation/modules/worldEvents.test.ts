import { describe, it, expect } from 'vitest'
import { produce } from 'immer'
import { createNewGame } from '@/simulation/newGame'
import {
  considerProtest,
  considerEconomicShift,
  considerNaturalDisaster,
  considerDiplomaticEscalation,
  considerTerroristAttack,
  considerResourceEvent,
} from './worldEvents'
import { considerCivilWar } from './civilWar'

/** Always-hit rng: satisfies every `rng() < risk` gate (as long as risk > 0)
 *  and always picks index 0 out of any array via Math.floor(rng() * n). Lets
 *  these tests assert "when conditions are right, the event deterministically
 *  fires and mutates real state" instead of hoping a live run gets lucky. */
const alwaysHit = () => 0
/** Never-hit rng: fails every `rng() < risk` / `rng() >= risk` gate the other
 *  way, for asserting an event does NOT fire outside its trigger conditions. */
const neverHit = () => 0.999999

describe('considerProtest', () => {
  it('fires and raises unrest when unemployment and stability conditions are met', () => {
    const state = createNewGame('USA')
    const next = produce(state, (draft) => {
      const entity = draft.entities.USA
      entity.economy.unemploymentRatePct = 30
      entity.government.stability = 20
      considerProtest(draft, entity, 5, alwaysHit)
    })
    const news = next.news.find((n) => n.headline.includes('Protests erupt'))
    expect(news).toBeDefined()
    expect(news?.category).toBe('politics')
    expect(next.entities.USA.population.unrest).toBeGreaterThan(state.entities.USA.population.unrest)
    expect(next.entities.USA.government.stability).toBeLessThan(20)
  })

  it('does not fire when unemployment is low and stability is high', () => {
    const state = createNewGame('USA')
    const next = produce(state, (draft) => {
      const entity = draft.entities.USA
      entity.economy.unemploymentRatePct = 4
      entity.government.stability = 90
      considerProtest(draft, entity, 5, alwaysHit)
    })
    expect(next.news.some((n) => n.headline.includes('Protests erupt'))).toBe(false)
  })
})

describe('considerEconomicShift', () => {
  it('pushes a recession and actually lowers growth/raises unemployment', () => {
    const state = createNewGame('USA')
    const growthBefore = state.entities.USA.economy.growthRatePct
    const next = produce(state, (draft) => {
      considerEconomicShift(draft, draft.entities.USA, 3, alwaysHit)
    })
    const news = next.news.find((n) => /enters a recession/i.test(n.headline))
    expect(news).toBeDefined()
    expect(news?.category).toBe('economy')
    expect(news?.storyEventId).toBeTruthy()
    expect(next.entities.USA.economy.growthRatePct).toBeLessThan(growthBefore)
  })
})

describe('considerNaturalDisaster', () => {
  it('damages a real region and lowers national GDP', () => {
    const state = createNewGame('USA')
    const regionId = state.entities.USA.territoryRegionIds[0]
    const infraBefore = state.regions[regionId].infrastructureLevel
    const gdpBefore = state.entities.USA.economy.gdpUsd
    const next = produce(state, (draft) => {
      considerNaturalDisaster(draft, draft.entities.USA, 3, alwaysHit)
    })
    expect(next.regions[regionId].infrastructureLevel).toBeLessThan(infraBefore)
    expect(next.entities.USA.economy.gdpUsd).toBeLessThan(gdpBefore)
    const news = next.news.find((n) => n.locationRegionId === regionId && n.category === 'disaster')
    expect(news).toBeDefined()
    expect(news?.importance).toBe('major')
  })
})

describe('considerResourceEvent', () => {
  it('changes a real resource stock and tags the news as resources', () => {
    const state = createNewGame('USA')
    const next = produce(state, (draft) => {
      considerResourceEvent(draft, draft.entities.USA, 3, alwaysHit)
    })
    const news = next.news.find((n) => n.category === 'resources')
    expect(news).toBeDefined()
  })
})

describe('considerTerroristAttack', () => {
  it('fires under low stability and raises regional unrest', () => {
    const state = createNewGame('USA')
    const regionId = state.entities.USA.territoryRegionIds[0]
    const unrestBefore = state.regions[regionId].unrest
    const next = produce(state, (draft) => {
      draft.entities.USA.government.stability = 10
      considerTerroristAttack(draft, draft.entities.USA, 3, alwaysHit)
    })
    expect(next.regions[regionId].unrest).toBeGreaterThan(unrestBefore)
    const news = next.news.find((n) => n.category === 'terrorism')
    expect(news).toBeDefined()
    expect(news?.importance).toBe('major')
  })

  it('does not fire when stability is healthy', () => {
    const state = createNewGame('USA')
    const next = produce(state, (draft) => {
      draft.entities.USA.government.stability = 80
      considerTerroristAttack(draft, draft.entities.USA, 3, alwaysHit)
    })
    expect(next.news.some((n) => n.category === 'terrorism')).toBe(false)
  })
})

function samesubregionPair(state: ReturnType<typeof createNewGame>): [string, string] {
  const countries = Object.values(state.entities).filter((e) => e.kind === 'country')
  const bySubregion = new Map<string, string[]>()
  for (const c of countries) {
    const list = bySubregion.get(c.subregion) ?? []
    list.push(c.id)
    bySubregion.set(c.subregion, list)
  }
  const pair = [...bySubregion.values()].find((ids) => ids.length >= 2)
  expect(pair).toBeDefined()
  return [pair![0], pair![1]]
}

describe('considerDiplomaticEscalation', () => {
  it('opens a diplomatic_crisis story on the first escalation between hostile neighbors', () => {
    const state = createNewGame('USA')
    const [aId, bId] = samesubregionPair(state)

    const next = produce(state, (draft) => {
      draft.entities[aId].relations.push({ otherEntityId: bId, opinion: -50, status: 'hostile', treatyIds: [] })
      considerDiplomaticEscalation(draft, 1, alwaysHit)
    })
    const story = Object.values(next.storyEvents).find((s) => s.type === 'diplomatic_crisis' && s.countryIds.includes(aId) && s.countryIds.includes(bId))
    expect(story).toBeDefined()
    expect(story?.stages).toHaveLength(1)
    const news = next.news.find((n) => n.storyEventId === story!.id)
    expect(news).toBeDefined()
    expect(news?.category).toBe('diplomacy')
  })

  it('never fires between two allied countries even with a forced rng', () => {
    const state = createNewGame('USA')
    const [aId, bId] = samesubregionPair(state)
    const next = produce(state, (draft) => {
      draft.entities[aId].relations.push({ otherEntityId: bId, opinion: 90, status: 'allied', treatyIds: [] })
      considerDiplomaticEscalation(draft, 7, alwaysHit)
    })
    // Other, unrelated hostile pairs elsewhere in the baseline data are free
    // to fire (that's the point of a world that moves on its own) -- what
    // must never happen is THIS allied pair getting a border incident.
    const newsForPair = next.news.filter((n) => n.entityIds.includes(aId) && n.entityIds.includes(bId))
    expect(newsForPair).toHaveLength(0)
  })

  it('escalates a hostile pair all the way from tension to a declared war on one persistent story (Thailand/Cambodia-style arc)', () => {
    let state = createNewGame('USA')
    const [aId, bId] = samesubregionPair(state)
    state = produce(state, (draft) => {
      draft.entities[aId].relations.push({ otherEntityId: bId, opinion: -50, status: 'hostile', treatyIds: [] })
    })

    let turn = 1
    let war = Object.values(state.wars).find((w) => w.attackerIds.includes(aId) && w.defenderIds.includes(bId))
    for (let i = 0; i < 10 && !war; i++) {
      turn++
      state = produce(state, (draft) => {
        considerDiplomaticEscalation(draft, turn, alwaysHit)
      })
      war = Object.values(state.wars).find(
        (w) => (w.attackerIds.includes(aId) && w.defenderIds.includes(bId)) || (w.attackerIds.includes(bId) && w.defenderIds.includes(aId)),
      )
    }

    expect(war).toBeDefined()
    expect(war!.active).toBe(true)
    const story = state.storyEvents[war!.storyEventId!]
    expect(story).toBeDefined()
    expect(story.type).toBe('war')
    // The story should read as a developing narrative, not a single blip --
    // tension, then at least one escalation stage, then the war declaration.
    expect(story.stages.length).toBeGreaterThanOrEqual(3)
    expect(story.stages[story.stages.length - 1].headline).toContain('DESCEND INTO WAR')
  })
})

describe('considerCivilWar', () => {
  it('spins up a rebel entity holding real territory and an active civil war when stability collapses', () => {
    const state = createNewGame('USA')
    const next = produce(state, (draft) => {
      const usa = draft.entities.USA
      usa.government.stability = 2
      considerCivilWar(draft, usa, 10, alwaysHit)
    })

    const civilWar = Object.values(next.wars).find((w) => w.isCivilWar)
    expect(civilWar).toBeDefined()
    expect(civilWar!.active).toBe(true)
    expect(civilWar!.defenderIds).toContain('USA')

    const rebelId = civilWar!.attackerIds[0]
    const rebel = next.entities[rebelId]
    expect(rebel).toBeDefined()
    expect(rebel.territoryRegionIds.length).toBeGreaterThan(0)

    // The map must actually show the split: every rebel-held region's live
    // controller is the rebel entity, not the original government.
    for (const regionId of rebel.territoryRegionIds) {
      expect(next.regions[regionId].controllerId).toBe(rebelId)
    }
    expect(next.entities.USA.territoryRegionIds).not.toEqual(expect.arrayContaining(rebel.territoryRegionIds))

    const news = next.news.find((n) => n.category === 'civil_conflict' && n.importance === 'critical')
    expect(news).toBeDefined()
  })

  it('does not fire when government stability is healthy', () => {
    const state = createNewGame('USA')
    const next = produce(state, (draft) => {
      considerCivilWar(draft, draft.entities.USA, 10, alwaysHit)
    })
    expect(Object.values(next.wars).some((w) => w.isCivilWar)).toBe(false)
  })

  it('respects the rng gate: does not fire on a never-hit roll even at rock-bottom stability', () => {
    const state = createNewGame('USA')
    const next = produce(state, (draft) => {
      draft.entities.USA.government.stability = 1
      considerCivilWar(draft, draft.entities.USA, 10, neverHit)
    })
    expect(Object.values(next.wars).some((w) => w.isCivilWar)).toBe(false)
  })
})
