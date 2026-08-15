import type { WorldState, WorldEntity } from '@/domain/schemas'
import { militaryStrength } from '@/simulation/modules/military'
import { formatGameDate } from '@/simulation/gameDate'
import { buildResolverIndex, resolveEntity } from '@/command/entityResolver'

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
  return `est. ${estimateBand(m.personnelActive)} active personnel, ${estimateBand(m.equipment.tanks)} tanks, ${estimateBand(m.equipment.aircraft)} aircraft, ${estimateBand(m.equipment.ships)} ships`
}

function foreignEconomySummary(entity: WorldEntity): string {
  return `est. GDP ${fmtUsd(entity.economy.gdpUsd)}, growth ${entity.economy.growthRatePct.toFixed(1)}%/yr`
}

const KEYWORDS = {
  military: /\b(military|army|troops|soldiers?|tanks?|aircraft|navy|ships?|war|invade|invasion|attack|combat|strength|forces|weapons|arsenal)\b/i,
  economy: /\b(econom|gdp|inflation|debt|trade|tax|budget|treasury|unemploy|growth|recession|industr|production)\b/i,
  diplomacy: /\b(ally|allies|alliance|relation|treaty|treaties|diplomat|friend|enem|sanction)\b/i,
  broad: /\b(suggest|strategy|strategies|what should|options|advice|overview|situation)\b/i,
}

/** A compact, player-relevant slice of world state -- rebuilt fresh from the
 *  live WorldState on every single message, never cached or reused from an
 *  earlier turn. Always includes a short core summary; adds detail sections
 *  only when the player's question is actually about that topic, and adds a
 *  named country's own data when the question mentions one by name, so the
 *  model isn't handed the entire 200-entity world every time. */
