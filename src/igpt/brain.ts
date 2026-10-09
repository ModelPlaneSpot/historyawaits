import type { IgptMove, StructuredAction, WorldEntity } from '@/domain/schemas'
import { UNIT_COST_USD, equipmentValueUsd, maintainableEquipmentUsd } from '@/simulation/modules/military'
import { isSanctioning } from '@/simulation/modules/diplomacy'
import { atWarWith, effectiveDefense, isAlive, type WorldIndex } from './context'
import { LESSONS, type Candidate, type Situation } from './lessons'
import { learnedBias } from './memory'
import { yearsToTicks } from '@/simulation/gameDate'
import { budgetBalancePct } from '@/simulation/modules/economy'
import { DEFENDER_ADVANTAGE } from '@/simulation/modules/war'

/** A scored, explained decision IGPT would make for a country. */
export interface IgptDecision {
  move: IgptMove
  actorId: string
  targetId: string | null
  score: number
  /** Plain-English reasons, strongest first. */
  reasons: string[]
  summary: string
  /** The same decision as an ordinary command, for the action validator. */
  action: StructuredAction
  candidate: Candidate
}

/** Below this score IGPT prefers to do nothing this round. */
export const ACT_THRESHOLD = 0.3
const WAR_COOLDOWN_TICKS = yearsToTicks(3)
const MAX_TARGETS = 30
const MAX_SANCTIONS = 6
const MAX_TRADE_DEALS = 8
const WAR_COST = 0.15
/** A war must run this long before a side considers peace, unless collapsing. */
const MIN_WAR_TICKS = 40

const INTERNAL_MOVES = new Set<IgptMove>(['raise_military', 'cut_military', 'raise_taxes', 'cut_taxes', 'research', 'build_army', 'mobilize', 'demobilize'])
export function isInternalMove(move: IgptMove): boolean {
  return INTERNAL_MOVES.has(move)
}

export interface ThinkOptions {
  /** Random tie-break noise (AI countries); omit for stable player advice. */
  rng?: () => number
}

/** Every option this country has right now, scored and explained, best first. */
export function think(index: WorldIndex, actorId: string, opts: ThinkOptions = {}): IgptDecision[] {
  const self = index.state.entities[actorId]
  if (!self || !isAlive(self)) return []
  const sit = situation(index, self)
  const candidates = [...targetedCandidates(index, sit), ...internalCandidates(sit)]

  const decisions = candidates.map((c) => {
    let score = c.base
    const reasons = [...c.reasons]
    for (const lesson of LESSONS) {
      if (!lesson.moves.includes(c.move) || !lesson.applies(sit, c, index)) continue
      score += lesson.delta
      reasons.push(`${lesson.delta > 0 ? 'Lesson' : 'Caution'}: ${lesson.text}`)
    }
    const bias = learnedBias(index.state, actorId, c.move)
    if (Math.abs(bias) >= 0.05) {
      score += bias
      reasons.push(bias > 0 ? 'Experience: this has paid off before.' : 'Experience: this has backfired before.')
    }
    if (opts.rng) score += (opts.rng() - 0.5) * 0.06
    return { move: c.move, actorId, targetId: c.targetId, score, reasons, summary: describe(index, self, c), action: toAction(actorId, c), candidate: c }
  })

  return decisions.sort((a, b) => b.score - a.score)
}

function situation(index: WorldIndex, self: WorldEntity): Situation {
  const doctrine = index.doctrines.get(self.id)!
  const strength = index.strength.get(self.id) ?? 0
  const allies = index.allies.get(self.id)
  const watch = new Set([...(index.neighbors.get(self.id) ?? []), ...(doctrine.rivals ?? []), ...(doctrine.claims ?? [])])
  for (const r of self.relations) if (r.status === 'war' || r.opinion < -40) watch.add(r.otherEntityId)

  let threat = 0
  let threatSourceId: string | null = null
  for (const id of watch) {
    if (allies?.has(id) || !index.strength.has(id)) continue
    const rel = self.relations.find((r) => r.otherEntityId === id)
    const hostile = rel?.status === 'war' || (rel?.opinion ?? 0) < -40 || (doctrine.rivals ?? []).includes(id)
    if (!hostile) continue
    const t = effectiveDefense(index, id) / Math.max(1, strength)
    if (t > threat) {
      threat = t
      threatSourceId = id
    }
  }
  return {
    self,
    doctrine,
    strength,
    threat: Math.min(3, threat),
    threatSourceId,
    wars: index.wars.get(self.id) ?? [],
    ranks: index.ranks.get(self.id) ?? { territory: 999, economy: 999, military: 999 },
  }
}

