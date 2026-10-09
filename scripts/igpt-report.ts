// Plays N years with no player input and reports what IGPT decided:
//   npx tsx scripts/igpt-report.ts [years]
import { createNewGame } from '../src/simulation/newGame'
import { advanceTurn } from '../src/simulation/engine/turnEngine'
import { formatGameDate, yearsToTicks } from '../src/simulation/gameDate'
import type { IgptLogEntry } from '../src/domain/schemas'

const YEARS = Number(process.argv[2] ?? 5)
let state = createNewGame('USA')
// No human player here: let IGPT run the USA too, like every other country.
state.igpt.autopilot = true
const all: IgptLogEntry[] = []
let lastLogLen = 0
const start = Date.now()
const ticks = yearsToTicks(YEARS)
for (let i = 0; i < ticks; i++) {
  state = advanceTurn(state)
  // The in-state log is bounded; collect everything new each tick.
  const log = state.igpt.log
  const fresh = log.filter((e) => e.turn === state.turn)
  all.push(...fresh)
  lastLogLen = log.length
}
const ms = Date.now() - start
console.log(`${YEARS} years (${ticks} ticks) in ${ms}ms -> ${(ms / ticks).toFixed(1)}ms/tick; ${all.length} IGPT decisions (log ${lastLogLen})`)

const byMove = new Map<string, number>()
for (const e of all) byMove.set(e.move, (byMove.get(e.move) ?? 0) + 1)
console.log('By move:', [...byMove.entries()].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m}=${n}`).join(' '))

for (const kind of ['declare_war', 'propose_peace', 'form_alliance', 'sanction']) {
  console.log(`\n${kind}:`)
  for (const e of all.filter((x) => x.move === kind).slice(0, 12)) {
    console.log(`  ${formatGameDate(e.turn)}  ${e.summary}  [${e.reasons.slice(0, 2).join(' | ')}]`)
  }
}

const wars = Object.values(state.wars)
console.log(`\nWars: ${wars.length} total, ${wars.filter((w) => w.active).length} active, civil ${wars.filter((w) => w.isCivilWar).length}`)
const rusUkr = state.wars['WAR-RUS-UKR-0']
console.log(`Russia-Ukraine: active=${rusUkr.active} score=${rusUkr.warScore.toFixed(0)} ended=${rusUkr.endTurn !== null ? formatGameDate(rusUkr.endTurn) : '-'}; regions held by RUS: ${rusUkr.contestedRegionIds.filter((r) => state.regions[r].controllerId === 'RUS').map((r) => state.regions[r].name).join(', ')}`)
console.log(`Sanctions active: ${Object.keys(state.sanctions).length}`)
console.log('Learned (global):', Object.entries(state.igpt.global).map(([m, s]) => `${m}:${(s.reward * 1000).toFixed(1)}(n${s.n})`).join(' '))
for (const id of ['USA', 'CHN', 'RUS', 'UKR', 'DEU', 'IND']) {
  const e = state.entities[id]
  console.log(`${id}: gdp $${(e.economy.gdpUsd / 1e12).toFixed(2)}T debt ${e.economy.debtToGdpPct.toFixed(0)}% tax ${e.economy.taxRatePct.toFixed(0)}% mil ${e.economy.militarySpendingPctOfGdp.toFixed(1)}% tech ${e.military.techLevel.toFixed(0)} regions ${e.territoryRegionIds.length}`)
}
const { computeStandings, VICTORY_CATEGORIES } = await import('../src/simulation/victory')
const standings = computeStandings(state)
for (const cat of VICTORY_CATEGORIES) {
  console.log(`${cat.title}: ${standings.byCategory[cat.id].slice(0, 6).map((s) => `${s.name}${cat.id === 'economy' ? ` ($${(s.gdpUsd / 1e12).toFixed(1)}T, ${s.debtToGdpPct.toFixed(0)}%)` : ''}`).join(', ')}`)
}
