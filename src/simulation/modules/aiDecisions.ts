import type { WorldEntity, WorldState } from '@/domain/schemas'
import { militaryStrength } from './military'
import { applyDeclareWar, applyProposePeace } from './war'
import { applyFormAlliance } from './diplomacy'
import { applySetMilitarySpending } from './economy'
import { governmentCamp } from '@/domain/geopolitics'

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

  // Occasionally seek an alliance -- with an outright friendly relation if
  // there is one, otherwise a country that shares this one's ideological
  // camp or a hostile relation with the same rival ("the enemy of my
  // enemy"), which is what lets blocs form organically during play instead
  // of only existing where hand-seeded at world-gen.
  if (entity.allianceIds.length < 3 && rng() < 0.02) {
    const partnerId = findAlliancePartner(state, entity)
    if (partnerId) {
      applyFormAlliance(state, id, partnerId, turn)
      return
    }
  }

  // Drift military spending gently toward what stability/threat level implies.
  if (rng() < 0.05) {
    const threatened = entity.relations.some((r) => r.status === 'hostile' || r.status === 'war')
    const target = threatened ? entity.economy.militarySpendingPctOfGdp + 0.3 : entity.economy.militarySpendingPctOfGdp - 0.1
    applySetMilitarySpending(entity, Math.max(0.5, Math.min(15, target)))
  }
}

function findAlliancePartner(state: WorldState, entity: WorldEntity): string | null {
  const friendly = entity.relations.find((r) => r.status === 'friendly' && r.opinion > 40)
  if (friendly) return friendly.otherEntityId

  const myEnemies = new Set(entity.relations.filter((r) => r.status === 'hostile' || r.status === 'war').map((r) => r.otherEntityId))
  const myCamp = governmentCamp(entity.government.type)
  if (myEnemies.size === 0 && !myCamp) return null

  for (const other of Object.values(state.entities)) {
    if (other.id === entity.id) continue
    if (entity.allianceIds.some((tid) => other.allianceIds.includes(tid))) continue // already allied
    const rel = entity.relations.find((r) => r.otherEntityId === other.id)
    if (rel && (rel.status === 'hostile' || rel.status === 'war')) continue

    const sharesEnemy = other.relations.some((r) => (r.status === 'hostile' || r.status === 'war') && myEnemies.has(r.otherEntityId))
    const sameCamp = myCamp !== null && governmentCamp(other.government.type) === myCamp
    if (sharesEnemy || sameCamp) return other.id
  }
  return null
}
