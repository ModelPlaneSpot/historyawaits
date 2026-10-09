import type { IgptMove, War, WorldEntity } from '@/domain/schemas'
import type { Doctrine } from './doctrines'
import { strongestBacker, type WorldIndex } from './context'
import { budgetBalancePct } from '@/simulation/modules/economy'

/** How one country sees its own position this tick (built in brain.ts). */
export interface Situation {
  self: WorldEntity
  doctrine: Doctrine
  strength: number
  /** Strongest hostile neighbor/rival relative to us: 0 = none, 1 = equal,
   *  2+ = they badly outgun us. */
  threat: number
  threatSourceId: string | null
  wars: War[]
  ranks: { territory: number; economy: number; military: number }
}

/** One possible decision, before lessons and learning adjust its score. */
export interface Candidate {
  move: IgptMove
  targetId: string | null
  /** Doctrine/situation-based desirability, roughly 0..1. */
  base: number
  reasons: string[]
  percent?: number
  quantity?: number
  unit?: 'tanks' | 'aircraft' | 'ships' | 'artillery'
  /** For wars: estimated chance of winning (0..1). */
  winChance?: number
  war?: War
}

/**
 * Rules of thumb IGPT was taught. Each one nudges the score of certain moves
 * when its condition holds, and its text is shown to the player as part of
 * the explanation whenever it influenced a decision. Add a lesson here and
 * every country -- AI and player suggestions alike -- starts applying it.
 */
export interface Lesson {
  id: string
  text: string
  moves: IgptMove[]
  delta: number
  applies: (sit: Situation, c: Candidate, index: WorldIndex) => boolean
}

const target = (index: WorldIndex, c: Candidate) => (c.targetId ? index.state.entities[c.targetId] : undefined)

