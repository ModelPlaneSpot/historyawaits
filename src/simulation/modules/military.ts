import type { WorldEntity, UnitType } from '@/domain/schemas'

const UNIT_COST_USD: Record<UnitType, number> = {
  troops: 40000,
  tanks: 6000000,
  aircraft: 90000000,
  ships: 500000000,
  artillery: 1500000,
}

export function advanceMilitary(entity: WorldEntity, atWar: boolean): void {
  const mil = entity.military
  // Personnel drifts toward a target implied by mobilization level.
  const targetActive = Math.round(
    entity.population.total * 0.003 * (1 + mil.mobilizationLevel / 100),
  )
  mil.personnelActive = Math.round(mil.personnelActive + (targetActive - mil.personnelActive) * 0.05)

  const moraleTarget = atWar ? 55 : 70
  mil.morale = clamp(mil.morale + (moraleTarget - mil.morale) * 0.03, 0, 100)

  if (!atWar) mil.mobilizationLevel = Math.max(10, mil.mobilizationLevel - 1)
}

export function applyMobilize(entity: WorldEntity, additionalTroops: number): void {
  entity.military.mobilizationLevel = clamp(entity.military.mobilizationLevel + additionalTroops / 100000 * 5, 0, 100)
  entity.military.personnelActive += Math.round(additionalTroops)
  entity.military.personnelReserve = Math.max(0, entity.military.personnelReserve - Math.round(additionalTroops))
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
