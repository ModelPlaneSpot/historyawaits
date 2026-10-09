import type { WorldEntity, UnitType } from '@/domain/schemas'
import { WEEK_FRACTION, TICKS_PER_YEAR } from '../gameDate'

export const UNIT_COST_USD: Record<UnitType, number> = {
  troops: 40000,
  tanks: 6000000,
  aircraft: 90000000,
  ships: 500000000,
  artillery: 1500000,
}

/** Equipment upkeep: a country can keep up hardware worth about this many
 *  years of its military budget; anything beyond that wears out at
 *  WEAR_PER_YEAR. So arms purchases raise strength, but in the long run
 *  strength follows the military budget rather than piling up forever. */
const MAINTAINABLE_BUDGET_YEARS = 6
const WEAR_PER_YEAR = 0.05
/** Share of the annual military budget that routinely goes to new
 *  equipment (the rest is pay, operations, upkeep). Already inside the
 *  military budget, so it costs the treasury nothing extra. */
const PROCUREMENT_SHARE = 0.2
const UNITS = ['tanks', 'aircraft', 'ships', 'artillery'] as const
/** Value mix for a country that has no equipment to copy the mix from. */
const DEFAULT_MIX: Record<(typeof UNITS)[number], number> = { tanks: 0.25, aircraft: 0.4, ships: 0.3, artillery: 0.05 }

export function equipmentValueUsd(entity: WorldEntity): number {
  const eq = entity.military.equipment
  return eq.tanks * UNIT_COST_USD.tanks + eq.aircraft * UNIT_COST_USD.aircraft + eq.ships * UNIT_COST_USD.ships + eq.artillery * UNIT_COST_USD.artillery
}

export function maintainableEquipmentUsd(entity: WorldEntity): number {
  return (entity.economy.gdpUsd * entity.economy.militarySpendingPctOfGdp) / 100 * MAINTAINABLE_BUDGET_YEARS
}

export function advanceMilitary(entity: WorldEntity, atWar: boolean, turn: number): void {
  const mil = entity.military
  // Wear and procurement are applied once a year: per-tick fractions would
  // round away on whole-unit counts.
  if (turn % Math.round(TICKS_PER_YEAR) === 0) annualEquipmentCycle(entity)
  // Personnel drifts toward a target implied by mobilization level.
  const targetActive = Math.round(
    entity.population.total * 0.003 * (1 + mil.mobilizationLevel / 100),
  )
  mil.personnelActive = Math.round(mil.personnelActive + (targetActive - mil.personnelActive) * 0.05 * WEEK_FRACTION)

  const moraleTarget = atWar ? 55 : 70
  mil.morale = clamp(mil.morale + (moraleTarget - mil.morale) * 0.03 * WEEK_FRACTION, 0, 100)

  if (!atWar) mil.mobilizationLevel = Math.max(10, mil.mobilizationLevel - WEEK_FRACTION)
}

function annualEquipmentCycle(entity: WorldEntity): void {
  const eq = entity.military.equipment
  const value = equipmentValueUsd(entity)
  const cap = maintainableEquipmentUsd(entity)
  if (value > cap) {
    for (const unit of UNITS) eq[unit] = Math.floor(eq[unit] * (1 - WEAR_PER_YEAR))
    return
  }
  const budget = (entity.economy.gdpUsd * entity.economy.militarySpendingPctOfGdp) / 100
  const spend = Math.min(budget * PROCUREMENT_SHARE, cap - value)
  if (spend <= 0) return
  for (const unit of UNITS) {
    const share = value > 0 ? (eq[unit] * UNIT_COST_USD[unit]) / value : DEFAULT_MIX[unit]
    eq[unit] += Math.floor((spend * share) / UNIT_COST_USD[unit])
  }
}

export function applyMobilize(entity: WorldEntity, additionalTroops: number): void {
  entity.military.mobilizationLevel = clamp(entity.military.mobilizationLevel + additionalTroops / 100000 * 5, 0, 100)
  entity.military.personnelActive += Math.round(additionalTroops)
  entity.military.personnelReserve = Math.max(0, entity.military.personnelReserve - Math.round(additionalTroops))
}

export function applyDemobilize(entity: WorldEntity, troops: number): void {
  const moved = Math.min(troops, entity.military.personnelActive)
  entity.military.personnelActive -= moved
  entity.military.personnelReserve += moved
  entity.military.mobilizationLevel = clamp(entity.military.mobilizationLevel - moved / 100000 * 5, 0, 100)
}

/** "Increase/reduce readiness" -- moves mobilization level directly without
 *  changing headcount (advanceMilitary will drift personnel toward it). */
export function applySetReadiness(entity: WorldEntity, percent: number): void {
  entity.military.mobilizationLevel = clamp(percent, 0, 100)
}

export function applyBuildUnits(entity: WorldEntity, unit: UnitType, quantity: number): boolean {
  const cost = UNIT_COST_USD[unit] * quantity
  if (unit === 'troops') {
    entity.military.personnelActive += quantity
    return true
  }
  if (entity.economy.treasuryUsd < cost) return false
  entity.economy.treasuryUsd -= cost
  entity.military.equipment[unit] += quantity
  return true
}

export function militaryStrength(entity: WorldEntity): number {
  const eq = entity.military.equipment
  const equipmentScore = eq.tanks * 3 + eq.aircraft * 8 + eq.ships * 12 + eq.artillery * 2
  const personnelScore = entity.military.personnelActive * 0.01
  const techMultiplier = 0.5 + entity.military.techLevel / 100
  const moraleMultiplier = 0.5 + entity.military.morale / 100
  return (equipmentScore + personnelScore) * techMultiplier * moraleMultiplier
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}
