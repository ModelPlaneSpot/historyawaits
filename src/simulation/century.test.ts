import { describe, it, expect } from 'vitest'
import { produce } from 'immer'
import { createNewGame } from './newGame'
import { advanceTurn, advanceTurns } from './engine/turnEngine'
import { FINAL_TICK, daysToTicks, formatGameDate, isGameOver, TURN_LENGTH_OPTIONS } from './gameDate'
import { computeStandings } from './victory'

function fixedRng(seedValue: number) {
  let s = seedValue
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

describe('game calendar', () => {
  it('runs in 3-day ticks from January 1, 2026 to January 1, 2126', () => {
    expect(formatGameDate(0)).toBe('January 1, 2026')
    expect(formatGameDate(1)).toBe('January 4, 2026')
    expect(formatGameDate(FINAL_TICK)).toBe('January 1, 2126')
    expect(formatGameDate(FINAL_TICK - 1)).toBe('December 30, 2125')
    expect(isGameOver(FINAL_TICK - 1)).toBe(false)
    expect(isGameOver(FINAL_TICK)).toBe(true)
  })

  it('turn lengths map to 1, 10, 20, 30 and 60 event rounds', () => {
    expect(TURN_LENGTH_OPTIONS.map((o) => daysToTicks(o.days))).toEqual([1, 10, 20, 30, 60])
  })

  it('never advances past the end of the game', () => {
    const state = produce(createNewGame('USA'), (d) => {
      d.turn = FINAL_TICK - 2
    })
    expect(advanceTurns(state, 60, fixedRng(1)).turn).toBe(FINAL_TICK)
  })
})

describe('event rounds', () => {
  it('produces at least one world event every tick', () => {
    let state = createNewGame('USA')
    const rng = fixedRng(7)
    for (let i = 0; i < 40; i++) {
      state = advanceTurn(state, rng)
      expect(state.news.some((n) => n.turn === state.turn)).toBe(true)
    }
  })
})

describe('opening scenario', () => {
  it('starts with the Russia-Ukraine war underway and Thailand-Cambodia tension', () => {
    const state = createNewGame('FRA')
    const war = state.wars['WAR-RUS-UKR-0']
    expect(war.active).toBe(true)
    expect(war.contestedRegionIds.length).toBeGreaterThan(0)
    expect(state.regions['UKR-329'].controllerId).toBe('RUS')
    const tha = state.entities.THA.relations.find((r) => r.otherEntityId === 'KHM')
    expect(tha?.status).toBe('hostile')
    expect(Object.values(state.storyEvents).some((s) => s.type === 'diplomatic_crisis' && s.countryIds.includes('KHM'))).toBe(true)
  })
})

describe('victory standings', () => {
  it('ranks every country in all three categories', () => {
    const standings = computeStandings(createNewGame('USA'))
    expect(standings.byCategory.territory[0].entityId).toBe('RUS')
    for (const s of standings.countries) {
      expect(s.ranks.territory).toBeGreaterThan(0)
      expect(s.ranks.economy).toBeGreaterThan(0)
      expect(s.ranks.military).toBeGreaterThan(0)
    }
    const totalWins = standings.countries.reduce((n, s) => n + s.categoriesWon, 0)
    expect(totalWins).toBe(3)
    expect(standings.overall[0].categoriesWon).toBeGreaterThanOrEqual(1)
  })

  it('debt lowers the economy score', () => {
    const base = createNewGame('USA')
    const indebted = produce(base, (d) => {
      d.entities.USA.economy.debtToGdpPct = 250
    })
    const a = computeStandings(base).countries.find((c) => c.entityId === 'USA')!
    const b = computeStandings(indebted).countries.find((c) => c.entityId === 'USA')!
    expect(b.economyScore).toBeLessThan(a.economyScore)
  })
})
