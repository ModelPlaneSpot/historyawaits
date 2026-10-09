import type { WorldEntity, WorldState, NewsEvent } from '@/domain/schemas'

export interface TurnSummary {
  /** First and last tick the turn covered (see gameDate.ts). */
  fromTurn: number
  turn: number
  playerChanges: string[]
  /** What IGPT decided for the player's country this turn (autopilot). */
  autopilotDecisions: string[]
  worldEvents: NewsEvent[]
}

export function buildTurnSummary(prev: WorldState, next: WorldState): TurnSummary {
  const prevPlayer = prev.entities[prev.playerEntityId]
  const nextPlayer = next.entities[next.playerEntityId]
  return {
    fromTurn: prev.turn,
    autopilotDecisions: next.igpt.playerLog.filter((e) => e.turn > prev.turn).map((e) => e.summary.replace(/^[^:]+: /, '')),
    turn: next.turn,
    playerChanges: prevPlayer && nextPlayer ? buildPlayerChanges(prevPlayer, nextPlayer) : [],
    // advanceTurn tags every event with the tick it happened on, while
    // player-command news carries the tick it was issued on (prev.turn, since
    // commands don't advance the clock) -- so this picks up only what the
    // world did on its own across every tick of this turn.
    worldEvents: next.news.filter((n) => n.turn > prev.turn),
  }
}

function buildPlayerChanges(prev: WorldEntity, next: WorldEntity): string[] {
  const lines: string[] = []
  const econP = prev.economy
  const econN = next.economy

  if (Math.abs(econN.militarySpendingPctOfGdp - econP.militarySpendingPctOfGdp) > 0.05) {
    lines.push(`Military spending ${trend(econN.militarySpendingPctOfGdp, econP.militarySpendingPctOfGdp)} to ${econN.militarySpendingPctOfGdp.toFixed(1)}% of GDP.`)
  }
  if (Math.abs(econN.taxRatePct - econP.taxRatePct) > 0.05) {
    lines.push(`Tax rate ${trend(econN.taxRatePct, econP.taxRatePct)} to ${econN.taxRatePct.toFixed(1)}%.`)
  }
  const gdpDeltaPct = econP.gdpUsd > 0 ? ((econN.gdpUsd - econP.gdpUsd) / econP.gdpUsd) * 100 : 0
  if (Math.abs(gdpDeltaPct) > 0.01) {
    lines.push(`GDP ${gdpDeltaPct > 0 ? 'grew' : 'shrank'} ${Math.abs(gdpDeltaPct).toFixed(2)}%.`)
  }
  const troopDelta = next.military.personnelActive - prev.military.personnelActive
  if (Math.abs(troopDelta) >= 100) {
    lines.push(`${troopDelta > 0 ? '+' : ''}${troopDelta.toLocaleString()} active-duty personnel.`)
  }
  const stabilityDelta = next.government.stability - prev.government.stability
  if (Math.abs(stabilityDelta) >= 1) {
    lines.push(`Government stability ${stabilityDelta > 0 ? 'improved' : 'declined'} to ${next.government.stability.toFixed(0)}.`)
  }
  const territoryDelta = next.territoryRegionIds.length - prev.territoryRegionIds.length
  if (territoryDelta !== 0) {
    lines.push(`${territoryDelta > 0 ? 'Gained' : 'Lost'} ${Math.abs(territoryDelta)} region${Math.abs(territoryDelta) === 1 ? '' : 's'}.`)
  }
  if (lines.length === 0) lines.push('No significant changes to your country this turn.')
  return lines
}

function trend(next: number, prev: number): string {
  return next > prev ? 'increased' : 'decreased'
}
