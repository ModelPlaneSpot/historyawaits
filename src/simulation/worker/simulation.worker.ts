/// <reference lib="webworker" />
import { produce } from 'immer'
import { emptyIgptState, type WorldState } from '@/domain/schemas'
import { createNewGame } from '../newGame'
import { advanceTurns } from '../engine/turnEngine'
import { daysToTicks, isGameOver } from '../gameDate'
import { validateAndApplyPlan } from '../validators/actionValidator'
import { toggleFollowStory } from '../modules/story'
import type { WorkerRequest, WorkerResponse } from './protocol'

let state: WorldState | null = null

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data
  try {
    switch (msg.type) {
      case 'NEW_GAME': {
        state = createNewGame(msg.playerEntityId)
        post({ type: 'STATE', state, requestId: msg.requestId })
        break
      }
      case 'LOAD_STATE': {
        // Saves from before sanctions/IGPT existed lack these fields.
        state = { ...msg.state, sanctions: msg.state.sanctions ?? {}, igpt: { ...emptyIgptState(), ...msg.state.igpt } }
        post({ type: 'STATE', state, requestId: msg.requestId })
        break
      }
      case 'SUBMIT_ACTION': {
        if (!state) throw new Error('No active game')
        const result = validateAndApplyPlan(state, msg.plan, state.turn)
        state = result.state
        post({ type: 'ACTION_RESULT', ok: result.ok, message: result.message, state: result.ok ? state : null, requestId: msg.requestId })
        break
      }
      case 'END_TURN': {
        if (!state) throw new Error('No active game')
        if (isGameOver(state.turn)) throw new Error('The game has ended')
        state = advanceTurns(state, daysToTicks(msg.days))
        post({ type: 'STATE', state, requestId: msg.requestId })
        break
      }
      case 'SET_IGPT_AUTOPILOT': {
        if (!state) throw new Error('No active game')
        state = produce(state, (draft) => {
          draft.igpt.autopilot = msg.enabled
        })
        post({ type: 'STATE', state, requestId: msg.requestId })
        break
      }
      case 'TOGGLE_FOLLOW_STORY': {
        if (!state) throw new Error('No active game')
        state = produce(state, (draft) => {
          toggleFollowStory(draft, msg.storyId)
        })
        post({ type: 'STATE', state, requestId: msg.requestId })
        break
      }
    }
  } catch (err) {
    post({ type: 'ERROR', message: err instanceof Error ? err.message : String(err), requestId: msg.requestId })
  }
}

function post(response: WorkerResponse) {
  ;(self as unknown as Worker).postMessage(response)
}
