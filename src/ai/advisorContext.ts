import type { WorldState, WorldEntity } from '@/domain/schemas'
import { militaryStrength } from '@/simulation/modules/military'

function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  return `$${(n / 1e6).toFixed(1)}M`
}
function fmtNum(n: number): string {
  return Math.round(n).toLocaleString()
}

/** Rounds another country's military figures into a vaguer band and labels
 *  them as an estimate, rather than reporting our own exact-knowledge numbers
 *  for someone else's forces. This game doesn't model true fog-of-war (every
 *  number is deterministically known internally), but the advisor should
 *  still *talk* about foreign forces the way a real intelligence briefing
 *  would -- approximate, hedged -- rather than reciting exact figures. */
function estimateBand(n: number): string {
  if (n <= 0) return 'negligible'
  const magnitude = Math.pow(10, Math.floor(Math.log10(n)))
  const rounded = Math.round(n / magnitude) * magnitude
  return `approximately ${fmtNum(rounded)}`
}

function summarizeForeignMilitary(entity: WorldEntity): string {
  const m = entity.military
  return `est. ${estimateBand(m.personnelActive)} active personnel, ${estimateBand(m.equipment.tanks)} tanks, ${estimateBand(m.equipment.aircraft)} aircraft`
}

/** A compact, player-relevant slice of world state -- not the whole
 *  database. Built fresh per advisor message so it always reflects the
 *  current turn, but deliberately bounded: player's own full detail, plus a
 *  short list of the countries actually relevant to them right now. */
export function buildAdvisorContext(state: WorldState): string {
  const player = state.entities[state.playerEntityId]
  if (!player) return 'No active game.'

  const lines: string[] = []
  lines.push(`Player nation: ${player.name} (${player.government.type.replace('_', ' ')})`)
  lines.push(`Turn: ${state.turn} (1 turn = 1 week)`)
  lines.push('')
  lines.push('=== Our economy ===')
  lines.push(`GDP: ${fmtUsd(player.economy.gdpUsd)} (${player.economy.growthRatePct.toFixed(1)}%/yr growth)`)
  lines.push(`GDP per capita: ${fmtUsd(player.economy.gdpPerCapitaUsd)}`)
  lines.push(`Treasury: ${fmtUsd(player.economy.treasuryUsd)}, Debt: ${player.economy.debtToGdpPct.toFixed(0)}% of GDP`)
  lines.push(`Unemployment: ${player.economy.unemploymentRatePct.toFixed(1)}%, Inflation: ${player.economy.inflationPct.toFixed(1)}%`)
  lines.push(`Trade balance: ${fmtUsd(player.economy.tradeBalanceUsd)}`)
  lines.push('')
  lines.push('=== Our population & stability ===')
  lines.push(`Population: ${fmtNum(player.population.total)} (urbanization ${player.population.urbanizationPct.toFixed(0)}%)`)
  lines.push(`Public unrest: ${player.population.unrest.toFixed(0)}/100`)
  lines.push(`Government stability: ${player.government.stability.toFixed(0)}/100, coup risk: ${player.government.coupRisk.toFixed(0)}/100`)
  lines.push('')
  lines.push('=== Our military (exact -- this is our own force) ===')
  lines.push(`Active personnel: ${fmtNum(player.military.personnelActive)}, Reserve: ${fmtNum(player.military.personnelReserve)}`)
  lines.push(`Equipment: ${fmtNum(player.military.equipment.tanks)} tanks, ${fmtNum(player.military.equipment.aircraft)} aircraft, ${fmtNum(player.military.equipment.ships)} ships, ${fmtNum(player.military.equipment.artillery)} artillery`)
  lines.push(`Tech level: ${player.military.techLevel}/100, Morale: ${player.military.morale}/100, Mobilization: ${player.military.mobilizationLevel}/100`)
  lines.push(`Military spending: ${player.economy.militarySpendingPctOfGdp.toFixed(1)}% of GDP`)
  lines.push('(Note: this simulation tracks tanks/aircraft/ships/artillery as unit categories -- it does not separately model submarines, aircraft carrier classes, or nuclear arsenals.)')

  const activeWars = Object.values(state.wars).filter(
    (w) => w.active && (w.attackerIds.includes(player.id) || w.defenderIds.includes(player.id)),
  )
  lines.push('')
  lines.push('=== Wars ===')
  if (activeWars.length === 0) {
    lines.push('Not currently at war.')
  } else {
    for (const war of activeWars) {
      const isAttacker = war.attackerIds.includes(player.id)
      const opponents = (isAttacker ? war.defenderIds : war.attackerIds).map((id) => state.entities[id]?.name ?? id)
      const scoreFromOurSide = isAttacker ? war.warScore : -war.warScore
      lines.push(
        `${isAttacker ? 'We attacked' : 'We are defending against'} ${opponents.join(', ')}. War score: ${scoreFromOurSide.toFixed(0)} (positive favors us). Contested regions: ${war.contestedRegionIds.length}.`,
      )
      for (const oppId of isAttacker ? war.defenderIds : war.attackerIds) {
        const opp = state.entities[oppId]
        if (opp) lines.push(`  ${opp.name} forces: ${summarizeForeignMilitary(opp)}`)
      }
    }
  }

  lines.push('')
  lines.push('=== Diplomacy ===')
  const allies = player.relations.filter((r) => r.status === 'allied')
  const hostile = player.relations.filter((r) => r.status === 'hostile')
  lines.push(`Alliances: ${allies.length ? allies.map((r) => state.entities[r.otherEntityId]?.name ?? r.otherEntityId).join(', ') : 'none'}`)
  lines.push(`Hostile relations: ${hostile.length ? hostile.map((r) => state.entities[r.otherEntityId]?.name ?? r.otherEntityId).join(', ') : 'none'}`)
  const activeTreaties = player.allianceIds.map((id) => state.treaties[id]).filter(Boolean)
  if (activeTreaties.length) {
    lines.push(`Treaties: ${activeTreaties.map((t) => `${t!.type.replace('_', ' ')} with ${t!.memberIds.filter((m) => m !== player.id).map((m) => state.entities[m]?.name ?? m).join('/')}`).join('; ')}`)
  }

  lines.push('')
  lines.push('=== Territory ===')
  const controlledCount = player.territoryRegionIds.length
  const disputedControlled = player.territoryRegionIds.filter((id) => state.regions[id]?.disputed).length
  lines.push(`Regions controlled: ${controlledCount}${disputedControlled ? ` (${disputedControlled} disputed/contested)` : ''}`)

  // A short "threats" list: the largest military powers we're not allied with,
  // by our own military-strength formula (same one the sim itself uses).
  const notAllied = new Set([player.id, ...allies.map((r) => r.otherEntityId)])
  const threats = Object.values(state.entities)
    .filter((e) => !notAllied.has(e.id))
    .map((e) => ({ e, strength: militaryStrength(e) }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 5)
  lines.push('')
  lines.push('=== Largest military powers we are not allied with (est.) ===')
  for (const { e } of threats) {
    lines.push(`${e.name}: ${summarizeForeignMilitary(e)}`)
  }

  return lines.join('\n')
}