export function buildAdvisorContext(state: WorldState, questionText: string): string {
  const player = state.entities[state.playerEntityId]
  if (!player) return 'No active game.'

  const lines: string[] = []
  lines.push(`Player nation: ${player.name} (${player.government.type.replace('_', ' ')})`)
  lines.push(`Current in-game date: ${formatGameDate(state.turn)} (turn ${state.turn}; this is the CURRENT date -- if it conflicts with anything said earlier in this conversation, THIS is correct)`)
  lines.push('')
  lines.push('=== Core summary (always current) ===')
  lines.push(`GDP: ${fmtUsd(player.economy.gdpUsd)} (${player.economy.growthRatePct.toFixed(1)}%/yr), Treasury: ${fmtUsd(player.economy.treasuryUsd)}, Debt: ${player.economy.debtToGdpPct.toFixed(0)}% of GDP`)
  lines.push(`Military: ${fmtNum(player.military.personnelActive)} active personnel, ${fmtNum(player.military.equipment.tanks)} tanks, ${fmtNum(player.military.equipment.aircraft)} aircraft, ${fmtNum(player.military.equipment.ships)} ships, ${fmtNum(player.military.equipment.artillery)} artillery`)
  lines.push(`Stability: ${player.government.stability.toFixed(0)}/100, Public unrest: ${player.population.unrest.toFixed(0)}/100, Population: ${fmtNum(player.population.total)}`)

  const activeWars = Object.values(state.wars).filter(
    (w) => w.active && (w.attackerIds.includes(player.id) || w.defenderIds.includes(player.id)),
  )
  if (activeWars.length === 0) {
    lines.push('At war: no')
  } else {
    const opponentNames = activeWars
      .flatMap((w) => (w.attackerIds.includes(player.id) ? w.defenderIds : w.attackerIds))
      .map((id) => state.entities[id]?.name ?? id)
      .join(', ')
    lines.push(`At war: yes, with ${opponentNames}`)
  }

  const wantsMilitary = KEYWORDS.military.test(questionText) || KEYWORDS.broad.test(questionText)
  const wantsEconomy = KEYWORDS.economy.test(questionText) || KEYWORDS.broad.test(questionText)
  const wantsDiplomacy = KEYWORDS.diplomacy.test(questionText) || KEYWORDS.broad.test(questionText)

  if (wantsMilitary) {
    lines.push('')
    lines.push('=== Our military (exact -- this is our own force) ===')
    lines.push(`Active personnel: ${fmtNum(player.military.personnelActive)}, Reserve: ${fmtNum(player.military.personnelReserve)}`)
    lines.push(`Equipment: ${fmtNum(player.military.equipment.tanks)} tanks, ${fmtNum(player.military.equipment.aircraft)} aircraft, ${fmtNum(player.military.equipment.ships)} ships, ${fmtNum(player.military.equipment.artillery)} artillery`)
    lines.push(`Tech level: ${player.military.techLevel}/100, Morale: ${player.military.morale}/100, Mobilization: ${player.military.mobilizationLevel}/100`)
    lines.push(`Military spending: ${player.economy.militarySpendingPctOfGdp.toFixed(1)}% of GDP`)
    lines.push('(This simulation tracks tanks/aircraft/ships/artillery as unit categories -- it does not separately model IFVs/APCs, bomber vs fighter aircraft, submarines vs surface ships, or nuclear weapons. Say so plainly if asked about those rather than inventing a number.)')

    if (activeWars.length > 0) {
      lines.push('')
      lines.push('=== Wars ===')
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

    const notAllied = new Set([player.id, ...player.relations.filter((r) => r.status === 'allied').map((r) => r.otherEntityId)])
    const threats = Object.values(state.entities)
      .filter((e) => !notAllied.has(e.id))
      .map((e) => ({ e, strength: militaryStrength(e) }))
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 5)
    lines.push('')
    lines.push('=== Largest military powers we are not allied with (est.) ===')
    for (const { e } of threats) lines.push(`${e.name}: ${summarizeForeignMilitary(e)}`)
  }

  if (wantsEconomy) {
    lines.push('')
    lines.push('=== Our economy (exact) ===')
    lines.push(`GDP per capita: ${fmtUsd(player.economy.gdpPerCapitaUsd)}`)
    lines.push(`Unemployment: ${player.economy.unemploymentRatePct.toFixed(1)}%, Inflation: ${player.economy.inflationPct.toFixed(1)}%`)
    lines.push(`Trade balance: ${fmtUsd(player.economy.tradeBalanceUsd)}`)
    lines.push(`Military spending: ${player.economy.militarySpendingPctOfGdp.toFixed(1)}% of GDP (a direct drain on the treasury)`)
    const recentEconomicNews = state.news
      .filter((n) => n.entityIds.includes(player.id))
      .slice(-8)
      .filter((n) => /econom|gdp|trade|sanction|treasury|debt/i.test(n.headline + n.body))
    if (recentEconomicNews.length) {
      lines.push('Recent related events: ' + recentEconomicNews.map((n) => n.headline).join('; '))
    }
  }

  if (wantsDiplomacy) {
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
  }

  // If the question names a specific other country, include that country's
  // own data (still framed as an estimate) so comparisons work.
  const index = buildResolverIndex(state)
  const mentioned = resolveEntity(questionText, index)
  if (mentioned && mentioned !== player.id) {
    const other = state.entities[mentioned]
    if (other) {
      lines.push('')
      lines.push(`=== ${other.name} (est. -- mentioned in your question) ===`)
      lines.push(summarizeForeignMilitary(other))
      lines.push(foreignEconomySummary(other))
      const relation = player.relations.find((r) => r.otherEntityId === mentioned)
      lines.push(`Our relationship: ${relation?.status ?? 'neutral'} (opinion ${relation?.opinion.toFixed(0) ?? 0}/100)`)
    }
  }

  lines.push('')
  lines.push('=== Territory ===')
  const controlledCount = player.territoryRegionIds.length
  const disputedControlled = player.territoryRegionIds.filter((id) => state.regions[id]?.disputed).length
  lines.push(`Regions controlled: ${controlledCount}${disputedControlled ? ` (${disputedControlled} disputed/contested)` : ''}`)

  return lines.join('\n')
}
