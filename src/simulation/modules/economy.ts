import type { WorldEntity, WorldState } from '@/domain/schemas'
import { TICKS_PER_YEAR, WEEK_FRACTION } from '../gameDate'

/** One tick = 3 days (see gameDate.ts). Annual figures are divided by
 *  TICKS_PER_YEAR; drift rates were tuned per week and scale by WEEK_FRACTION. */
/** Governments spend most of what they tax on civilian services
 *  (CIVILIAN_SHARE_OF_TAX of revenue, plus a structural baseline), so the
 *  budget balance comes down to: a bit of revenue left over, minus the
 *  military budget, minus interest on the debt. */
const CIVILIAN_SHARE_OF_TAX = 0.9
const CIVILIAN_BASELINE_PCT = 1.5
/** Kept below typical (nominal) growth, so a moderate deficit settles at a
 *  stable debt level instead of compounding without limit. */
const DEBT_INTEREST_PCT = 2
/** Cash the treasury keeps on hand (fraction of GDP); a shortfall below it is
 *  borrowed, and anything well above it pays down debt. */
const CASH_BUFFER = 0.01

/** Annual primary + interest balance as % of GDP (negative = deficit). */
export function budgetBalancePct(entity: WorldEntity): number {
  const econ = entity.economy
  const civilian = econ.taxRatePct * CIVILIAN_SHARE_OF_TAX + CIVILIAN_BASELINE_PCT
  const interest = (econ.debtToGdpPct * DEBT_INTEREST_PCT) / 100
  return econ.taxRatePct - civilian - econ.militarySpendingPctOfGdp - interest
}

/** The (nominal) growth rate a country's economy returns to between shocks:
 *  poorer countries have more room to catch up. */
export function potentialGrowthPct(entity: WorldEntity): number {
  const econ = entity.economy
  const catchUp = 2.5 * (1 - Math.min(1, econ.gdpPerCapitaUsd / 60000))
  // Debt is penalized through interest (budgetBalancePct), not here: a growth
  // penalty on top of interest made indebted rich economies spiral.
  return 3 + catchUp
}

/** Booms and recessions (worldEvents.ts) knock growth away from potential;
 *  this pulls it back over a few years so shocks don't compound forever. */
const GROWTH_REVERSION_PER_YEAR = 0.3

export function advanceEconomy(entity: WorldEntity): void {
  const econ = entity.economy
  const debtUsd = (econ.debtToGdpPct / 100) * econ.gdpUsd
  econ.growthRatePct = drift(econ.growthRatePct, potentialGrowthPct(entity), GROWTH_REVERSION_PER_YEAR / TICKS_PER_YEAR)

  // Higher taxes are a modest drag on growth (a believable cost for "raise taxes").
  const taxDrag = (econ.taxRatePct - 25) * 0.01
  const growth = (econ.growthRatePct - taxDrag) / 100 / TICKS_PER_YEAR
  econ.gdpUsd = Math.max(0, econ.gdpUsd * (1 + growth))
  if (econ.gdpUsd <= 0) return

  // Deficits drain the treasury; a growing economy shrinks the debt ratio
  // on its own because the debt is fixed in dollars.
  econ.treasuryUsd += (budgetBalancePct(entity) / 100 / TICKS_PER_YEAR) * econ.gdpUsd
  let newDebtUsd = debtUsd
  const buffer = econ.gdpUsd * CASH_BUFFER
  if (econ.treasuryUsd < buffer) {
    newDebtUsd += buffer - econ.treasuryUsd
    econ.treasuryUsd = buffer
  } else if (econ.treasuryUsd > buffer * 3 && newDebtUsd > 0) {
    const repay = Math.min(newDebtUsd, econ.treasuryUsd - buffer * 3)
    newDebtUsd -= repay
    econ.treasuryUsd -= repay
  }
  econ.debtToGdpPct = clamp((newDebtUsd / econ.gdpUsd) * 100, 0, 300)

  // Unemployment and inflation drift slowly toward a growth-linked equilibrium.
  const targetUnemployment = clamp(8 - econ.growthRatePct + (econ.taxRatePct - 25) * 0.05, 2, 35)
  econ.unemploymentRatePct = drift(econ.unemploymentRatePct, targetUnemployment, 0.02 * WEEK_FRACTION)
  const targetInflation = 2 + Math.max(0, econ.growthRatePct - 2) * 0.5
  econ.inflationPct = drift(econ.inflationPct, targetInflation, 0.02 * WEEK_FRACTION)

  // High taxes fuel public unrest; low taxes (within reason) ease it.
  entity.population.unrest = clamp(entity.population.unrest + (econ.taxRatePct - 25) * 0.003 * WEEK_FRACTION, 0, 100)

  econ.gdpPerCapitaUsd = entity.population.total > 0 ? econ.gdpUsd / entity.population.total : 0
}