function considerTargets(index: WorldIndex, sit: Situation): string[] {
  const { self, doctrine } = sit
  const ids = new Set<string>([...(doctrine.claims ?? []), ...(doctrine.protects ?? []), ...(doctrine.rivals ?? [])])
  for (const r of self.relations) if (r.status !== 'neutral' || Math.abs(r.opinion) > 30) ids.add(r.otherEntityId)
  for (const id of index.neighbors.get(self.id) ?? []) ids.add(id)
  ids.delete(self.id)
  return [...ids].filter((id) => index.strength.has(id)).slice(0, MAX_TARGETS)
}

function targetedCandidates(index: WorldIndex, sit: Situation): Candidate[] {
  const { self, doctrine, strength } = sit
  const out: Candidate[] = []
  const name = (id: string) => index.state.entities[id]?.name ?? id
  const myAllies = index.allies.get(self.id) ?? new Set<string>()
  const sanctionCount = Object.values(index.state.sanctions).filter((s) => s.actorId === self.id).length
  const tradeCount = index.tradePartners.get(self.id)?.size ?? 0
  const lastWar = index.state.igpt.memory[self.id]?.lastWarTurn ?? null
  const protects = new Set(doctrine.protects ?? [])

  for (const t of considerTargets(index, sit)) {
    const target = index.state.entities[t]
    const rel = self.relations.find((r) => r.otherEntityId === t)
    const theirRel = target.relations.find((r) => r.otherEntityId === self.id)
    const opinion = rel?.opinion ?? 0
    const status = rel?.status ?? 'neutral'
    const allied = myAllies.has(t)
    const war = atWarWith(index, self.id, t)
    const isClaim = (doctrine.claims ?? []).includes(t)
    const isRival = (doctrine.rivals ?? []).includes(t)
    const attacksFriend = (index.wars.get(t) ?? []).some((w) => w.attackerIds.includes(t) && w.defenderIds.some((d) => protects.has(d) || myAllies.has(d)))

    // --- War ---
    const canAttack = !doctrine.neutral && !allied && !war && !protects.has(t) && self.military.personnelActive >= 1000
    const motive = isClaim || (isRival && opinion < -50) || (status === 'hostile' && opinion < -60)
    const cooledDown = lastWar === null || index.turn - lastWar > WAR_COOLDOWN_TICKS
    if (canAttack && motive && cooledDown) {
      const ratio = strength / Math.max(1, effectiveDefense(index, t) * DEFENDER_ADVANTAGE)
      const winChance = 1 / (1 + Math.exp(-(ratio - 1.3) * 3))
      const appetite = doctrine.aggression * 0.4 + doctrine.expansionism * (isClaim ? 0.5 : 0.2) + (opinion < -70 ? 0.1 : 0)
      // War is never free: WAR_COST is the price of deaths, money and isolation.
      const base = appetite * (0.4 + winChance) - (1 - doctrine.riskTolerance) * (1 - winChance) * 0.4 - WAR_COST
      const reasons = [
        isClaim ? `${self.name} claims ${target.name}.` : `Relations with ${target.name} are hostile (${opinion.toFixed(0)}).`,
        ratio >= 1 ? `Our forces outmatch theirs about ${ratio.toFixed(1)} to 1.` : `They are stronger: we have ${ratio.toFixed(1)}x their strength.`,
      ]
      out.push({ move: 'declare_war', targetId: t, base, reasons, winChance })
    }

    // --- Diplomacy ---
    const isSanctioned = isSanctioning(index.state, self.id, t)
    if (!isSanctioned && sanctionCount < MAX_SANCTIONS && (status === 'hostile' || status === 'war' || opinion < -40 || attacksFriend)) {
      out.push({
        move: 'sanction',
        targetId: t,
        base: doctrine.sanctionsUse * 0.35 + (opinion < -60 ? 0.1 : 0),
        reasons: [attacksFriend ? `${target.name} is attacking a country we back.` : `${target.name} is hostile to us (${opinion.toFixed(0)}).`],
      })
    }
    if (isSanctioned && opinion > -15 && !attacksFriend) {
      out.push({ move: 'lift_sanction', targetId: t, base: 0.25 + doctrine.diplomacy * 0.2, reasons: [`Relations with ${target.name} have recovered.`] })
    }
    if (!war && opinion > -45 && opinion < 40) {
      const neighbor = (index.neighbors.get(self.id) ?? []).includes(t)
      const deescalate = neighbor && opinion < -20 ? (1 - doctrine.aggression) * 0.15 : 0
      out.push({
        move: 'improve_relations',
        targetId: t,
        base: doctrine.diplomacy * 0.3 + (neighbor ? 0.1 : 0) + deescalate - (isRival ? 0.25 : 0) - (opinion > 25 ? 0.15 : 0),
        reasons: [neighbor ? `${target.name} is a neighbor worth keeping calm.` : `Better ties with ${target.name} open doors.`],
      })
    }
    const theirDoctrine = index.doctrines.get(t)
    if (!doctrine.neutral && !theirDoctrine?.neutral && !allied && !war && status === 'friendly' && opinion > 45 && (theirRel?.opinion ?? 0) > 40 && self.allianceIds.length < 4) {
      const theirStrength = index.strength.get(t) ?? 0
      out.push({
        move: 'form_alliance',
        targetId: t,
        base: doctrine.diplomacy * 0.3 + Math.min(0.3, sit.threat * 0.15) + (protects.has(t) ? 0.15 : 0),
        reasons: [`${target.name} is a close friend (${opinion.toFixed(0)}) with ${theirStrength > strength ? 'a stronger' : 'a useful'} military.`],
      })
    }
    if (!war && tradeCount < MAX_TRADE_DEALS && !(index.tradePartners.get(self.id)?.has(t)) && opinion > 10 && (theirRel?.opinion ?? 0) > 5 && !isSanctioned && !isSanctioning(index.state, t, self.id)) {
      const share = index.worldGdp > 0 ? target.economy.gdpUsd / index.worldGdp : 0
      out.push({
        move: 'sign_trade',
        targetId: t,
        base: doctrine.economicFocus * 0.25 + Math.min(0.2, share * 2),
        reasons: [`${target.name}'s $${(target.economy.gdpUsd / 1e9).toFixed(0)}B economy is a valuable market.`],
      })
    }
    const inNeed = (protects.has(t) || allied) && (index.wars.get(t)?.length ?? 0) > 0
    // One aid package: ~0.05% of GDP (about $15B for the US).
    const aid = Math.min(self.economy.treasuryUsd * 0.1, self.economy.gdpUsd * 0.0005)
    if (inNeed && self.economy.treasuryUsd > self.economy.gdpUsd * 0.02 && aid > 0) {
      out.push({
        move: 'send_aid',
        targetId: t,
        quantity: Math.round(aid),
        base: doctrine.diplomacy * 0.2 + (protects.has(t) ? 0.25 : 0.1),
        reasons: [`${target.name} is at war and we stand behind them.`],
      })
    }
  }

  // --- Ending wars ---
  for (const w of sit.wars) {
    const attacker = w.attackerIds.includes(self.id)
    const opponent = attacker ? w.defenderIds[0] : w.attackerIds[0]
    if (!opponent) continue
    const ourScore = attacker ? w.warScore : -w.warScore
    if (index.turn - w.startTurn < MIN_WAR_TICKS && ourScore > -50) continue
    // Peace takes two: skip it if the other side is winning and wouldn't sign.
    if (!wouldAcceptPeace(index, opponent, w)) continue
    const losing = ourScore < -30
    const base = (losing ? 0.3 + Math.abs(ourScore) / 200 : ourScore > 30 ? 0 : 0.1) + (1 - doctrine.aggression) * 0.15 - (ourScore > 0 ? doctrine.expansionism * 0.3 : 0)
    out.push({
      move: 'propose_peace',
      targetId: opponent,
      war: w,
      base,
      reasons: [losing ? `The war with ${name(opponent)} is going badly (score ${ourScore.toFixed(0)}).` : `The war with ${name(opponent)} has dragged on (score ${ourScore.toFixed(0)}).`],
    })
  }
  return out
}

