import { describe, it, expect } from 'vitest'
import { createNewGame } from '@/simulation/newGame'
import { advanceDiplomacy, getOrCreateRelation } from './diplomacy'

describe('advanceDiplomacy', () => {
  it('drifts a historical rivalry back toward hostile, not neutral', () => {
    const state = createNewGame('USA')
    const ind = state.entities.IND
    getOrCreateRelation(ind, 'PAK').opinion = -10 // cooled off from a past war
    getOrCreateRelation(state.entities.PAK, 'IND').opinion = -10

    for (let i = 0; i < 500; i++) advanceDiplomacy(state, ind)

    const rel = ind.relations.find((r) => r.otherEntityId === 'PAK')!
    expect(rel.opinion).toBeLessThan(-45)
  })

  it('drifts same-camp democracies toward a mildly positive opinion', () => {
    const state = createNewGame('USA')
    const fra = state.entities.FRA
    getOrCreateRelation(fra, 'DEU').opinion = 0
    getOrCreateRelation(state.entities.DEU, 'FRA').opinion = 0

    for (let i = 0; i < 500; i++) advanceDiplomacy(state, fra)

    const rel = fra.relations.find((r) => r.otherEntityId === 'DEU')!
    expect(rel.opinion).toBeGreaterThan(0)
  })

  it('auto-promotes status to friendly once opinion clears the threshold via drift', () => {
    const state = createNewGame('USA')
    const fra = state.entities.FRA
    const rel = getOrCreateRelation(fra, 'DEU')
    rel.status = 'neutral'
    rel.opinion = 41 // already past the neutral -> friendly threshold

    advanceDiplomacy(state, fra)

    expect(rel.status).toBe('friendly')
  })

  it('auto-demotes status back to neutral once a hostile relation cools enough', () => {
    const state = createNewGame('USA')
    const ind = state.entities.IND
    const rel = getOrCreateRelation(ind, 'PAK')
    rel.status = 'hostile'
    rel.opinion = -15 // already past the hostile -> neutral threshold

    advanceDiplomacy(state, ind)

    expect(rel.status).toBe('neutral')
  })

  it('never touches an active war relation', () => {
    const state = createNewGame('USA')
    const ind = state.entities.IND
    const rel = getOrCreateRelation(ind, 'PAK')
    rel.status = 'war'
    rel.opinion = -80

    advanceDiplomacy(state, ind)

    expect(rel.opinion).toBe(-80)
    expect(rel.status).toBe('war')
  })
})
