import type { WorldState } from '@/domain/schemas'
import { formatGameDate } from '@/simulation/gameDate'

function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  return `$${(n / 1e6).toFixed(1)}M`
}
function fmtNum(n: number): string {
  return Math.round(n).toLocaleString()
}

/**
 * A deterministic, no-model answer for the small set of question patterns
 * this can recognize -- the guaranteed baseline for the advisor when local
 * AI isn't loaded, same philosophy as the command fallback parser. Every
 * number here comes straight from the live simulation state.
 */
export function basicAdvisorReply(worldState: WorldState, questionText: string): string | null {
  const player = worldState.entities[worldState.playerEntityId]
  if (!player) return null
  const q = questionText.toLowerCase()

  if (/\bdate\b|what.*(year|day|today)/.test(q)) {
    return `The current in-game date is ${formatGameDate(worldState.turn)} (turn ${worldState.turn}).`
  }

  if (/military|army|troops|strength|forces/.test(q)) {
    return `Your military: ${fmtNum(player.military.personnelActive)} active personnel (${fmtNum(player.military.personnelReserve)} in reserve), ${fmtNum(player.military.equipment.tanks)} tanks, ${fmtNum(player.military.equipment.aircraft)} aircraft, ${fmtNum(player.military.equipment.ships)} ships, ${fmtNum(player.military.equipment.artillery)} artillery. Tech level ${player.military.techLevel}/100, morale ${player.military.morale}/100, spending ${player.economy.militarySpendingPctOfGdp.toFixed(1)}% of GDP.`
  }

  if (/econom|gdp|treasury|debt|inflation/.test(q)) {
    return `Your economy: GDP ${fmtUsd(player.economy.gdpUsd)} (${player.economy.growthRatePct.toFixed(1)}%/yr growth), treasury ${fmtUsd(player.economy.treasuryUsd)}, debt ${player.economy.debtToGdpPct.toFixed(0)}% of GDP, unemployment ${player.economy.unemploymentRatePct.toFixed(1)}%, inflation ${player.economy.inflationPct.toFixed(1)}%.`
  }

  if (/ally|allies|alliance|diplo|relation/.test(q)) {
    const allies = player.relations.filter((r) => r.status === 'allied').map((r) => worldState.entities[r.otherEntityId]?.name ?? r.otherEntityId)
    const hostile = player.relations.filter((r) => r.status === 'hostile').map((r) => worldState.entities[r.otherEntityId]?.name ?? r.otherEntityId)
    return `Allies: ${allies.length ? allies.join(', ') : 'none'}. Hostile relations: ${hostile.length ? hostile.join(', ') : 'none'}.`
  }

  if (/war|conflict|fighting/.test(q)) {
    const activeWars = Object.values(worldState.wars).filter(
      (w) => w.active && (w.attackerIds.includes(player.id) || w.defenderIds.includes(player.id)),
    )
    if (activeWars.length === 0) return 'You are not currently at war with anyone.'
    return activeWars
      .map((w) => {
        const isAttacker = w.attackerIds.includes(player.id)
        const opponents = (isAttacker ? w.defenderIds : w.attackerIds).map((id) => worldState.entities[id]?.name ?? id)
        return `At war with ${opponents.join(', ')}. War score: ${(isAttacker ? w.warScore : -w.warScore).toFixed(0)} (positive favors you).`
      })
      .join(' ')
  }

  if (/stability|unrest|approval|government/.test(q)) {
    return `Government stability: ${player.government.stability.toFixed(0)}/100. Public unrest: ${player.population.unrest.toFixed(0)}/100. Coup risk: ${player.government.coupRisk.toFixed(0)}/100.`
  }

  return null
}

export const NO_CANNED_ANSWER =
  "I don't have a scripted answer for that without the local AI enabled. Try enabling Local AI for full conversational advice, or ask something like \"how strong is my military\", \"what's my economy like\", \"who are my allies\", or \"am I at war\"."
