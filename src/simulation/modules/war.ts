import type { WorldState, War, NewsCategory, NewsImportance, StoryStatus } from '@/domain/schemas'
import { militaryStrength } from './military'
import { setRelationStatus, adjustOpinion } from './diplomacy'
import { transferRegion } from './territory'
import { pushNews } from './news'
import { createStory, appendStoryStage } from './story'
import { buildWarNarrative } from './storyTemplates'

/** Declares war and links it to a persistent story -- either upgrading an
 *  already-developing story (e.g. a diplomatic_crisis that escalated all the
 *  way to war) if `existingStoryId` is given, or starting a fresh one. */
export function applyDeclareWar(state: WorldState, actorId: string, targetId: string, turn: number, existingStoryId?: string | null): string | null {
  const actor = state.entities[actorId]
  const target = state.entities[targetId]
  if (!actor || !target) return null
  const warId = `WAR-${actorId}-${targetId}-${turn}`

  setRelationStatus(state, actorId, targetId, 'war')
  const relOpinion = actor.relations.find((r) => r.otherEntityId === targetId)?.opinion ?? null
  const narrative = buildWarNarrative(actor, target, relOpinion)
  const title = `${actor.name.toUpperCase()} AND ${target.name.toUpperCase()} DESCEND INTO WAR`
  const body = `${actor.name} has formally declared war on ${target.name}.`

  const existing = existingStoryId ? state.storyEvents[existingStoryId] : null
  let storyId: string
  if (existing) {
    existing.type = 'war'
    existing.title = title
    appendStoryStage(state, existing.id, turn, {
      headline: title,
      body,
      category: 'war',
      importance: 'critical',
      locationEntityId: targetId,
      situation: narrative.situation,
      consequences: narrative.consequences,
      addCountryIds: [actorId, targetId],
    })
    storyId = existing.id
  } else {
    storyId = createStory(state, turn, {
      type: 'war',
      title,
      importance: 'critical',
      category: 'war',
      countryIds: [actorId, targetId],
      regionIds: target.territoryRegionIds.slice(0, 3),
      headline: title,
      body,
      locationEntityId: targetId,
      ...narrative,
    })
  }

  state.wars[warId] = {
    id: warId,
    attackerIds: [actorId],
    defenderIds: [targetId],
    startTurn: turn,
    endTurn: null,
    warGoal: 'conquest',
    contestedRegionIds: target.territoryRegionIds.slice(0, 10),
    warScore: 0,
    active: true,
    level: 4,
    isCivilWar: false,
    storyEventId: storyId,
  }
  return warId
}

/** Reports a development in an ongoing war -- appends to the linked story
 *  when one exists (the normal case), or falls back to a plain news item for
 *  wars with no story attached (hand-built in tests, or from an older save). */
function reportWarEvent(
  state: WorldState,
  war: War,
  turn: number,
  opts: {
    headline: string
    body: string
    category: NewsCategory
    importance: NewsImportance
    locationEntityId?: string | null
    locationRegionId?: string | null
    situation?: string
    consequences?: string
    status?: StoryStatus
    addCountryIds?: string[]
  },
): void {
  if (war.storyEventId) {
    appendStoryStage(state, war.storyEventId, turn, opts)
  } else {
    pushNews(state, turn, opts.headline, opts.body, [...war.attackerIds, ...war.defenderIds], {
      category: opts.category,
      importance: opts.importance,
      locationEntityId: opts.locationEntityId,
      locationRegionId: opts.locationRegionId,
    })
  }
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
  reportWarEvent(state, war, turn, {
    headline: `Ceasefire Ends Fighting Between ${actor?.name ?? actorId} and ${target?.name ?? targetId}`,
    body: `${actor?.name ?? actorId} and ${target?.name ?? targetId} have agreed to a ceasefire, bringing active hostilities to an end.`,
    category: 'war',
    importance: 'major',
    locationEntityId: actorId,
    consequences: 'Both sides are expected to begin reconstruction and reassess military posture following the end of hostilities.',
    status: 'resolved',
  })
  return true
}

/** Each turn: compare relative strength of each side, drift warScore, move
 *  the frontline by (at most) one region, pull in allies, and auto-resolve
 *  wars that reach a decisive outcome. */
export function advanceWars(state: WorldState, turn: number, rng: () => number): void {
  for (const war of Object.values(state.wars)) {
    if (!war.active) continue
    const attackerStrength = sumStrength(state, war.attackerIds)
    const defenderStrength = sumStrength(state, war.defenderIds)
    const total = attackerStrength + defenderStrength
    if (total <= 0) continue
    const balance = (attackerStrength - defenderStrength) / total // -1..1
    war.warScore = clamp(war.warScore + balance * 5, -100, 100)

    for (const a of war.attackerIds) for (const d of war.defenderIds) adjustOpinion(state, a, d, -1)

    advanceFrontline(state, war, balance, turn, rng)
    considerAllyDrawIn(state, war, turn, rng)
    updateWarLevel(war)

    if (attackerControlsAllContested(state, war) || war.warScore >= 90) {
      resolveWar(state, war, war.attackerIds[0], turn)
    } else if (war.warScore <= -90) {
      resolveWar(state, war, war.defenderIds[0], turn)
    }
  }
}

