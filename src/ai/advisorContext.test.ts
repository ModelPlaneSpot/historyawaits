import { describe, it, expect } from 'vitest'
import { produce } from 'immer'
import { createNewGame } from '@/simulation/newGame'
import { buildAdvisorContext } from './advisorContext'
import { applyDeclareWar } from '@/simulation/modules/war'

describe('buildAdvisorContext', () => {
  it('includes the player nation and real economic figures', () => {
    const state = createNewGame('USA')
    const context = buildAdvisorContext(state)
    expect(context).toContain('United States')
    expect(context).toContain('GDP')
    expect(context).toMatch(/\$27\.00T|\$26|\$27|\$28/) // real seeded USA GDP, not a placeholder
  })

  it('reports "not currently at war" when there are no active wars', () => {
    const state = createNewGame('USA')
    const context = buildAdvisorContext(state)
    expect(context).toContain('Not currently at war')
  })

  it('reports active wars with the opponent name once one starts', () => {
    let state = createNewGame('USA')
    state = produce(state, (draft) => {
      applyDeclareWar(draft, 'USA', 'IRN', 1)
    })
    const context = buildAdvisorContext(state)
    expect(context).toContain('Iran')
    expect(context).not.toContain('Not currently at war')
  })

  it('never claims exact knowledge of a foreign military (uses "est." framing)', () => {
    const state = createNewGame('USA')
    const context = buildAdvisorContext(state)
    const threatsSection = context.split('Largest military powers')[1]
    expect(threatsSection).toContain('est.')
  })
})
