import type { WorldState } from '@/domain/schemas'
import { militaryStrength } from './military'
import { applyDeclareWar, applyProposePeace } from './war'
import { applyFormAlliance } from './diplomacy'
import { applySetMilitarySpending } from './economy'

/** AI-controlled nations use cheap scripted heuristics, never the local LLM --
 *  that keeps the simulation deterministic and avoids per-turn model latency
 *  across ~195 countries. Entities at war are re-evaluated every turn; others
 *  round-robin through a bounded slice per turn to keep cost flat as the
 *  roster grows. */
const PEACETIME_SLICE = 12

export function runAiDecisions(state: WorldState, turn: number, rng: () => number): void {
  const allIds = Object.keys(state.entities).filter((id) => id !== state.playerEntityId)
  const atWarIds = allIds.filter((id) =>
    Object.values(state.wars).some((w) => w.active && (w.attackerIds.includes(id) || w.defenderIds.includes(id))),
  )
  const peacetimeIds = allIds.filter((id) => !atWarIds.includes(id))
  const start = (turn * PEACETIME_SLICE) % Math.max(1, peacetimeIds.length)
  const slice = peacetimeIds.slice(start, start + PEACETIME_SLICE)

  for (const id of atWarIds) considerWartimeAction(state, id, turn, rng)
  for (const id of slice) considerPeacetimeAction(state, id, turn, rng)
}

function considerWartimeAction(state: WorldState, id: string, turn: number, rng: () => number): void {
  const entity = state.entities[id]
  if (!entity) return
  const war = Object.values(state.wars).find(
    (w) => w.active && (w.attackerIds.includes(id) || w.defenderIds.includes(id)),
  )
  if (!war) return
  const isAttacker = war.attackerIds.includes(id)
  const losing = isAttacker ? war.warScore < -40 : war.warScore > 40
  if (losing && rng() < 0.15) {
    const opponents = isAttacker ? war.defenderIds : war.attackerIds
    applyProposePeace(state, id, opponents[0], turn)
  }
}

function considerPeacetimeAction(state: WorldState, id: string, turn: number, rng: () => number): void {
  const entity = state.entities[id]
  if (!entity) return

  // Occasionally respond to a hostile, weaker neighbor by declaring war.
  const hostileRel = entity.relations.find((r) => r.status === 'hostile' && r.opinion < -50)
  if (hostileRel && rng() < 0.03) {
    const target = state.entities[hostileRel.otherEntityId]
    if (target && militaryStrength(entity) > militaryStrength(target) * 1.3) {
      applyDeclareWar(state, id, hostileRel.otherEntityId, turn)
      return
    }
  }

  // Occasionally seek an alliance with a friendly neighbor.
  const friendlyRel = entity.relations.find((r) => r.status === 'friendly' && r.opinion > 40)
  if (friendlyRel && entity.allianceIds.length < 3 && rng() < 0.02) {
    applyFormAlliance(state, id, friendlyRel.otherEntityId, turn)
    return
  }

  // Drift military spending gently toward what stability/threat level implies.
  if (rng() < 0.05) {
    const threatened = entity.relations.some((r) => r.status === 'hostile' || r.status === 'war')
    const target = threatened ? entity.economy.militarySpendingPctOfGdp + 0.3 : entity.economy.militarySpendingPctOfGdp - 0.1
    applySetMilitarySpending(entity, Math.max(0.5, Math.min(15, target)))
  }
}
