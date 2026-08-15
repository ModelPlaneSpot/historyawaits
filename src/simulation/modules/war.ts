import type { WorldState } from '@/domain/schemas'
import { militaryStrength } from './military'
import { setRelationStatus, adjustOpinion } from './diplomacy'
import { transferRegion } from './territory'
import { pushNews } from './news'

export function applyDeclareWar(state: WorldState, actorId: string, targetId: string, turn: number): string | null {
  const actor = state.entities[actorId]
  const target = state.entities[targetId]
  if (!actor || !target) return null
  const id = `WAR-${actorId}-${targetId}-${turn}`
  state.wars[id] = {
    id,
    attackerIds: [actorId],
    defenderIds: [targetId],
    startTurn: turn,
    endTurn: null,
    warGoal: 'conquest',
    contestedRegionIds: target.territoryRegionIds.slice(0, 10),
    warScore: 0,
    active: true,
  }
  setRelationStatus(state, actorId, targetId, 'war')
  pushNews(state, turn, `${actor.name} declares war on ${target.name}`, `${actor.name} has formally declared war on ${target.name}.`, [actorId, targetId], 'major')
  return id
}

export function applyProposePeace(state: WorldState, actorId: string, targetId: string, turn: number): boolean {
  const war = Object.values(state.wars).find(
    (w) => w.active && (
      (w.attackerIds.includes(actorId) && w.defenderIds.includes(targetId)) ||
      (w.attackerIds.includes(targetId) && w.defenderIds.includes(actorId))
    ),
  )
  if (!war) return false
  war.active = false
  war.endTurn = turn
  for (const a of war.attackerIds) for (const d of war.defenderIds) setRelationStatus(state, a, d, 'hostile')
  const actor = state.entities[actorId]
  const target = state.entities[targetId]
  pushNews(state, turn, `Peace between ${actor?.name ?? actorId} and ${target?.name ?? targetId}`, 'A ceasefire has been agreed.', [actorId, targetId], 'notable')
  return true
}

/** Each turn: compare relative strength of each side, drift warScore, and
 *  auto-resolve wars that reach a decisive threshold by transferring the
 *  contested regions to whichever side is winning. */
export function advanceWars(state: WorldState, turn: number): void {
  for (const war of Object.values(state.wars)) {
    if (!war.active) continue
    const attackerStrength = sumStrength(state, war.attackerIds)
    const defenderStrength = sumStrength(state, war.defenderIds)
    const total = attackerStrength + defenderStrength
    if (total <= 0) continue
    const balance = (attackerStrength - defenderStrength) / total // -1..1
    war.warScore = clamp(war.warScore + balance * 5, -100, 100)

    for (const a of war.attackerIds) for (const d of war.defenderIds) adjustOpinion(state, a, d, -1)

    if (war.warScore >= 75) {
      resolveWar(state, war, war.attackerIds[0], turn)
    } else if (war.warScore <= -75) {
      resolveWar(state, war, war.defenderIds[0], turn)
    }
  }
}

function resolveWar(state: WorldState, war: WorldState['wars'][string], winnerId: string, turn: number): void {
  war.active = false
  war.endTurn = turn
  for (const regionId of war.contestedRegionIds) {
    transferRegion(state, regionId, winnerId)
  }
  for (const a of war.attackerIds) for (const d of war.defenderIds) setRelationStatus(state, a, d, 'hostile')
  const winner = state.entities[winnerId]
  pushNews(state, turn, `${winner?.name ?? winnerId} wins the war`, `${winner?.name ?? winnerId} has prevailed and annexed contested territory.`, [...war.attackerIds, ...war.defenderIds], 'major')
}

function sumStrength(state: WorldState, ids: string[]): number {
  return ids.reduce((sum, id) => {
    const e = state.entities[id]
    return sum + (e ? militaryStrength(e) : 0)
  }, 0)
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}
