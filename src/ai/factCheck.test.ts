import { describe, it, expect } from 'vitest'
import { produce } from 'immer'
import { createNewGame } from '@/simulation/newGame'
import { factCheckReply } from './factCheck'

describe('factCheckReply', () => {
  it('leaves a reply alone when the mentioned figure matches the real value', () => {
    const state = createNewGame('USA')
    const reply = `Your active personnel is ${state.entities.USA.military.personnelActive.toLocaleString()}, a strong force.`
    expect(factCheckReply(reply, state)).toBe(reply)
  })

  it('leaves a reply alone when the figure is a reasonable rounding', () => {
    const state = createNewGame('USA')
    // USA seeded at 1,390,000 -- "about 1.4 million" is a reasonable rounding.
    const reply = 'You have about 1.4 million active personnel.'
    expect(factCheckReply(reply, state)).toBe(reply)
  })

  it('appends a correction when a stat is wildly wrong', () => {
    const state = createNewGame('USA')
    const reply = 'You currently have 9,999,999 active personnel, an enormous force.'
    const corrected = factCheckReply(reply, state)
    expect(corrected).toContain('Simulation correction')
    expect(corrected).toContain('active personnel')
  })

  it('does not flag a number mentioned near a foreign country name', () => {
    let state = createNewGame('USA')
    state = produce(state, (draft) => {
      draft.entities.IRN.military.personnelActive = 500000
    })
    const reply = "Iran's active personnel is estimated at around 500,000 troops."
    // Should not be "corrected" against OUR (USA's) personnel count.
    expect(factCheckReply(reply, state)).toBe(reply)
  })
})
