import { describe, it, expect } from 'vitest'
import { createNewGame } from './newGame'

describe('generated world data: disputed territory', () => {
  it("assigns Western Sahara's own provinces to ESH, not Morocco", () => {
    const state = createNewGame('USA')
    expect(state.entities.ESH.territoryRegionIds.length).toBeGreaterThan(0)
    for (const regionId of state.entities.ESH.territoryRegionIds) {
      const region = state.regions[regionId]
      expect(region.controllerId).toBe('ESH')
      expect(region.countryId).toBe('ESH')
    }
    // The two Western Sahara provinces must not still be counted as Morocco's.
    expect(state.entities.MAR.territoryRegionIds).not.toContain('MAR-3456')
    expect(state.entities.MAR.territoryRegionIds).not.toContain('MAR-3469')
  })

  it('marks every disputed entity\'s regions as disputed, contested by its claimants', () => {
    const state = createNewGame('USA')
    for (const entity of Object.values(state.entities)) {
      if (entity.kind !== 'disputed_entity') continue
      for (const regionId of entity.territoryRegionIds) {
        const region = state.regions[regionId]
        expect(region.disputed, `${entity.id} region ${regionId} should be disputed`).toBe(true)
        expect(region.contestedByIds.length, `${entity.id} region ${regionId} should have a contesting claimant`).toBeGreaterThan(0)
      }
    }
  })

  it('gives Gaza and the West Bank their own distinct controlling body', () => {
    const state = createNewGame('USA')
    expect(state.regions['PSE-GAZA'].controllerId).toBe('ORG-HAMAS')
    expect(state.regions['PSE-WBK'].controllerId).toBe('ORG-PA')
    expect(state.organizations['ORG-HAMAS'].hostEntityId).toBe('PSE')
    expect(state.organizations['ORG-PA'].hostEntityId).toBe('PSE')
  })
})