/** Would `id` sign a peace in this war? Not while it's clearly winning --
 *  unless the war has dragged on for years. */
export function wouldAcceptPeace(index: WorldIndex, id: string, w: { attackerIds: string[]; warScore: number; startTurn: number }): boolean {
  const theirScore = w.attackerIds.includes(id) ? w.warScore : -w.warScore
  const years = (index.turn - w.startTurn) / yearsToTicks(1)
  return theirScore < 25 || (years > 3 && theirScore < 60)
}

function internalCandidates(sit: Situation): Candidate[] {
  const { self, doctrine, threat, wars } = sit
  const econ = self.economy
  const mil = self.military
  const out: Candidate[] = []
  const atWar = wars.length > 0
  const debtDrag = Math.max(0, (econ.debtToGdpPct - 100) / 400)

  const spendCap = 1 + doctrine.militaryFocus * 7 + (atWar ? 5 : 0)
  if (econ.militarySpendingPctOfGdp + 0.5 <= spendCap && (threat > 0.6 || atWar || (doctrine.militaryFocus > 0.7 && sit.ranks.military <= 5))) {
    out.push({
      move: 'raise_military',
      targetId: null,
      percent: round1(econ.militarySpendingPctOfGdp + 0.5),
      base: doctrine.militaryFocus * 0.25 + Math.min(0.35, threat * 0.2) + (atWar ? 0.2 : 0) - debtDrag,
      reasons: [atWar ? 'We are at war.' : threat > 0.6 ? 'A hostile neighbor is building up.' : 'Military strength is a national priority.'],
    })
  }
  if (econ.militarySpendingPctOfGdp > spendCap + 1) {
    out.push({
      move: 'cut_military',
      targetId: null,
      percent: round1(Math.max(spendCap, econ.militarySpendingPctOfGdp - 2)),
      base: 0.3 + Math.max(0, (econ.debtToGdpPct - 60) / 300),
      reasons: [`Military spending (${econ.militarySpendingPctOfGdp.toFixed(1)}% of GDP) is more than we can sustain${atWar ? '' : ' in peacetime'}.`],
    })
  } else if (econ.militarySpendingPctOfGdp > 1.5 && !atWar && (threat < 0.6 || budgetBalancePct(self) < -3)) {
    out.push({
      move: 'cut_military',
      targetId: null,
      percent: round1(econ.militarySpendingPctOfGdp - 0.5),
      base: doctrine.economicFocus * 0.2 + Math.max(0, (econ.debtToGdpPct - 80) / 300) - doctrine.militaryFocus * 0.15,
      reasons: ['No serious threat on the horizon; the money is better spent elsewhere.'],
    })
  }
  const balance = budgetBalancePct(self)
  if (econ.debtToGdpPct > 90 && econ.taxRatePct < 40 && balance < -1) {
    out.push({
      move: 'raise_taxes',
      targetId: null,
      percent: round1(econ.taxRatePct + 2),
      base: 0.15 + (econ.debtToGdpPct - 90) / 400,
      reasons: [`Debt is ${econ.debtToGdpPct.toFixed(0)}% of GDP and the budget runs a ${(-balance).toFixed(1)}% deficit.`],
    })
  }
  if ((self.population.unrest > 50 && econ.taxRatePct > 25) || (econ.growthRatePct < 1 && econ.debtToGdpPct < 60 && econ.taxRatePct > 20)) {
    out.push({
      move: 'cut_taxes',
      targetId: null,
      percent: round1(econ.taxRatePct - 2),
      base: 0.15 + Math.max(0, self.population.unrest - 50) / 200,
      reasons: [self.population.unrest > 50 ? `Unrest is high (${self.population.unrest.toFixed(0)}).` : 'Growth has stalled.'],
    })
  }
  if (econ.treasuryUsd >= econ.gdpUsd * 0.005 && mil.techLevel < 40 + doctrine.militaryFocus * 60) {
    out.push({
      move: 'research',
      targetId: null,
      quantity: Math.round(econ.gdpUsd * 0.002),
      base: 0.05 + doctrine.militaryFocus * 0.1 + doctrine.economicFocus * 0.05,
      reasons: [`Military technology is at ${mil.techLevel.toFixed(0)}/100.`],
    })
  }
  // Hardware beyond what the budget can maintain just rusts (see military.ts).
  const canMaintainMore = equipmentValueUsd(self) < maintainableEquipmentUsd(self)
  if (canMaintainMore && econ.treasuryUsd >= econ.gdpUsd * 0.005 && (threat > 1.2 || atWar)) {
    const budget = Math.min(econ.treasuryUsd * 0.5, econ.gdpUsd * 0.002)
    const unit = budget > UNIT_COST_USD.aircraft * 20 ? 'aircraft' : 'tanks'
    const quantity = Math.floor(budget / UNIT_COST_USD[unit])
    if (quantity >= 1) {
      out.push({
        move: 'build_army',
        targetId: null,
        unit,
        quantity,
        base: doctrine.militaryFocus * 0.2 + Math.min(0.3, threat * 0.15) + (atWar ? 0.15 : 0),
        reasons: [atWar ? 'The front needs equipment.' : 'We need more hardware to deter attack.'],
      })
    }
  }
  if ((atWar || threat > 1.3) && mil.mobilizationLevel < 80 && mil.personnelReserve > 1000) {
    out.push({
      move: 'mobilize',
      targetId: null,
      quantity: Math.round(Math.min(mil.personnelReserve, Math.max(1000, mil.personnelActive * 0.1))),
      base: (atWar ? 0.3 : 0.1) + doctrine.militaryFocus * 0.1,
      reasons: [atWar ? 'We are at war and need more troops.' : 'A much stronger enemy is on our border.'],
    })
  }
  if (!atWar && mil.mobilizationLevel > 35 && threat < 0.7 && mil.personnelActive > 2000) {
    out.push({
      move: 'demobilize',
      targetId: null,
      quantity: Math.round(mil.personnelActive * 0.1),
      base: doctrine.economicFocus * 0.15 + 0.05,
      reasons: [`Mobilization is at ${mil.mobilizationLevel.toFixed(0)}% with no war to fight.`],
    })
  }
  return out
}