export const LESSONS: Lesson[] = [
  {
    id: 'no-unwinnable-wars',
    text: "Never start a war you can't win.",
    moves: ['declare_war'],
    delta: -0.6,
    applies: (_s, c) => (c.winChance ?? 0) < 0.55,
  },
  {
    id: 'wars-on-credit',
    text: 'A war fought on borrowed money is lost at home.',
    moves: ['declare_war'],
    delta: -0.3,
    applies: (s) => s.self.economy.debtToGdpPct > 150,
  },
  {
    id: 'one-front',
    text: "Don't open a second front.",
    moves: ['declare_war'],
    delta: -0.5,
    applies: (s) => s.wars.length > 0,
  },
  {
    id: 'unstable-no-gamble',
    text: "A shaky government shouldn't gamble on war.",
    moves: ['declare_war'],
    delta: -0.3,
    applies: (s) => s.self.government.stability < 35,
  },
  {
    id: 'strike-distracted',
    text: 'Press a claim while the other side is busy fighting someone else.',
    moves: ['declare_war'],
    delta: 0.2,
    applies: (s, c, index) => !!c.targetId && (s.doctrine.claims ?? []).includes(c.targetId) && (index.wars.get(c.targetId)?.length ?? 0) > 0,
  },
  {
    id: 'their-allies-fight-too',
    text: "Attacking someone means fighting their allies too.",
    moves: ['declare_war'],
    delta: -0.25,
    applies: (_s, c, index) => !!c.targetId && (index.allies.get(c.targetId)?.size ?? 0) >= 2,
  },
  {
    id: 'dont-provoke-superpower',
    text: "Don't attack a country a great power has promised to defend.",
    moves: ['declare_war'],
    delta: -0.4,
    applies: (s, c, index) => {
      if (!c.targetId) return false
      const backer = strongestBacker(index, c.targetId)
      return !!backer && backer.id !== s.self.id && backer.strength > s.strength * 0.7
    },
  },
  {
    id: 'peace-before-collapse',
    text: 'When the war is being lost, make peace before the collapse.',
    moves: ['propose_peace'],
    delta: 0.4,
    applies: (s, c) => {
      if (!c.war) return false
      const attacker = c.war.attackerIds.includes(s.self.id)
      return attacker ? c.war.warScore < -30 : c.war.warScore > 30
    },
  },
  {
    id: 'war-weariness',
    text: 'Long wars exhaust the home front.',
    moves: ['propose_peace'],
    delta: 0.25,
    applies: (s, c, index) => !!c.war && index.turn - c.war.startTurn > 240 && s.self.government.stability < 45,
  },
  {
    id: 'allies-vs-bigger-neighbor',
    text: 'Find allies when a stronger neighbor is hostile.',
    moves: ['form_alliance'],
    delta: 0.3,
    applies: (s) => s.threat > 1,
  },
  {
    id: 'deterrence',
    text: 'Weak armies invite aggression.',
    moves: ['raise_military', 'build_army', 'research'],
    delta: 0.25,
    applies: (s) => s.threat > 0.8,
  },
  {
    id: 'fiscal-discipline',
    text: 'Debt above 100% of GDP calls for discipline.',
    moves: ['raise_taxes', 'cut_military'],
    delta: 0.25,
    applies: (s) => s.self.economy.debtToGdpPct > 100,
  },
  {
    id: 'no-spending-into-debt',
    text: "Don't build an army on debt you can't repay.",
    moves: ['raise_military', 'build_army'],
    delta: -0.25,
    // Even a real threat doesn't justify borrowing past ~180% of GDP.
    applies: (s) => s.self.economy.debtToGdpPct > 180 || (s.self.economy.debtToGdpPct > 130 && s.threat < 1),
  },
  {
    id: 'deficit-limit',
    text: 'Keep the deficit under 3% of GDP in peacetime.',
    moves: ['raise_military', 'build_army', 'research'],
    delta: -0.35,
    applies: (s) => s.wars.length === 0 && budgetBalancePct(s.self) < -3,
  },
  {
    id: 'close-the-deficit',
    text: 'Keep the deficit under 3% of GDP in peacetime.',
    moves: ['cut_military', 'raise_taxes'],
    delta: 0.3,
    applies: (s) => s.wars.length === 0 && budgetBalancePct(s.self) < -3,
  },
  {
    id: 'taxes-breed-unrest',
    text: 'High taxes breed unrest.',
    moves: ['cut_taxes'],
    delta: 0.3,
    applies: (s) => s.self.population.unrest > 55 && s.self.economy.taxRatePct > 28,
  },
  {
    id: 'unrest-no-tax-hikes',
    text: 'Never raise taxes on an angry public.',
    moves: ['raise_taxes'],
    delta: -0.4,
    applies: (s) => s.self.population.unrest > 60,
  },
  {
    id: 'tech-multiplies',
    text: 'Technology multiplies every soldier.',
    moves: ['research'],
    delta: 0.15,
    applies: (s) => s.self.military.techLevel < 60 && s.self.economy.treasuryUsd > s.self.economy.gdpUsd * 0.03,
  },
  {
    id: 'sanction-aggressors',
    text: 'Sanction aggressors, especially those attacking your friends.',
    moves: ['sanction'],
    delta: 0.3,
    applies: (s, c, index) => {
      if (!c.targetId) return false
      const friends = new Set([...(s.doctrine.protects ?? []), ...(index.allies.get(s.self.id) ?? [])])
      return (index.wars.get(c.targetId) ?? []).some((w) => w.attackerIds.includes(c.targetId!) && w.defenderIds.some((d) => friends.has(d)))
    },
  },
  {
    id: 'dont-sanction-partners',
    text: "Don't sanction your own trading partners.",
    moves: ['sanction'],
    delta: -0.4,
    applies: (s, c, index) => !!c.targetId && (index.tradePartners.get(s.self.id)?.has(c.targetId) ?? false),
  },
  {
    id: 'small-sanctions-futile',
    text: 'Sanctions from a small economy barely hurt a big one.',
    moves: ['sanction'],
    delta: -0.2,
    applies: (s, c, index) => {
      const t = target(index, c)
      return !!t && s.self.economy.gdpUsd < t.economy.gdpUsd * 0.1
    },
  },
  {
    id: 'help-friends',
    text: 'Help friends in their hour of need.',
    moves: ['send_aid'],
    delta: 0.3,
    applies: (_s, c, index) => !!c.targetId && (index.wars.get(c.targetId)?.length ?? 0) > 0,
  },
  {
    id: 'trade-builds-wealth',
    text: 'Trade builds wealth for both sides.',
    moves: ['sign_trade'],
    delta: 0.15,
    applies: (s) => s.doctrine.economicFocus > 0.6,
  },
  {
    id: 'peace-dividend',
    text: 'In peacetime, bring the soldiers home and invest the savings.',
    moves: ['demobilize', 'cut_military'],
    delta: 0.2,
    applies: (s) => s.wars.length === 0 && s.threat < 0.5,
  },
  {
    id: 'mobilize-when-attacked',
    text: 'When the guns are firing, call up the reserves.',
    moves: ['mobilize'],
    delta: 0.35,
    applies: (s) => s.wars.length > 0 && s.self.military.mobilizationLevel < 70,
  },
  {
    id: 'chase-the-lead',
    text: 'Push hardest in the race you can win.',
    moves: ['research', 'build_army', 'raise_military'],
    delta: 0.15,
    applies: (s) => s.ranks.military > 1 && s.ranks.military <= 3,
  },
  {
    id: 'chase-the-economy-lead',
    text: 'Push hardest in the race you can win.',
    moves: ['sign_trade', 'cut_taxes', 'cut_military'],
    delta: 0.1,
    applies: (s) => s.ranks.economy > 1 && s.ranks.economy <= 3,
  },
]
