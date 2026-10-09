import type { WorldState } from '@/domain/schemas'
import { applyDeclareWar, applyProposePeace } from '@/simulation/modules/war'
import {
  applyFormAlliance,
  applyImproveRelations,
  applyLiftSanction,
  applySanction,
  applySignTreaty,
  isSanctioning,
} from '@/simulation/modules/diplomacy'
import { applyResearchTech, applySendAid, applySetMilitarySpending, applySetTaxRate } from '@/simulation/modules/economy'
import { applyBuildUnits, applyDemobilize, applyMobilize } from '@/simulation/modules/military'
import { pushNews } from '@/simulation/modules/news'
import { atWarWith, buildWorldIndex, isAlive, type WorldIndex } from './context'
import { ACT_THRESHOLD, isInternalMove, think, type IgptDecision } from './brain'
import { evaluateOutcomes, recordDecision } from './memory'

/**
 * IGPT -- the game's internal decision engine. Runs entirely inside the
 * simulation worker: no language model, no network, no tokens. Every tick it
 * lets a rotating slice of countries think (countries at war think more
 * often), each picking its best foreign-policy move and its best domestic
 * move if they clear the action threshold.
 */
const PEACETIME_CADENCE = 10 // a country at peace reconsiders every 30 days
const WARTIME_CADENCE = 2 // ...at war, every 6 days
const MAX_LOG = 100

export function runIgpt(state: WorldState, turn: number, rng: () => number): void {
  const index = buildWorldIndex(state, turn)
  evaluateOutcomes(state, index)

  for (const entity of Object.values(state.entities)) {
    if (!isAlive(entity)) continue
    if (entity.id === state.playerEntityId && !state.igpt.autopilot) continue
    const cadence = index.wars.has(entity.id) ? WARTIME_CADENCE : PEACETIME_CADENCE
    if ((turn + hashId(entity.id)) % cadence !== 0) continue

    for (const decision of chooseActions(think(index, entity.id, { rng }))) {
      executeDecision(state, index, decision, turn)
    }
  }
}

/** The best foreign move and the best domestic move, each only if it clears
 *  the threshold -- a country can, say, sanction a rival AND raise taxes in
 *  the same round, but never declares two wars at once. */
export function chooseActions(decisions: IgptDecision[]): IgptDecision[] {
  const foreign = decisions.find((d) => !isInternalMove(d.move))
  const domestic = decisions.find((d) => isInternalMove(d.move))
  return [foreign, domestic].filter((d): d is IgptDecision => !!d && d.score >= ACT_THRESHOLD)
}

/** Ranked suggestions for a (usually the player's) country, from the same
 *  brain the AI countries use. Read-only: nothing is applied. */
export function adviseCountry(state: WorldState, entityId: string, limit = 6): IgptDecision[] {
  const index = buildWorldIndex(state, state.turn)
  const seen = new Set<string>()
  const out: IgptDecision[] = []
  for (const d of think(index, entityId)) {
    // One suggestion per move/target pair, and skip clearly bad ideas.
    const key = `${d.move}:${d.targetId ?? ''}`
    if (seen.has(key) || d.score < 0) continue
    seen.add(key)
    out.push(d)
    if (out.length >= limit) break
  }
  return out
}

function executeDecision(state: WorldState, index: WorldIndex, d: IgptDecision, turn: number): void {
  const actor = state.entities[d.actorId]
  const target = d.targetId ? state.entities[d.targetId] : null
  if (!actor) return
  const c = d.candidate
  const news = (headline: string, body: string, importance: 'minor' | 'medium' | 'major' = 'minor', category: 'diplomacy' | 'economy' | 'military' = 'diplomacy') =>
    pushNews(state, turn, headline, body, target ? [actor.id, target.id] : [actor.id], { category, importance, locationEntityId: actor.id })

  let done = true
  switch (d.move) {
    case 'declare_war':
      if (!target || atWarWith(index, actor.id, target.id) || state.wars[`WAR-${actor.id}-${target.id}-${turn}`]) return
      applyDeclareWar(state, actor.id, target.id, turn)
      break
    case 'propose_peace':
      if (!target) return
      done = applyProposePeace(state, actor.id, target.id, turn)
      break
    case 'sanction':
      if (!target || isSanctioning(state, actor.id, target.id)) return
      applySanction(state, actor.id, target.id)
      news(`${actor.name} sanctions ${target.name}`, `${actor.name} has imposed economic sanctions on ${target.name}.`, 'medium')
      break
    case 'lift_sanction':
      if (!target) return
      applyLiftSanction(state, actor.id, target.id)
      news(`${actor.name} lifts sanctions on ${target.name}`, `${actor.name} has lifted its sanctions on ${target.name} as relations improve.`)
      break
    case 'improve_relations':
      if (!target) return
      applyImproveRelations(state, actor.id, target.id)
      break
    case 'form_alliance':
      if (!target || index.allies.get(actor.id)?.has(target.id)) return
      applyFormAlliance(state, actor.id, target.id, turn)
      news(`${actor.name} and ${target.name} form an alliance`, `${actor.name} and ${target.name} have signed a mutual defense pact.`, 'major')
      break
    case 'sign_trade':
      if (!target) return
      applySignTreaty(state, actor.id, target.id, 'trade_agreement', turn)
      news(`${actor.name} and ${target.name} sign a trade agreement`, `A new trade agreement between ${actor.name} and ${target.name} is expected to boost both economies.`, 'minor', 'economy')
      break
    case 'send_aid':
      if (!target || !c.quantity) return
      done = applySendAid(actor, target, c.quantity)
      if (done) news(`${actor.name} sends aid to ${target.name}`, `${actor.name} has sent $${(c.quantity / 1e9).toFixed(1)}B in aid to ${target.name}.`)
      break
    case 'raise_military':
    case 'cut_military':
      if (c.percent === undefined) return
      applySetMilitarySpending(actor, c.percent)
      break
    case 'raise_taxes':
    case 'cut_taxes':
      if (c.percent === undefined) return
      applySetTaxRate(actor, c.percent)
      break
    case 'research':
      done = applyResearchTech(actor, c.quantity ?? 0)
      break
    case 'build_army':
      if (!c.unit || !c.quantity) return
      done = applyBuildUnits(actor, c.unit, c.quantity)
      break
    case 'mobilize':
      applyMobilize(actor, c.quantity ?? 0)
      break
    case 'demobilize':
      applyDemobilize(actor, c.quantity ?? 0)
      break
  }
  if (!done) return

  recordDecision(state, index, actor.id, d.move)
  const entry = { turn, actorId: actor.id, targetId: d.targetId, move: d.move, summary: `${actor.name}: ${d.summary}`, reasons: d.reasons.slice(0, 4) }
  pushBounded(state.igpt.log, entry)
  if (actor.id === state.playerEntityId) pushBounded(state.igpt.playerLog, entry)
}

function pushBounded<T>(list: T[], item: T): void {
  list.push(item)
  if (list.length > MAX_LOG) list.splice(0, list.length - MAX_LOG)
}

function hashId(id: string): number {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}
