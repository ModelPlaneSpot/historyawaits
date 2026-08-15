import { describe, it, expect } from 'vitest'
import { produce } from 'immer'
import { fallbackParser } from './fallbackParser'
import { createNewGame } from '@/simulation/newGame'
import { validateAndApply, validateAndApplyPlan } from '@/simulation/validators/actionValidator'
import type { ParseContext } from './types'

function ctx(worldState: ReturnType<typeof createNewGame>, playerEntityId: string, selectedRegionId: string | null = null): ParseContext {
  return { worldState, playerEntityId, selectedRegionId }
}

describe('fallbackParser', () => {
  it('parses "declare war on Iran"', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('declare war on Iran', ctx(state, 'USA'))
    expect(result.ok).toBe(true)
    expect(result.plan?.steps[0]).toMatchObject({ action: 'declare_war', target: 'IRN' })
  })

  it('parses "mobilize 100000 troops"', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('mobilize 100000 troops', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'mobilize', quantity: 100000, unit: 'troops' })
  })

  it('parses "increase military spending to 5 percent"', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('increase military spending to 5 percent', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'set_military_spending', percent: 5 })
  })

  it('parses "sign a treaty with France"', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('sign a treaty with France', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'sign_treaty', target: 'FRA' })
  })

  it('parses "build 100 tanks"', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('build 100 tanks', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'build_units', quantity: 100, unit: 'tanks' })
  })

  it('parses "annex Gaza"', async () => {
    const state = createNewGame('ISR')
    const result = await fallbackParser.parse('annex Gaza', ctx(state, 'ISR'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'annex', target: 'PSE-GAZA' })
  })

  it('parses "annex this region" using the current map selection', async () => {
    const state = createNewGame('ISR')
    const result = await fallbackParser.parse('annex this region', ctx(state, 'ISR', 'PSE-GAZA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'annex', target: 'PSE-GAZA' })
  })

  it('parses the compound spec example "Annex Gaza and dissolve Hamas" as two steps', async () => {
    const state = createNewGame('ISR')
    const result = await fallbackParser.parse('Annex Gaza and dissolve Hamas', ctx(state, 'ISR'))
    expect(result.ok).toBe(true)
    expect(result.plan?.steps).toMatchObject([
      { action: 'annex', target: 'PSE-GAZA' },
      { action: 'dissolve_organization', organization: 'ORG-HAMAS' },
    ])
  })

  it('parses a longer compound command into multiple steps', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse(
      'mobilize 200000 troops, increase military spending to 6 percent, and sign a defense treaty with France',
      ctx(state, 'USA'),
    )
    expect(result.ok).toBe(true)
    expect(result.plan?.steps).toMatchObject([
      { action: 'mobilize', quantity: 200000 },
      { action: 'set_military_spending', percent: 6 },
      { action: 'sign_treaty', target: 'FRA', treatyType: 'defense_pact' },
    ])
  })

  it('reports an honest "unsupported" step for a command outside the simulation model', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('move 50000 troops to the northern border', ctx(state, 'USA'))
    expect(result.plan?.steps[0].action).toBe('unsupported')
    expect(result.plan?.steps[0].note).toBeTruthy()
  })

  it('parses "sanction Russia" without requiring the word "on"', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('sanction Russia', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'sanction', target: 'RUS' })
  })

  it('parses "form an alliance with Japan"', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('form an alliance with Japan', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'form_alliance', target: 'JPN' })
  })

  it('parses "improve relations with Egypt"', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('improve relations with Egypt', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'improve_relations', target: 'EGY' })
  })

  it('returns a helpful error and suggestions for unrecognized input', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('do a barrel roll', ctx(state, 'USA'))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('declare war')
  })
})

describe('actionValidator end-to-end via fallback parser', () => {
  it('executes the full "annex Gaza and dissolve Hamas" flow and mutates state correctly', async () => {
    const state = createNewGame('ISR')
    const parsed = await fallbackParser.parse('Annex Gaza and dissolve Hamas', ctx(state, 'ISR'))
    expect(parsed.ok).toBe(true)
    const result = validateAndApplyPlan(state, parsed.plan!, 1)
    expect(result.ok).toBe(true)
    expect(result.state.regions['PSE-GAZA'].controllerId).toBe('ISR')
    expect(result.state.organizations['ORG-HAMAS'].active).toBe(false)
    expect(result.state.regions['PSE-GAZA'].occupyingOrganizationId).toBeNull()
    // Original state must remain untouched.
    expect(state.regions['PSE-GAZA'].controllerId).toBe('ORG-HAMAS')
  })

  it('rejects declaring war on a country the AI/fallback failed to resolve', async () => {
    const state = createNewGame('USA')
    const result = validateAndApply(
      state,
      { actor: 'USA', action: 'declare_war', target: null, organization: null, treatyType: null, quantity: null, unit: null, percent: null, note: null },
      1,
    )
    expect(result.ok).toBe(false)
  })

  it('rejects annexing a region controlled by an entity you are not at war with', () => {
    const state = createNewGame('USA')
    const canadaRegion = state.entities.CAN.territoryRegionIds[0]
    const result = validateAndApply(
      state,
      { actor: 'USA', action: 'annex', target: canadaRegion, organization: null, treatyType: null, quantity: null, unit: null, percent: null, note: null },
      1,
    )
    expect(result.ok).toBe(false)
  })

  it('allows annexing a region after winning a war', () => {
    let state = createNewGame('USA')
    state = produce(state, (draft) => {
      draft.wars['WAR-1'] = {
        id: 'WAR-1',
        attackerIds: ['USA'],
        defenderIds: ['CAN'],
        startTurn: 1,
        endTurn: null,
        warGoal: 'conquest',
        contestedRegionIds: [],
        warScore: 0,
        active: true,
        level: 4,
        isCivilWar: false,
      }
    })
    const canadaRegion = state.entities.CAN.territoryRegionIds[0]
    const result = validateAndApply(
      state,
      { actor: 'USA', action: 'annex', target: canadaRegion, organization: null, treatyType: null, quantity: null, unit: null, percent: null, note: null },
      2,
    )
    expect(result.ok).toBe(true)
    expect(result.state!.regions[canadaRegion].controllerId).toBe('USA')
  })

  it('a compound plan continues past a failing step and reports partial success', () => {
    const state = createNewGame('USA')
    const plan = {
      steps: [
        { actor: 'USA', action: 'set_military_spending' as const, target: null, organization: null, treatyType: null, quantity: null, unit: null, percent: 6, note: null },
        { actor: 'USA', action: 'declare_war' as const, target: null, organization: null, treatyType: null, quantity: null, unit: null, percent: null, note: null },
      ],
    }
    const result = validateAndApplyPlan(state, plan, 1)
    expect(result.ok).toBe(true)
    expect(result.state.entities.USA.economy.militarySpendingPctOfGdp).toBe(6)
    expect(result.stepResults[1].ok).toBe(false)
  })
})
