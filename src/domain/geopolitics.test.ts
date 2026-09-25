import { describe, it, expect } from 'vitest'
import { isHistoricalRivalry, governmentCamp, naturalEquilibrium } from './geopolitics'

describe('geopolitics', () => {
  it('recognizes a known historical rivalry in either direction', () => {
    expect(isHistoricalRivalry('IND', 'PAK')).toBe(true)
    expect(isHistoricalRivalry('PAK', 'IND')).toBe(true)
    expect(isHistoricalRivalry('IND', 'FRA')).toBe(false)
  })

  it('groups governments into open vs. autocratic camps', () => {
    expect(governmentCamp('democracy')).toBe('open')
    expect(governmentCamp('communist_state')).toBe('autocratic')
    expect(governmentCamp('authoritarian')).toBe('autocratic')
    expect(governmentCamp('monarchy')).toBeNull()
  })

  it('pulls a historical rivalry toward a strongly negative equilibrium regardless of government type', () => {
    expect(naturalEquilibrium('IND', 'democracy', 'PAK', 'democracy')).toBe(-50)
  })

  it('pulls same-camp governments toward a mild positive equilibrium', () => {
    expect(naturalEquilibrium('FRA', 'democracy', 'DEU', 'democracy')).toBeGreaterThan(0)
  })

  it('pulls opposite-camp governments toward a mild negative equilibrium', () => {
    expect(naturalEquilibrium('FRA', 'democracy', 'CHN', 'communist_state')).toBeLessThan(0)
  })

  it('leaves a camp-less government pair at neutral equilibrium', () => {
    expect(naturalEquilibrium('SAU', 'monarchy', 'FRA', 'democracy')).toBe(0)
  })
})
