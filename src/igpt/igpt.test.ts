import { describe, it, expect } from 'vitest'
import { produce } from 'immer'
import { createNewGame } from '@/simulation/newGame'
import { advanceTurn } from '@/simulation/engine/turnEngine'
import { validateAndApply } from '@/simulation/validators/actionValidator'
import { applySanction } from '@/simulation/modules/diplomacy'
import { applySanctionsAndTrade, budgetBalancePct } from '@/simulation/modules/economy'
import { buildWorldIndex } from './context'
import { think, wouldAcceptPeace } from './brain'
import { adviseCountry, runIgpt } from './igpt'
import { doctrineFor } from './doctrines'
import { evaluateOutcomes, OUTCOME_DELAY_TICKS, recordDecision, learnedBias } from './memory'

function fixedRng(seedValue: number) {
  let s = seedValue
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

describe('IGPT brain', () => {
  it('explains every decision and maps it to a command the validator accepts', () => {
    const state = createNewGame('USA')
    const advice = adviseCountry(state, 'USA')
    expect(advice.length).toBeGreaterThan(0)
    for (const d of advice) {
      expect(d.reasons.length).toBeGreaterThan(0)
      expect(d.summary.length).toBeGreaterThan(0)
      expect(d.action.actor).toBe('USA')
    }
    const result = validateAndApply(state, advice[0].action, state.turn)
    expect(result.ok).toBe(true)
  })

  it('backs Ukraine: Western countries consider sanctioning Russia', () => {
    const state = createNewGame('USA')
    const decisions = think(buildWorldIndex(state, 0), 'GBR')
    const sanction = decisions.find((d) => d.move === 'sanction' && d.targetId === 'RUS')
    expect(sanction).toBeDefined()
    expect(sanction!.reasons.join(' ')).toMatch(/attacking a country we back/)
  })

  it('never has a neutral country (Switzerland) consider war', () => {
    const state = produce(createNewGame('USA'), (d) => {
      d.entities.CHE.relations.push({ otherEntityId: 'LIE', opinion: -90, status: 'hostile', treatyIds: [] })
    })
    expect(doctrineFor(state.entities.CHE).neutral).toBe(true)
    expect(think(buildWorldIndex(state, 0), 'CHE').some((d) => d.move === 'declare_war')).toBe(false)
  })

  it('applies the "can\'t win" lesson to hopeless wars', () => {
    const state = produce(createNewGame('USA'), (d) => {
      // Cambodia, made furious at a much stronger Thailand.
      d.entities.KHM.relations = d.entities.KHM.relations.map((r) => (r.otherEntityId === 'THA' ? { ...r, opinion: -95, status: 'hostile' } : r))
    })
    const war = think(buildWorldIndex(state, 0), 'KHM').find((d) => d.move === 'declare_war' && d.targetId === 'THA')
    expect(war).toBeDefined()
    expect(war!.reasons.some((r) => r.includes("Never start a war you can't win"))).toBe(true)
    expect(war!.score).toBeLessThan(0)
  })

  it('a clearly winning side will not accept peace', () => {
    const index = buildWorldIndex(createNewGame('USA'), 10)
    expect(wouldAcceptPeace(index, 'RUS', { attackerIds: ['RUS'], warScore: 60, startTurn: 0 })).toBe(false)
    expect(wouldAcceptPeace(index, 'RUS', { attackerIds: ['RUS'], warScore: -20, startTurn: 0 })).toBe(true)
  })
})

describe('IGPT in the simulation', () => {
  it('leaves the player alone unless autopilot is on', () => {
    let state = createNewGame('FRA')
    const rng = fixedRng(5)
    // IGPT keeps a memory entry for every country it has acted for.
    for (let i = 0; i < 30; i++) state = advanceTurn(state, rng)
    expect(state.igpt.memory.FRA).toBeUndefined()
    expect(state.igpt.log.length).toBeGreaterThan(0)

    state = produce(state, (d) => {
      d.igpt.autopilot = true
    })
    for (let i = 0; i < 30; i++) state = advanceTurn(state, rng)
    expect(state.igpt.memory.FRA).toBeDefined()
  })

  it('learns from outcomes: a move that preceded a gain is favored', () => {
    const base = createNewGame('USA')
    const next = produce(base, (d) => {
      recordDecision(d, buildWorldIndex(d, 0), 'DEU', 'sign_trade')
      // Germany then grows a lot relative to the world.
      d.entities.DEU.economy.gdpUsd *= 3
      d.turn = OUTCOME_DELAY_TICKS
      evaluateOutcomes(d, buildWorldIndex(d, OUTCOME_DELAY_TICKS))
    })
    expect(next.igpt.memory.DEU.moves.sign_trade.n).toBe(1)
    expect(next.igpt.memory.DEU.pending).toHaveLength(0)
    expect(learnedBias(next, 'DEU', 'sign_trade')).toBeGreaterThan(0)
  })

  it('runs deterministically for a given seed', () => {
    const a = produce(createNewGame('USA'), (d) => runIgpt(d, 10, fixedRng(9)))
    const b = produce(createNewGame('USA'), (d) => runIgpt(d, 10, fixedRng(9)))
    expect(a.igpt.log.map((e) => e.summary)).toEqual(b.igpt.log.map((e) => e.summary))
  })
})

describe('economy rules IGPT relies on', () => {
  it('sanctions from a large economy drag on the target', () => {
    const base = createNewGame('USA')
    const sanctioned = produce(base, (d) => {
      applySanction(d, 'USA', 'IRN')
      applySanctionsAndTrade(d)
    })
    expect(sanctioned.entities.IRN.economy.gdpUsd).toBeLessThan(base.entities.IRN.economy.gdpUsd)
    expect(Object.keys(sanctioned.sanctions)).toContain('SANC-USA-IRN')
  })

  it('more military spending means a bigger deficit', () => {
    const state = createNewGame('USA')
    const more = produce(state, (d) => {
      d.entities.USA.economy.militarySpendingPctOfGdp += 3
    })
    expect(budgetBalancePct(more.entities.USA)).toBeCloseTo(budgetBalancePct(state.entities.USA) - 3)
  })
})
