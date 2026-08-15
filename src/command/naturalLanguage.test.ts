import { describe, it, expect } from 'vitest'
import { fallbackParser } from './fallbackParser'
import { createNewGame } from '@/simulation/newGame'
import type { ParseContext } from './types'
import { resolveEntity, type ResolverIndex } from './entityResolver'
import { parseAnyNumber } from './numberParser'
import { correctText } from './spellCorrect'
import { isQuestion } from './intentClassifier'

function ctx(
  worldState: ReturnType<typeof createNewGame>,
  playerEntityId: string,
  overrides: Partial<ParseContext> = {},
): ParseContext {
  return { worldState, playerEntityId, selectedRegionId: null, lastEntityId: null, lastRegionId: null, ...overrides }
}

describe('numberParser', () => {
  it('parses every natural form of one hundred thousand the same way', () => {
    for (const phrase of ['100000', '100,000', '100k', 'one hundred thousand', 'a hundred thousand', '100 thousand']) {
      expect(parseAnyNumber(phrase)).toBe(100000)
    }
  })
  it('parses million/billion and mixed forms', () => {
    expect(parseAnyNumber('1.5m')).toBe(1_500_000)
    expect(parseAnyNumber('two million')).toBe(2_000_000)
    expect(parseAnyNumber('twenty')).toBe(20)
  })
  it('returns null for non-numbers', () => {
    expect(parseAnyNumber('france')).toBeNull()
  })
})

describe('spellCorrect', () => {
  it('fixes common command-vocabulary typos', () => {
    expect(correctText('atack iran')).toBe('attack iran')
    expect(correctText('invde camboda')).toBe('invade camboda')
    expect(correctText('increse millitary spendng')).toBe('increase military spending')
    expect(correctText('moblize 100k')).toBe('mobilize 100k')
    expect(correctText('start peacetalks with ukrane')).toBe('start peace talks with ukrane')
  })
  it('does not touch words that are not close to any vocabulary word', () => {
    expect(correctText('france')).toBe('france')
    expect(correctText('chad')).toBe('chad')
  })
})

describe('intentClassifier', () => {
  it('recognizes questions', () => {
    expect(isQuestion('Should we attack Iran?')).toBe(true)
    expect(isQuestion('What would happen if we attacked Iran?')).toBe(true)
    expect(isQuestion('Can we invade Iran?')).toBe(true)
  })
  it('does not treat statements of intent as questions', () => {
    expect(isQuestion('I think we should start preparing for a possible war with Iran.')).toBe(false)
    expect(isQuestion('Attack Iran.')).toBe(false)
  })
})

describe('entityResolver ambiguity', () => {
  it('refuses to guess between two near-tied fuzzy candidates', () => {
    // "mercia" and "merlia" are each exactly one substitution away from the
    // query "merdia" -- equally plausible, so this must ask, not guess.
    const index: ResolverIndex = {
      entities: new Map([
        ['mercia', 'MEC'],
        ['merlia', 'MEL'],
      ]),
      regions: new Map(),
      organizations: new Map(),
      displayNames: new Map([
        ['MEC', 'Mercia'],
        ['MEL', 'Merlia'],
      ]),
    }
    const r = resolveEntity('merdia', index)
    expect(r.ambiguous).toBe(true)
    expect(r.id).toBeNull()
    expect(r.alternatives.length).toBeGreaterThanOrEqual(2)
  })

  it('picks a clear winner when only one candidate is close', () => {
    const index: ResolverIndex = {
      entities: new Map([
        ['germany', 'DEU'],
        ['ghana', 'GHA'],
      ]),
      regions: new Map(),
      organizations: new Map(),
      displayNames: new Map([
        ['DEU', 'Germany'],
        ['GHA', 'Ghana'],
      ]),
    }
    const r = resolveEntity('germeny', index)
    expect(r.ambiguous).toBe(false)
    expect(r.id).toBe('DEU')
  })
})

describe('fallback parser: spelling and phrasing tolerance (spec final test list)', () => {
  it('atack iran -> declare war on Iran', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('atack iran', ctx(state, 'USA'))
    expect(result.ok).toBe(true)
    expect(result.plan?.steps[0]).toMatchObject({ action: 'declare_war', target: 'IRN' })
  })

  it('invde camboda -> declare war on Cambodia (typo in the entity name)', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('invde camboda', ctx(state, 'USA'))
    expect(result.ok).toBe(true)
    expect(result.plan?.steps[0]).toMatchObject({ action: 'declare_war', target: 'KHM' })
  })

  it('moblize 100k -> mobilize 100,000 troops', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('moblize 100k', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'mobilize', quantity: 100000 })
  })

  it('increse millitary spendng -> understood as a spending increase even with no explicit number', async () => {
    const state = createNewGame('USA')
    const before = state.entities.USA.economy.militarySpendingPctOfGdp
    const result = await fallbackParser.parse('increse millitary spendng', ctx(state, 'USA'))
    expect(result.plan?.steps[0].action).toBe('set_military_spending')
    expect(result.plan?.steps[0].percent).toBeGreaterThan(before)
  })

  it('stop fightng with russia -> propose peace with Russia', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('stop fightng with russia', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'propose_peace', target: 'RUS' })
  })

  it('start peacetalks with ukrane -> propose peace with Ukraine', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('start peacetalks with ukrane', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'propose_peace', target: 'UKR' })
  })

  it('make frnce our ally -> form an alliance with France', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('make frnce our ally', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'form_alliance', target: 'FRA' })
  })

  it('send troops north -> honestly unsupported (no border-level troop tracking), not silently dropped', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('send troops north', ctx(state, 'USA'))
    expect(result.plan?.steps[0].action).toBe('unsupported')
    expect(result.plan?.steps[0].note).toBeTruthy()
  })
})

