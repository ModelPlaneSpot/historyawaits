import { createNewGame } from '../src/simulation/newGame'
import { advanceTurn } from '../src/simulation/engine/turnEngine'
import { FINAL_TICK, formatGameDate } from '../src/simulation/gameDate'
import { computeStandings, VICTORY_CATEGORIES } from '../src/simulation/victory'
import { WorldState } from '../src/domain/schemas'

// Default: the whole century (Jan 1 2026 -> Jan 1 2126) in 3-day ticks.
const TURNS = Number(process.argv[2] ?? FINAL_TICK)

function main() {
  let state = createNewGame('USA')
  console.log(`Running ${TURNS} ticks headless (${formatGameDate(0)} onward)...`)
  const start = Date.now()
  let quietTicks = 0
  for (let i = 0; i < TURNS && state.turn < FINAL_TICK; i++) {
    state = advanceTurn(state)
    if (!state.news.some((n) => n.turn === state.turn)) quietTicks++
    if (state.turn % 1218 === 0) console.log(`  ${formatGameDate(state.turn)} (${Date.now() - start}ms)`)
  }
  const final = state
  const elapsedMs = Date.now() - start

  WorldState.parse(final) // re-validate after N ticks of mutation

  let nanCount = 0
  let negativeCount = 0
  for (const entity of Object.values(final.entities)) {
    for (const [k, v] of Object.entries(entity.economy)) {
      if (typeof v === 'number' && !Number.isFinite(v)) {
        console.error(`NaN/Infinity: ${entity.id}.economy.${k}`)
        nanCount++
      }
    }
    if (entity.economy.gdpUsd < 0 || entity.population.total < 0) negativeCount++
  }

  console.log(`Completed ${final.turn} ticks in ${elapsedMs}ms (${(elapsedMs / Math.max(1, final.turn)).toFixed(2)}ms/tick)`)
  console.log(`Final date: ${formatGameDate(final.turn)}`)
  console.log(`Ticks without an event: ${quietTicks}`)
  console.log(`Wars: ${Object.values(final.wars).length} total, ${Object.values(final.wars).filter((w) => w.active).length} active`)
  console.log(`Stories: ${Object.keys(final.storyEvents).length}, news kept: ${final.news.length}`)
  console.log(`NaN/Infinity fields: ${nanCount}, negative core stats: ${negativeCount}`)

  const standings = computeStandings(final)
  for (const cat of VICTORY_CATEGORIES) {
    const top = standings.byCategory[cat.id].slice(0, 3).map((s) => s.name).join(', ')
    console.log(`${cat.title}: ${top}`)
  }
  console.log(`Overall winner: ${standings.overall[0]?.name} (${standings.overall[0]?.categoriesWon} categories)`)

  if (nanCount > 0 || negativeCount > 0) {
    process.exitCode = 1
  }
}

main()
