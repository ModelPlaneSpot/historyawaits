import { describe, it, expect } from 'vitest'
import { createNewGame } from '@/simulation/newGame'
import { advanceTurn, advanceTurns } from './turnEngine'
import { applyDeclareWar, advanceWars } from '@/simulation/modules/war'
import { applyAnnex } from '@/simulation/modules/territory'
import { applyBuildUnits, applyMobilize, militaryStrength } from '@/simulation/modules/military'
import { applyDissolveOrganization } from '@/simulation/modules/government'
import { applyFormAlliance } from '@/simulation/modules/diplomacy'
import { produce } from 'immer'

function fixedRng(seedValue: number) {
  let s = seedValue
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

describe('turnEngine', () => {
  it('advances one turn without producing NaN/negative core stats', () => {
    const state = createNewGame('USA')
    const next = advanceTurn(state, fixedRng(1))
    expect(next.turn).toBe(1)
    for (const entity of Object.values(next.entities)) {
      expect(Number.isFinite(entity.economy.gdpUsd)).toBe(true)
      expect(entity.economy.gdpUsd).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(entity.military.personnelActive)).toBe(true)
    }
  })

  it('is a pure function: does not mutate the input state', () => {
    const state = createNewGame('USA')
    const originalGdp = state.entities.USA.economy.gdpUsd
    advanceTurn(state, fixedRng(2))
    expect(state.entities.USA.economy.gdpUsd).toBe(originalGdp)
    expect(state.turn).toBe(0)
  })

  it('stays stable over many turns', () => {
    const state = createNewGame('USA')
    const final = advanceTurns(state, 60, fixedRng(3))
    expect(final.turn).toBe(60)
    for (const entity of Object.values(final.entities)) {
      expect(Number.isFinite(entity.economy.gdpUsd)).toBe(true)
      expect(entity.government.stability).toBeGreaterThanOrEqual(0)
      expect(entity.government.stability).toBeLessThanOrEqual(100)
    }
  })
})

describe('war module', () => {
  it('declaring war creates an active war and sets relations to war', () => {
    const state = createNewGame('USA')
    const next = produce(state, (draft) => {
      applyDeclareWar(draft, 'USA', 'PRK', 1)
    })
    const war = Object.values(next.wars)[0]
    expect(war.active).toBe(true)
    expect(war.attackerIds).toContain('USA')
    expect(war.defenderIds).toContain('PRK')
    const relation = next.entities.USA.relations.find((r) => r.otherEntityId === 'PRK')
    expect(relation?.status).toBe('war')
  })

  it('a decisively stronger attacker eventually wins and annexes contested regions', () => {
    let state = createNewGame('USA')
    state = produce(state, (draft) => {
      // Make USA overwhelmingly stronger than a tiny, weak target.
      draft.entities.USA.military.equipment = { tanks: 5000, aircraft: 3000, ships: 500, artillery: 5000 }
      draft.entities.USA.military.personnelActive = 2000000
      draft.entities.SOL.military.equipment = { tanks: 0, aircraft: 0, ships: 0, artillery: 0 }
      draft.entities.SOL.military.personnelActive = 100
      applyDeclareWar(draft, 'USA', 'SOL', 1)
    })
    expect(militaryStrength(state.entities.USA)).toBeGreaterThan(militaryStrength(state.entities.SOL) * 10)

    let turn = 1
    let war = Object.values(state.wars)[0]
    const rng = fixedRng(42)
    while (war.active && turn < 200) {
      turn++
      state = produce(state, (draft) => {
        advanceWars(draft, turn, rng)
      })
      war = state.wars[war.id]
    }
    expect(war.active).toBe(false)
    // All contested regions should now be controlled by the winner, USA.
    for (const regionId of war.contestedRegionIds) {
      expect(state.regions[regionId].controllerId).toBe('USA')
    }
  })

  it('starts every declared war at escalation level 4 (limited conflict)', () => {
    const state = createNewGame('USA')
    const next = produce(state, (draft) => {
      applyDeclareWar(draft, 'USA', 'PRK', 1)
    })
    expect(Object.values(next.wars)[0].level).toBe(4)
  })

  it('draws an ally into the war and raises its escalation level', () => {
    let state = createNewGame('USA')
    state = produce(state, (draft) => {
      applyFormAlliance(draft, 'CAN', 'USA', 1)
      applyDeclareWar(draft, 'USA', 'PRK', 1)
    })
    const warId = Object.keys(state.wars)[0]
    expect(state.wars[warId].attackerIds).not.toContain('CAN')

    const rng = () => 0 // always clears the ally-draw-in roll threshold
    let turn = 1
    for (let i = 0; i < 5 && !state.wars[warId].attackerIds.includes('CAN'); i++) {
      turn++
      state = produce(state, (draft) => {
        advanceWars(draft, turn, rng)
      })
    }
    expect(state.wars[warId].attackerIds).toContain('CAN')
    expect(state.wars[warId].level).toBeGreaterThan(4)
  })
})

