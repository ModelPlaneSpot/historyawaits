import type { WorldEntity } from '@/domain/schemas'

/** One turn = one week. */
export function advanceEconomy(entity: WorldEntity): void {
  const econ = entity.economy
  const growth = econ.growthRatePct / 100 / 52
  econ.gdpUsd = Math.max(0, econ.gdpUsd * (1 + growth))

  const weeklyMilitarySpend = (econ.gdpUsd * econ.militarySpendingPctOfGdp) / 100 / 52
  const weeklyTradeIncome = econ.tradeBalanceUsd / 52
  econ.treasuryUsd += weeklyTradeIncome - weeklyMilitarySpend

  // Debt drifts up when the treasury runs dry, down when it's flush.
  const treasuryToGdp = econ.gdpUsd > 0 ? econ.treasuryUsd / econ.gdpUsd : 0
  econ.debtToGdpPct = clamp(econ.debtToGdpPct - treasuryToGdp * 2, 0, 300)

  // Unemployment and inflation drift slowly toward a growth-linked equilibrium.
  const targetUnemployment = clamp(8 - econ.growthRatePct, 2, 30)
  econ.unemploymentRatePct = drift(econ.unemploymentRatePct, targetUnemployment, 0.02)
  const targetInflation = 2 + Math.max(0, econ.growthRatePct - 2) * 0.5
  econ.inflationPct = drift(econ.inflationPct, targetInflation, 0.02)

  econ.gdpPerCapitaUsd = entity.population.total > 0 ? econ.gdpUsd / entity.population.total : 0
}

export function applySetMilitarySpending(entity: WorldEntity, percent: number): void {
  entity.economy.militarySpendingPctOfGdp = clamp(percent, 0, 100)
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}
function drift(current: number, target: number, rate: number) {
  return current + (target - current) * rate
}
