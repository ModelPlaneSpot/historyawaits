import { describe, it, expect } from 'vitest'
import { produce } from 'immer'
import { createNewGame } from '@/simulation/newGame'
import { buildAdvisorContext } from './advisorContext'
import { applyDeclareWar } from '@/simulation/modules/war'

describe('buildAdvisorContext', () => {
  it('includes the player nation and real economic figures', () => {
    const state = createNewGame('USA')
    const context = buildAdvisorContext(state, 'how is my economy?')
    expect(context).toContain('United States')
    expect(context).toContain('GDP')
    expect(context).toMatch(/\$30\.7\dT/) // real seeded USA GDP, not a placeholder
  })

  it('includes the current in-game date', () => {
    const state = createNewGame('USA')
    const context = buildAdvisorContext(state, 'what is the date?')
    expect(context).toContain('Current in-game date:')
  })

  it('reports not being at war when there are no active wars', () => {
    const state = createNewGame('USA')
    const context = buildAdvisorContext(state, 'how strong is my military?')
    expect(context).toContain('At war: no')
  })

  it('reports active wars with the opponent name once one starts', () => {
    let state = createNewGame('USA')
    state = produce(state, (draft) => {
      applyDeclareWar(draft, 'USA', 'IRN', 1)
    })
    const context = buildAdvisorContext(state, 'how is the war going?')
    expect(context).toContain('Iran')
    expect(context).not.toContain('At war: no')
  })

  it('never claims exact knowledge of a foreign military (uses "est." framing)', () => {
    const state = createNewGame('USA')
    const context = buildAdvisorContext(state, 'which country is the biggest threat to me?')
    expect(context).toContain('est.')
  })

  it('only includes detailed military section when the question is about military', () => {
    const state = createNewGame('USA')
    const militaryContext = buildAdvisorContext(state, 'how strong is my military?')
    const economyContext = buildAdvisorContext(state, 'why is my economy declining?')
    expect(militaryContext).toContain('Reserve:')
    expect(economyContext).not.toContain('Reserve:')
  })

  it('includes a named country\'s data when the question mentions it', () => {
    const state = createNewGame('USA')
    const context = buildAdvisorContext(state, 'should I invade Iran?')
    expect(context).toContain('=== Iran')
  })
})
