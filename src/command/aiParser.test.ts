import { describe, it, expect, vi } from 'vitest'
import { createNewGame } from '@/simulation/newGame'
import type { ParseContext } from './types'

function ctx(worldState: ReturnType<typeof createNewGame>, playerEntityId: string): ParseContext {
  return { worldState, playerEntityId, selectedRegionId: null, lastEntityId: null, lastRegionId: null }
}

const mockCreate = vi.fn()

vi.mock('@/ai/localAiEngine', () => ({
  localAiEngine: {
    isReady: () => true,
    getEngine: () => ({ chat: { completions: { create: mockCreate } } }),
  },
}))

function mockStep(overrides: Record<string, unknown> = {}) {
  return {
    action: 'mobilize',
    targetName: null,
    organizationName: null,
    treatyType: null,
    quantity: 400000,
    unit: 'troops',
    percent: null,
    negated: true,
    note: null,
    ...overrides,
  }
}

function respondWith(steps: unknown[]) {
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ steps }) } }] })
}

// aiParser is imported after the mock above so it picks up the mocked engine.
const { aiParser } = await import('./aiParser')

describe('aiParser', () => {
  it('ignores a hallucinated negation when the input has no negation cue', async () => {
    respondWith([mockStep({ negated: true })])
    const state = createNewGame('USA')
    const result = await aiParser.parse('mobilize 400,000 troops', ctx(state, 'USA'))
    expect(result.ok).toBe(true)
    expect(result.plan?.steps[0]).toMatchObject({ action: 'mobilize', quantity: 400000, unit: 'troops' })
  })

  it('still respects a real negation in the input', async () => {
    respondWith([mockStep({ negated: true })])
    const state = createNewGame('USA')
    const result = await aiParser.parse("don't mobilize 400,000 troops", ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'unsupported' })
  })

  it('drops a hallucinated target name unrelated to the input', async () => {
    respondWith([mockStep({ negated: false, targetName: 'Iran' })])
    const state = createNewGame('USA')
    const result = await aiParser.parse('mobilize 400,000 troops', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'mobilize', target: null })
  })

  it('still grounds a typo-corrected target actually present in the input', async () => {
    respondWith([mockStep({ action: 'declare_war', negated: false, targetName: 'Israel', quantity: null, unit: null })])
    const state = createNewGame('USA')
    const result = await aiParser.parse('atack isreal', ctx(state, 'USA'))
    expect(result.plan?.steps[0]).toMatchObject({ action: 'declare_war', target: 'ISR' })
  })
})
