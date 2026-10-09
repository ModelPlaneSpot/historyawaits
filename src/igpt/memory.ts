import type { IgptCountryMemory, IgptMove, IgptMoveStats, WorldState } from '@/domain/schemas'
import type { WorldIndex } from './context'

/**
 * IGPT's learning: every decision is judged ~3 months later by how the
 * country's victory-race fitness changed *relative to the world average*
 * (so a global boom or recession doesn't count as the decision's doing).
 * Results are kept as a running average per move, per country and
 * world-wide, and nudge future scores up or down. This is what lets a
 * country "learn" that, say, its wars keep backfiring.
 */
export const OUTCOME_DELAY_TICKS = 30 // ~90 days
const MAX_PENDING = 6
/** Weight of the newest outcome in the running average. */
const LEARNING_RATE = 0.25
/** Reward is a fitness delta (log scale); scale it into score units. */
const REWARD_TO_SCORE = 8
const MAX_BIAS = 0.3

export function getMemory(state: WorldState, entityId: string): IgptCountryMemory {
  let mem = state.igpt.memory[entityId]
  if (!mem) {
    mem = { moves: {}, pending: [], lastWarTurn: null }
    state.igpt.memory[entityId] = mem
  }
  return mem
}

/** How much past experience favors (+) or discourages (-) this move. Blends
 *  the country's own experience with what everyone has learned, trusting
 *  its own record more as it accumulates. */
export function learnedBias(state: WorldState, entityId: string, move: IgptMove): number {
  const own = state.igpt.memory[entityId]?.moves[move]
  const world = state.igpt.global[move]
  const ownWeight = own ? Math.min(1, own.n / 5) : 0
  const raw = (own?.reward ?? 0) * ownWeight + (world?.reward ?? 0) * (1 - ownWeight)
  return Math.max(-MAX_BIAS, Math.min(MAX_BIAS, raw * REWARD_TO_SCORE))
}

export function recordDecision(state: WorldState, index: WorldIndex, entityId: string, move: IgptMove): void {
  const mem = getMemory(state, entityId)
  mem.pending.push({ move, turn: index.turn, fitness: index.fitness.get(entityId) ?? 0, worldFitness: index.worldFitness })
  if (mem.pending.length > MAX_PENDING) mem.pending.splice(0, mem.pending.length - MAX_PENDING)
  if (move === 'declare_war') mem.lastWarTurn = index.turn
}

/** Judges every decision that has had time to play out. */
export function evaluateOutcomes(state: WorldState, index: WorldIndex): void {
  for (const [entityId, mem] of Object.entries(state.igpt.memory)) {
    if (mem.pending.length === 0 || index.turn - mem.pending[0].turn < OUTCOME_DELAY_TICKS) continue
    const now = index.fitness.get(entityId)
    const due = mem.pending.filter((p) => index.turn - p.turn >= OUTCOME_DELAY_TICKS)
    mem.pending = mem.pending.filter((p) => index.turn - p.turn < OUTCOME_DELAY_TICKS)
    if (now === undefined) continue // country no longer exists to judge
    for (const p of due) {
      const reward = now - p.fitness - (index.worldFitness - p.worldFitness)
      learn((mem.moves[p.move] ??= { n: 0, reward: 0 }), reward)
      learn((state.igpt.global[p.move] ??= { n: 0, reward: 0 }), reward)
    }
  }
}

function learn(stats: IgptMoveStats, reward: number): void {
  const clipped = Math.max(-0.05, Math.min(0.05, reward))
  stats.reward = stats.n === 0 ? clipped : stats.reward + (clipped - stats.reward) * LEARNING_RATE
  stats.n += 1
}