export function applySetMilitarySpending(entity: WorldEntity, percent: number): void {
  entity.economy.militarySpendingPctOfGdp = clamp(percent, 0, 100)
}

export function applySetTaxRate(entity: WorldEntity, percent: number): void {
  entity.economy.taxRatePct = clamp(percent, 0, 80)
}

/** Spends treasury to slowly raise military tech level -- the simulation's
 *  stand-in for "research"/"develop weapons" without a full tech tree. */
export function applyResearchTech(entity: WorldEntity, budgetUsd: number): boolean {
  if (entity.economy.treasuryUsd < budgetUsd) return false
  entity.economy.treasuryUsd -= budgetUsd
  const gain = Math.min(3, budgetUsd / 2_000_000_000)
  entity.military.techLevel = clamp(entity.military.techLevel + gain, 0, 100)
  return true
}

export function applySendAid(from: WorldEntity, to: WorldEntity, amountUsd: number): boolean {
  if (from.economy.treasuryUsd < amountUsd) return false
  from.economy.treasuryUsd -= amountUsd
  to.economy.treasuryUsd += amountUsd
  return true
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}
function drift(current: number, target: number, rate: number) {
  return current + (target - current) * rate
}

/** Max annual growth drag (percentage points) from being sanctioned. */
const MAX_SANCTION_DRAG_PCT = 4
/** Annual growth bonus per active trade agreement, and its cap. */
const TRADE_BONUS_PCT = 0.05
const MAX_TRADE_BONUS_PCT = 0.3

/** Sanctions drag on the target's GDP in proportion to how much of the world
 *  economy is sanctioning it (the US + EU hurt; a small state barely
 *  registers), with a small cost to the sanctioner; trade agreements give
 *  each member a small boost. Applied per tick as a GDP multiplier, so it
 *  stops the moment a sanction is lifted or a treaty lapses. */
export function applySanctionsAndTrade(state: WorldState): void {
  const sanctions = Object.values(state.sanctions)
  const tradeTreaties = Object.values(state.treaties).filter((t) => t.active && t.type === 'trade_agreement')
  if (sanctions.length === 0 && tradeTreaties.length === 0) return

  let worldGdp = 0
  for (const e of Object.values(state.entities)) worldGdp += e.economy.gdpUsd
  if (worldGdp <= 0) return

  const annualPct = new Map<string, number>()
  const add = (id: string, pct: number) => annualPct.set(id, (annualPct.get(id) ?? 0) + pct)

  for (const s of sanctions) {
    const actor = state.entities[s.actorId]
    if (!actor || !state.entities[s.targetId]) continue
    add(s.targetId, -(actor.economy.gdpUsd / worldGdp) * 20)
    add(s.actorId, -0.05)
  }
  for (const t of tradeTreaties) for (const m of t.memberIds) add(m, TRADE_BONUS_PCT)

  for (const [id, pct] of annualPct) {
    const entity = state.entities[id]
    if (!entity) continue
    const bounded = clamp(pct, -MAX_SANCTION_DRAG_PCT, MAX_TRADE_BONUS_PCT)
    entity.economy.gdpUsd = Math.max(0, entity.economy.gdpUsd * (1 + bounded / 100 / TICKS_PER_YEAR))
  }
}