function usd(v: number): string {
  return v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${Math.max(1, Math.round(v / 1e6))}M`
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function describe(index: WorldIndex, self: WorldEntity, c: Candidate): string {
  const t = c.targetId ? (index.state.entities[c.targetId]?.name ?? c.targetId) : ''
  switch (c.move) {
    case 'declare_war': return `Declare war on ${t}`
    case 'propose_peace': return `Make peace with ${t}`
    case 'sanction': return `Sanction ${t}`
    case 'lift_sanction': return `Lift sanctions on ${t}`
    case 'improve_relations': return `Improve relations with ${t}`
    case 'form_alliance': return `Form an alliance with ${t}`
    case 'sign_trade': return `Sign a trade agreement with ${t}`
    case 'send_aid': return `Send ${usd(c.quantity ?? 0)} in aid to ${t}`
    case 'raise_military': return `Raise military spending to ${c.percent}% of GDP`
    case 'cut_military': return `Cut military spending to ${c.percent}% of GDP`
    case 'raise_taxes': return `Raise taxes to ${c.percent}%`
    case 'cut_taxes': return `Cut taxes to ${c.percent}%`
    case 'research': return `Invest ${usd(c.quantity ?? 0)} in military research`
    case 'build_army': return `Build ${c.quantity?.toLocaleString()} ${c.unit}`
    case 'mobilize': return `Mobilize ${c.quantity?.toLocaleString()} reserve troops`
    case 'demobilize': return `Demobilize ${c.quantity?.toLocaleString()} troops`
  }
  return `${c.move} (${self.name})`
}

function toAction(actor: string, c: Candidate): StructuredAction {
  const base: StructuredAction = { actor, action: 'unknown', target: c.targetId, organization: null, treatyType: null, quantity: null, unit: null, percent: null, note: null }
  switch (c.move) {
    case 'declare_war': return { ...base, action: 'declare_war' }
    case 'propose_peace': return { ...base, action: 'propose_peace' }
    case 'sanction': return { ...base, action: 'sanction' }
    case 'lift_sanction': return { ...base, action: 'lift_sanction' }
    case 'improve_relations': return { ...base, action: 'improve_relations' }
    case 'form_alliance': return { ...base, action: 'form_alliance' }
    case 'sign_trade': return { ...base, action: 'sign_treaty', treatyType: 'trade_agreement' }
    case 'send_aid': return { ...base, action: 'send_aid', quantity: c.quantity ?? null }
    case 'raise_military':
    case 'cut_military': return { ...base, action: 'set_military_spending', percent: c.percent ?? null }
    case 'raise_taxes':
    case 'cut_taxes': return { ...base, action: 'set_tax_rate', percent: c.percent ?? null }
    case 'research': return { ...base, action: 'research_tech', quantity: c.quantity ?? null }
    case 'build_army': return { ...base, action: 'build_units', unit: c.unit ?? null, quantity: c.quantity ?? null }
    case 'mobilize': return { ...base, action: 'mobilize', quantity: c.quantity ?? null }
    case 'demobilize': return { ...base, action: 'demobilize', quantity: c.quantity ?? null }
  }
}