describe('fallback parser: intent over keywords', () => {
  it('"we need France on our side" -> improve relations with France', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('we need France on our side.', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'improve_relations', target: 'FRA' })
  })

  it('"we need more tanks" -> build_units tanks with an assumed quantity', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('we need more tanks', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'build_units', unit: 'tanks' })
    expect(result.plan?.steps[0].quantity).toBeGreaterThan(0)
  })

  it('"make the army much bigger" -> mobilize with an assumed quantity', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('make the army much bigger', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'mobilize' })
    expect(result.plan?.steps[0].quantity).toBeGreaterThan(0)
  })

  it('"shut down imports from Russia" -> sanction Russia, honestly framed as an approximation', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('shut down imports from Russia', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'sanction', target: 'RUS' })
    expect(result.plan?.steps[0].note).toBeTruthy()
  })

  it('"fix our economy" does not pretend there is one obvious action', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('fix our economy', ctx(state, 'USA'))
    expect(result.plan?.steps[0].action).toBe('unsupported')
    expect(result.plan?.steps[0].note).toMatch(/tax|spending|research/i)
  })

  it('"I don\'t want to depend on foreign oil anymore" is honestly unsupported, not faked', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse("I don't want to depend on foreign oil anymore.", ctx(state, 'USA'))
    expect(result.plan?.steps[0].action).toBe('unsupported')
  })
})

describe('fallback parser: preparation vs execution', () => {
  it('"prepare an invasion of Iran" raises readiness but does NOT declare war', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('prepare an invasion of Iran', ctx(state, 'USA'))
    expect(result.plan?.steps[0].action).toBe('set_readiness')
    expect(result.plan?.steps.some((s) => s.action === 'declare_war')).toBe(false)
  })

  it('"launch the invasion of Iran" DOES declare war', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('launch the invasion of Iran', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'declare_war', target: 'IRN' })
  })

  it('"I think we should start preparing for a possible war with Iran" raises readiness, not war', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('I think we should start preparing for a possible war with Iran.', ctx(state, 'USA'))
    expect(result.plan?.steps.some((s) => s.action === 'declare_war')).toBe(false)
    expect(result.plan?.steps.some((s) => s.action === 'set_readiness')).toBe(true)
  })
})

describe('fallback parser: questions must not become commands', () => {
  it('"Should we attack Iran?" does not execute anything', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('Should we attack Iran?', ctx(state, 'USA'))
    expect(result.ok).toBe(false)
    expect(result.plan).toBeNull()
  })

  it('"What would happen if we attacked Iran?" does not execute anything', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('What would happen if we attacked Iran?', ctx(state, 'USA'))
    expect(result.ok).toBe(false)
    expect(result.plan).toBeNull()
  })

  it('"Attack Iran." (no question mark) DOES execute', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('Attack Iran.', ctx(state, 'USA'))
    expect(result.ok).toBe(true)
    expect(result.plan?.steps[0]).toMatchObject({ action: 'declare_war', target: 'IRN' })
  })
})

describe('fallback parser: negation', () => {
  it('"Don\'t attack Iran" does not declare war', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse("Don't attack Iran.", ctx(state, 'USA'))
    expect(result.plan?.steps.every((s) => s.action !== 'declare_war')).toBe(true)
  })

  it('"Stop mobilizing" acknowledges without mobilizing', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('Stop mobilizing.', ctx(state, 'USA'))
    expect(result.plan?.steps.every((s) => s.action !== 'mobilize')).toBe(true)
  })
})

describe('fallback parser: corrections', () => {
  it('"attack Iran, actually I meant Iraq" targets only Iraq', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('attack Iran, actually I meant Iraq', ctx(state, 'USA'))
    expect(result.ok).toBe(true)
    const warSteps = result.plan?.steps.filter((s) => s.action === 'declare_war') ?? []
    expect(warSteps).toHaveLength(1)
    expect(warSteps[0].target).toBe('IRQ')
  })
})

describe('fallback parser: pronoun/context resolution', () => {
  it('"attack them" resolves to the last entity referenced', async () => {
    const state = createNewGame('USA')
    const result = await fallbackParser.parse('attack them', ctx(state, 'USA', { lastEntityId: 'IRN' }))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'declare_war', target: 'IRN' })
  })

  it('"annex there" resolves to the last region referenced', async () => {
    const state = createNewGame('ISR')
    const result = await fallbackParser.parse('annex there', ctx(state, 'ISR', { lastRegionId: 'PSE-GAZA' }))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'annex', target: 'PSE-GAZA' })
  })
})

describe('fallback parser: unit abbreviations', () => {
  it('recognizes IFV and SAM as approximated unit types', async () => {
    const state = createNewGame('USA')
    const ifv = await fallbackParser.parse('build 10 IFVs', ctx(state, 'USA'))
    expect(ifv.plan?.steps[0]).toMatchObject({ action: 'build_units', unit: 'tanks', quantity: 10 })
    const sam = await fallbackParser.parse('build 5 SAMs', ctx(state, 'USA'))
    expect(sam.plan?.steps[0]).toMatchObject({ action: 'build_units', unit: 'artillery', quantity: 5 })
  })
})

describe('fallback parser: relative multipliers', () => {
  it('double/triple/half apply to the current value', async () => {
    const state = createNewGame('USA')
    const before = state.entities.USA.economy.taxRatePct
    const result = await fallbackParser.parse('double taxes', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'set_tax_rate' })
    expect(result.plan?.steps[0].percent).toBeCloseTo(before * 2, 5)
  })
})
