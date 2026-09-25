import { describe, it, expect } from 'vitest'
import { produce } from 'immer'
import { fallbackParser } from './fallbackParser'
import { createNewGame } from '@/simulation/newGame'
import { validateAndApply, validateAndApplyPlan } from '@/simulation/validators/actionValidator'
import type { ParseContext } from './types'

function ctx(
  worldState: ReturnType<typeof createNewGame>,
  playerEntityId: string,
  selectedRegionId: string | null = null,
  lastEntityId: string | null = null,
  lastRegionId: string | null = null,
): ParseContext {
  return { worldState, playerEntityId, selectedRegionId, lastEntityId, lastRegionId }
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
  it('explains, rather than pretending not to recognize, a declare-war target that is a non-state organization', async () => {
    const state = createNewGame('ISR')
    const parsed = await fallbackParser.parse('declare war on Hamas', ctx(state, 'ISR'))
    expect(parsed.ok).toBe(true)
    const result = validateAndApplyPlan(state, parsed.plan!, 1)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Hamas')
    expect(result.message.toLowerCase()).toContain('annex')
  })

  it('explains, rather than pretending not to recognize, declaring war directly on Gaza (an org-controlled region)', async () => {
    const state = createNewGame('ISR')
    const parsed = await fallbackParser.parse('declare war on Gaza', ctx(state, 'ISR'))
    expect(parsed.ok).toBe(true)
    const result = validateAndApplyPlan(state, parsed.plan!, 1)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Hamas')
  })

  it('rejects annexing Gaza without a war against its host country (Palestine)', async () => {
    const state = createNewGame('ISR')
    const parsed = await fallbackParser.parse('Annex Gaza', ctx(state, 'ISR'))
    expect(parsed.ok).toBe(true)
    const result = validateAndApplyPlan(state, parsed.plan!, 1)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Palestine')
  })

  it('executes the full "declare war, annex Gaza, dissolve Hamas" flow and mutates state correctly', async () => {
    const state = createNewGame('ISR')
    const warParsed = await fallbackParser.parse('declare war on Palestine', ctx(state, 'ISR'))
    expect(warParsed.ok).toBe(true)
    const afterWar = validateAndApplyPlan(state, warParsed.plan!, 1)
    expect(afterWar.ok).toBe(true)

    const parsed = await fallbackParser.parse('Annex Gaza and dissolve Hamas', ctx(afterWar.state, 'ISR'))
    expect(parsed.ok).toBe(true)
    const result = validateAndApplyPlan(afterWar.state, parsed.plan!, 2)
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
        storyEventId: null,
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
