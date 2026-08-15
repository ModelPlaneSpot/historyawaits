import { describe, it, expect } from 'vitest'
import { produce } from 'immer'
import { fallbackParser } from './fallbackParser'
import { createNewGame } from '@/simulation/newGame'
import { validateAndApply } from '@/simulation/validators/actionValidator'

describe('fallbackParser', () => {
  it('parses "declare war on Iran"', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('declare war on Iran', { worldState: state, playerEntityId: 'USA' })
    expect(result.ok).toBe(true)
    expect(result.action).toMatchObject({ action: 'declare_war', target: 'IRN' })
  })

  it('parses "mobilize 100000 troops"', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('mobilize 100000 troops', { worldState: state, playerEntityId: 'USA' })
    expect(result.action).toMatchObject({ action: 'mobilize', quantity: 100000, unit: 'troops' })
  })

  it('parses "increase military spending to 5 percent"', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('increase military spending to 5 percent', {
      worldState: state,
      playerEntityId: 'USA',
    })
    expect(result.action).toMatchObject({ action: 'set_military_spending', percent: 5 })
  })

  it('parses "sign a treaty with France"', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('sign a treaty with France', { worldState: state, playerEntityId: 'USA' })
    expect(result.action).toMatchObject({ action: 'sign_treaty', target: 'FRA' })
  })

  it('parses "build 100 tanks"', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('build 100 tanks', { worldState: state, playerEntityId: 'USA' })
    expect(result.action).toMatchObject({ action: 'build_units', quantity: 100, unit: 'tanks' })
  })

  it('parses "annex Gaza"', async () => {
    const state = createNewGame('ISR')
    const result = await fallbackParser.parse('annex Gaza', { worldState: state, playerEntityId: 'ISR' })
    expect(result.action).toMatchObject({ action: 'annex', target: 'PSE-GAZA' })
  })

  it('parses the compound spec example "Annex Gaza and dissolve Hamas"', async () => {
    const state = createNewGame('ISR')
    const result = await fallbackParser.parse('Annex Gaza and dissolve Hamas', {
      worldState: state,
      playerEntityId: 'ISR',
    })
    expect(result.ok).toBe(true)
    expect(result.action).toMatchObject({
      action: 'annex',
      target: 'PSE-GAZA',
      secondaryAction: 'dissolve_organization',
      organization: 'ORG-HAMAS',
    })
  })

  it('parses "sanction Russia" without requiring the word "on"', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('sanction Russia', { worldState: state, playerEntityId: 'USA' })
    expect(result.action).toMatchObject({ action: 'sanction', target: 'RUS' })
  })

  it('parses "form an alliance with Japan"', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('form an alliance with Japan', { worldState: state, playerEntityId: 'USA' })
    expect(result.action).toMatchObject({ action: 'form_alliance', target: 'JPN' })
  })

  it('returns a helpful error and suggestions for unrecognized input', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('do a barrel roll', { worldState: state, playerEntityId: 'USA' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('declare war')
  })
})

describe('actionValidator end-to-end via fallback parser', () => {
  it('executes the full "annex Gaza and dissolve Hamas" flow and mutates state correctly', async () => {
    const state = createNewGame('ISR')
    const parsed = await fallbackParser.parse('Annex Gaza and dissolve Hamas', {
      worldState: state,
      playerEntityId: 'ISR',
    })
    expect(parsed.ok).toBe(true)
    const result = validateAndApply(state, parsed.action!, 1)
    expect(result.ok).toBe(true)
    expect(result.state!.regions['PSE-GAZA'].controllerId).toBe('ISR')
    expect(result.state!.organizations['ORG-HAMAS'].active).toBe(false)
    expect(result.state!.regions['PSE-GAZA'].occupyingOrganizationId).toBeNull()
    // Original state must remain untouched.
    expect(state.regions['PSE-GAZA'].controllerId).toBe('ORG-HAMAS')
  })

  it('rejects declaring war on a country the AI/fallback failed to resolve', async () => {
    const state = createNewGame('USA')
    const result = validateAndApply(
      state,
      { actor: 'USA', action: 'declare_war', target: null, secondaryAction: null, organization: null, treatyType: null, quantity: null, unit: null, percent: null },
      1,
    )
    expect(result.ok).toBe(false)
  })

  it('rejects annexing a region controlled by an entity you are not at war with', () => {
    const state = createNewGame('USA')
    const canadaRegion = state.entities.CAN.territoryRegionIds[0]
    const result = validateAndApply(
      state,
      { actor: 'USA', action: 'annex', target: canadaRegion, secondaryAction: null, organization: null, treatyType: null, quantity: null, unit: null, percent: null },
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
      }
    })
    const canadaRegion = state.entities.CAN.territoryRegionIds[0]
    const result = validateAndApply(
      state,
      { actor: 'USA', action: 'annex', target: canadaRegion, secondaryAction: null, organization: null, treatyType: null, quantity: null, unit: null, percent: null },
      2,
    )
    expect(result.ok).toBe(true)
    expect(result.state!.regions[canadaRegion].controllerId).toBe('USA')
  })
})
