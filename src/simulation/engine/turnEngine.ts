import { produce } from 'immer'
import type { WorldState } from '@/domain/schemas'
import { advanceEconomy } from '../modules/economy'
import { advanceMilitary } from '../modules/military'
import { advanceDiplomacy } from '../modules/diplomacy'
import { advanceGovernment } from '../modules/government'
import { advanceWars } from '../modules/war'
import { runAiDecisions } from '../modules/aiDecisions'
import { considerCivilWar } from '../modules/civilWar'
import { generateWorldEvents } from '../modules/worldEvents'

/** Advance the world by exactly one turn (one week). Pure function: takes a
 *  state, returns a new state, never mutates its input (callers -- the save
 *  system, undo/redo, the worker message boundary -- all depend on that).
 *
 *  Every turn is a WORLD turn, not just a player turn: after the player's own
 *  command has already been applied (by the validator, before advanceTurn is
 *  called), this function is what makes the rest of the world move on its
 *  own -- every other country's economy, military, government, and
 *  diplomacy advance, AI countries make their own decisions, wars and civil
 *  wars progress and can start or end, and emergent world events fire,
 *  independent of anything the player did this turn. */
export function advanceTurn(state: WorldState, rng: () => number = Math.random): WorldState {
  return produce(state, (draft) => {
    const nextTurn = draft.turn + 1
    const atWarIds = new Set(
      Object.values(draft.wars)
        .filter((w) => w.active)
        .flatMap((w) => [...w.attackerIds, ...w.defenderIds]),
    )

    for (const entity of Object.values(draft.entities)) {
      advanceEconomy(entity)
      advanceMilitary(entity, atWarIds.has(entity.id))
      advanceDiplomacy(entity)
      advanceGovernment(draft, entity, nextTurn, rng)
      considerCivilWar(draft, entity, nextTurn, rng)
    }

    advanceWars(draft, nextTurn, rng)
    runAiDecisions(draft, nextTurn, rng)
    generateWorldEvents(draft, nextTurn, rng)

    draft.turn = nextTurn
  })
}

export function advanceTurns(state: WorldState, count: number, rng: () => number = Math.random): WorldState {
  let next = state
  for (let i = 0; i < count; i++) next = advanceTurn(next, rng)
  return next
}
