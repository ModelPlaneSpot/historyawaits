import type { WorldEntity } from '@/domain/schemas'

/** One turn = one week. */
export function advanceEconomy(entity: WorldEntity): void {
  const econ = entity.economy
  // Higher taxes are a modest drag on growth (a believable cost for "raise taxes").
  const taxDrag = (econ.taxRatePct - 25) * 0.01
  const growth = (econ.growthRatePct - taxDrag) / 100 / 52
  econ.gdpUsd = Math.max(0, econ.gdpUsd * (1 + growth))

  const weeklyTaxRevenue = (econ.gdpUsd * econ.taxRatePct) / 100 / 52
  const weeklyMilitarySpend = (econ.gdpUsd * econ.militarySpendingPctOfGdp) / 100 / 52
  const weeklyTradeIncome = econ.tradeBalanceUsd / 52
  econ.treasuryUsd += weeklyTaxRevenue + weeklyTradeIncome - weeklyMilitarySpend

  // Debt drifts up when the treasury runs dry, down when it's flush.
  const treasuryToGdp = econ.gdpUsd > 0 ? econ.treasuryUsd / econ.gdpUsd : 0
  econ.debtToGdpPct = clamp(econ.debtToGdpPct - treasuryToGdp * 2, 0, 300)

  // Unemployment and inflation drift slowly toward a growth-linked equilibrium.
  const targetUnemployment = clamp(8 - econ.growthRatePct + (econ.taxRatePct - 25) * 0.05, 2, 35)
  econ.unemploymentRatePct = drift(econ.unemploymentRatePct, targetUnemployment, 0.02)
  const targetInflation = 2 + Math.max(0, econ.growthRatePct - 2) * 0.5
  econ.inflationPct = drift(econ.inflationPct, targetInflation, 0.02)

  // High taxes fuel public unrest; low taxes (within reason) ease it.
  entity.population.unrest = clamp(entity.population.unrest + (econ.taxRatePct - 25) * 0.003, 0, 100)

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
