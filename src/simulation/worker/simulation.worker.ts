/// <reference lib="webworker" />
import type { WorldState } from '@/domain/schemas'
import { createNewGame } from '../newGame'
import { advanceTurn } from '../engine/turnEngine'
import { validateAndApply } from '../validators/actionValidator'
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
        state = msg.state
        post({ type: 'STATE', state, requestId: msg.requestId })
        break
      }
      case 'SUBMIT_ACTION': {
        if (!state) throw new Error('No active game')
        const result = validateAndApply(state, msg.action, state.turn)
        if (result.ok && result.state) state = result.state
        post({ type: 'ACTION_RESULT', ok: result.ok, message: result.message, state: result.ok ? state : null, requestId: msg.requestId })
        break
      }
      case 'END_TURN': {
        if (!state) throw new Error('No active game')
        state = advanceTurn(state)
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
