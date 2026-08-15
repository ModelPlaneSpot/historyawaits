import { createNewGame } from '../src/simulation/newGame'
import { advanceTurns } from '../src/simulation/engine/turnEngine'
import { WorldState } from '../src/domain/schemas'

const TURNS = Number(process.argv[2] ?? 104) // ~2 years of weekly turns

function main() {
  const state = createNewGame('USA')
  console.log(`Running ${TURNS} turns headless...`)
  const start = Date.now()
  const final = advanceTurns(state, TURNS)
  const elapsedMs = Date.now() - start

  WorldState.parse(final) // re-validate after N turns of mutation

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

  console.log(`Completed ${TURNS} turns in ${elapsedMs}ms (${(elapsedMs / TURNS).toFixed(2)}ms/turn)`)
  console.log(`Final turn: ${final.turn}`)
  console.log(`Active wars: ${Object.values(final.wars).filter((w) => w.active).length}`)
  console.log(`News events: ${final.news.length}`)
  console.log(`NaN/Infinity fields: ${nanCount}, negative core stats: ${negativeCount}`)

  if (nanCount > 0 || negativeCount > 0) {
    process.exitCode = 1
  }
}

main()