describe('territory module', () => {
  it('annexing an entity transfers all of its regions to the actor', () => {
    const state = createNewGame('USA')
    const targetRegionIds = state.entities.SOL.territoryRegionIds
    expect(targetRegionIds.length).toBeGreaterThan(0)

    const next = produce(state, (draft) => {
      applyAnnex(draft, 'USA', 'SOL', 5)
    })
    for (const regionId of targetRegionIds) {
      expect(next.regions[regionId].controllerId).toBe('USA')
    }
    expect(next.entities.SOL.territoryRegionIds.length).toBe(0)
    expect(next.entities.USA.territoryRegionIds).toEqual(expect.arrayContaining(targetRegionIds))
  })

  it('annexing a single region only transfers that region', () => {
    const state = createNewGame('USA')
    const regionId = state.entities.CAN.territoryRegionIds[0]
    const next = produce(state, (draft) => {
      applyAnnex(draft, 'USA', regionId, 5)
    })
    expect(next.regions[regionId].controllerId).toBe('USA')
    expect(next.entities.CAN.territoryRegionIds).not.toContain(regionId)
  })
})

describe('military module', () => {
  it('building units spends treasury and increases equipment', () => {
    const state = createNewGame('USA')
    const before = state.entities.USA.military.equipment.tanks
    const treasuryBefore = state.entities.USA.economy.treasuryUsd
    const next = produce(state, (draft) => {
      const ok = applyBuildUnits(draft.entities.USA, 'tanks', 10)
      expect(ok).toBe(true)
    })
    expect(next.entities.USA.military.equipment.tanks).toBe(before + 10)
    expect(next.entities.USA.economy.treasuryUsd).toBeLessThan(treasuryBefore)
  })

  it('building units fails gracefully when the treasury cannot afford it', () => {
    const state = createNewGame('USA')
    const next = produce(state, (draft) => {
      draft.entities.USA.economy.treasuryUsd = 0
      const ok = applyBuildUnits(draft.entities.USA, 'ships', 100)
      expect(ok).toBe(false)
    })
    expect(next.entities.USA.military.equipment.ships).toBe(state.entities.USA.military.equipment.ships)
  })

  it('mobilizing raises mobilization level and active personnel', () => {
    const state = createNewGame('USA')
    const before = state.entities.USA.military.personnelActive
    const next = produce(state, (draft) => {
      applyMobilize(draft.entities.USA, 100000)
    })
    expect(next.entities.USA.military.personnelActive).toBe(before + 100000)
    expect(next.entities.USA.military.mobilizationLevel).toBeGreaterThan(state.entities.USA.military.mobilizationLevel)
  })
})

describe('government module', () => {
  it('dissolving an organization deactivates it and clears region occupation', () => {
    const state = createNewGame('PSE')
    expect(state.regions['PSE-GAZA'].occupyingOrganizationId).toBe('ORG-HAMAS')
    const next = produce(state, (draft) => {
      const ok = applyDissolveOrganization(draft, 'ORG-HAMAS', 10)
      expect(ok).toBe(true)
    })
    expect(next.organizations['ORG-HAMAS'].active).toBe(false)
    expect(next.regions['PSE-GAZA'].occupyingOrganizationId).toBeNull()
  })
})