function attackerControlsAllContested(state: WorldState, war: War): boolean {
  if (war.contestedRegionIds.length === 0) return false
  return war.contestedRegionIds.every((id) => {
    const controller = state.regions[id]?.controllerId
    return controller && war.attackerIds.includes(controller)
  })
}

/** Flips at most one contested region per turn toward whichever side is
 *  currently winning -- this is what makes the front visibly creep instead of
 *  the whole war resolving in one instant flip at a score threshold. */
function advanceFrontline(state: WorldState, war: War, balance: number, turn: number, rng: () => number): void {
  if (war.contestedRegionIds.length === 0) return
  const leadingSide = balance > 0 ? war.attackerIds : war.defenderIds
  const losingSide = balance > 0 ? war.defenderIds : war.attackerIds
  const flippable = war.contestedRegionIds.filter((id) => {
    const controller = state.regions[id]?.controllerId
    return controller && losingSide.includes(controller)
  })
  if (flippable.length === 0) return

  const flipChance = Math.min(0.5, Math.abs(balance) * 0.4)
  if (rng() >= flipChance) return

  const regionId = flippable[Math.floor(rng() * flippable.length)]
  const region = state.regions[regionId]
  const winnerId = leadingSide[0]
  const winner = state.entities[winnerId]
  const recaptured = region.countryId === winnerId
  transferRegion(state, regionId, winnerId)
  reportWarEvent(state, war, turn, {
    headline: recaptured ? `${winner?.name ?? winnerId} Recaptures ${region.name}` : `${winner?.name ?? winnerId} Captures ${region.name}`,
    body: `${winner?.name ?? winnerId} has ${recaptured ? 'recaptured' : 'captured'} ${region.name} on the front line.`,
    category: war.isCivilWar ? 'civil_conflict' : 'war',
    importance: 'medium',
    locationRegionId: regionId,
  })
}

/** Countries allied with a side already in the war have a small per-turn
 *  chance of being drawn in alongside their ally -- this is what escalates a
 *  bilateral war into a regional/international one (see War.level). */
function considerAllyDrawIn(state: WorldState, war: War, turn: number, rng: () => number): void {
  const inWar = new Set([...war.attackerIds, ...war.defenderIds])
  for (const entity of Object.values(state.entities)) {
    if (inWar.has(entity.id) || entity.allianceIds.length === 0) continue
    const alliedWithAttacker = entity.allianceIds.some((tid) => state.treaties[tid]?.active && state.treaties[tid].memberIds.some((m) => war.attackerIds.includes(m)))
    const alliedWithDefender = entity.allianceIds.some((tid) => state.treaties[tid]?.active && state.treaties[tid].memberIds.some((m) => war.defenderIds.includes(m)))
    if (alliedWithAttacker === alliedWithDefender) continue
    if (rng() >= 0.04) continue

    if (alliedWithAttacker) war.attackerIds.push(entity.id)
    else war.defenderIds.push(entity.id)
    reportWarEvent(state, war, turn, {
      headline: `${entity.name} Joins the War`,
      body: `${entity.name} has entered the conflict in support of its ally.`,
      category: 'war',
      importance: 'major',
      locationEntityId: entity.id,
      addCountryIds: [entity.id],
    })
  }
}

function updateWarLevel(war: War): void {
  const participants = war.attackerIds.length + war.defenderIds.length
  if (participants >= 7) war.level = 7
  else if (participants >= 5) war.level = 6
  else if (participants >= 3) war.level = 5
  else war.level = 4
}

function resolveWar(state: WorldState, war: War, winnerId: string, turn: number): void {
  war.active = false
  war.endTurn = turn
  for (const regionId of war.contestedRegionIds) {
    transferRegion(state, regionId, winnerId)
  }
  for (const a of war.attackerIds) for (const d of war.defenderIds) setRelationStatus(state, a, d, 'hostile')
  const winner = state.entities[winnerId]
  reportWarEvent(state, war, turn, {
    headline: war.isCivilWar ? `Civil War in ${winner?.name ?? winnerId} Ends` : `${winner?.name ?? winnerId} Wins the War`,
    body: war.isCivilWar
      ? `The civil war has ended with ${winner?.name ?? winnerId} in control.`
      : `${winner?.name ?? winnerId} has prevailed and annexed contested territory.`,
    category: war.isCivilWar ? 'civil_conflict' : 'war',
    importance: 'critical',
    locationEntityId: winnerId,
    consequences: `Reconstruction and reintegration of contested territory are expected to dominate ${winner?.name ?? winnerId}'s agenda in the coming turns.`,
    status: 'resolved',
  })
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
