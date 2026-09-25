import type { WorldState, WorldEntity, RelationStatus, TreatyKind } from '@/domain/schemas'
import { naturalEquilibrium } from '@/domain/geopolitics'

export function getOrCreateRelation(entity: WorldEntity, otherId: string) {
  let rel = entity.relations.find((r) => r.otherEntityId === otherId)
  if (!rel) {
    rel = { otherEntityId: otherId, opinion: 0, status: 'neutral' as RelationStatus, treatyIds: [] }
    entity.relations.push(rel)
  }
  return rel
}

/** Relations drift slowly each turn toward a natural equilibrium -- not
 *  always neutral -- so historical rivals stay tense and ideologically
 *  aligned/opposed governments settle into loose blocs on their own, without
 *  the player or any AI decision needing to do anything. Event-driven changes
 *  (war entry, treaties, explicit diplomacy actions) still happen instantly
 *  via the apply* functions below; this only governs passive drift, and
 *  passive drift can also nudge status across the same thresholds
 *  applyImproveRelations uses, so a bloc can cool into (or freeze out of)
 *  friendliness/hostility purely from ideology and history. */
export function advanceDiplomacy(state: WorldState, entity: WorldEntity): void {
  for (const rel of entity.relations) {
    if (rel.status === 'war') continue
    const other = state.entities[rel.otherEntityId]
    const equilibrium = other ? naturalEquilibrium(entity.id, entity.government.type, other.id, other.government.type) : 0
    rel.opinion += (equilibrium - rel.opinion) * 0.01

    if (rel.status === 'allied') continue
    if (rel.status === 'hostile' && rel.opinion > -20) rel.status = 'neutral'
    else if (rel.status === 'neutral' && rel.opinion > 40) rel.status = 'friendly'
    else if (rel.status === 'friendly' && rel.opinion < 15) rel.status = 'neutral'
    else if (rel.status !== 'friendly' && rel.opinion < -50) rel.status = 'hostile'
  }
}

export function setRelationStatus(state: WorldState, aId: string, bId: string, status: RelationStatus): void {
  const a = state.entities[aId]
  const b = state.entities[bId]
  if (!a || !b) return
  getOrCreateRelation(a, bId).status = status
  getOrCreateRelation(b, aId).status = status
}

export function adjustOpinion(state: WorldState, aId: string, bId: string, delta: number): void {
  const a = state.entities[aId]
  const b = state.entities[bId]
  if (!a || !b) return
  const relA = getOrCreateRelation(a, bId)
  const relB = getOrCreateRelation(b, aId)
  relA.opinion = Math.min(100, Math.max(-100, relA.opinion + delta))
  relB.opinion = Math.min(100, Math.max(-100, relB.opinion + delta))
}

export function applyFormAlliance(state: WorldState, actorId: string, targetId: string, turn: number): string | null {
  const actor = state.entities[actorId]
  const target = state.entities[targetId]
  if (!actor || !target) return null
  const id = `TREATY-${actorId}-${targetId}-${turn}`
  state.treaties[id] = {
    id,
    type: 'defense_pact',
    memberIds: [actorId, targetId],
    signedTurn: turn,
    active: true,
  }
  actor.allianceIds.push(id)
  target.allianceIds.push(id)
  setRelationStatus(state, actorId, targetId, 'allied')
  return id
}

export function applyBreakAlliance(state: WorldState, actorId: string, targetId: string): void {
  const actor = state.entities[actorId]
  const target = state.entities[targetId]
  if (!actor || !target) return
  for (const treatyId of [...actor.allianceIds]) {
    const treaty = state.treaties[treatyId]
    if (treaty && treaty.memberIds.includes(targetId)) {
      treaty.active = false
      actor.allianceIds = actor.allianceIds.filter((id) => id !== treatyId)
      target.allianceIds = target.allianceIds.filter((id) => id !== treatyId)
    }
  }
  setRelationStatus(state, actorId, targetId, 'neutral')
}

export function applySignTreaty(
  state: WorldState,
  actorId: string,
  targetId: string,
  type: TreatyKind,
  turn: number,
): string | null {
  const actor = state.entities[actorId]
  const target = state.entities[targetId]
  if (!actor || !target) return null
  const id = `TREATY-${type}-${actorId}-${targetId}-${turn}`
  state.treaties[id] = { id, type, memberIds: [actorId, targetId], signedTurn: turn, active: true }
  if (type === 'defense_pact') {
    actor.allianceIds.push(id)
    target.allianceIds.push(id)
  }
  adjustOpinion(state, actorId, targetId, 15)
  return id
}

export function applySanction(state: WorldState, actorId: string, targetId: string): void {
  setRelationStatus(state, actorId, targetId, 'hostile')
  adjustOpinion(state, actorId, targetId, -20)
}

export function applyLiftSanction(state: WorldState, actorId: string, targetId: string): void {
  setRelationStatus(state, actorId, targetId, 'neutral')
}

export function applyRecognize(state: WorldState, actorId: string, targetId: string): void {
  const target = state.entities[targetId]
  if (target?.kind === 'disputed_entity') target.recognitionCount += 1
  adjustOpinion(state, actorId, targetId, 25)
}

export function applyWithdrawRecognition(state: WorldState, actorId: string, targetId: string): void {
  const target = state.entities[targetId]
  if (target?.kind === 'disputed_entity') target.recognitionCount = Math.max(0, target.recognitionCount - 1)
  adjustOpinion(state, actorId, targetId, -25)
}

export function applyImproveRelations(state: WorldState, actorId: string, targetId: string): void {
  adjustOpinion(state, actorId, targetId, 20)
  const rel = state.entities[actorId]?.relations.find((r) => r.otherEntityId === targetId)
  if (!rel) return
  if (rel.status === 'hostile' && rel.opinion > -20) setRelationStatus(state, actorId, targetId, 'neutral')
  else if (rel.status === 'neutral' && rel.opinion > 40) setRelationStatus(state, actorId, targetId, 'friendly')
}
