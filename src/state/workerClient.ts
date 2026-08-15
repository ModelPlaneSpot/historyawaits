import type { WorkerRequest, WorkerResponse } from '@/simulation/worker/protocol'

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

let worker: Worker | null = null
let counter = 0
const pending = new Map<string, (response: WorkerResponse) => void>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../simulation/worker/simulation.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const resolve = pending.get(event.data.requestId)
      if (resolve) {
        pending.delete(event.data.requestId)
        resolve(event.data)
      }
    }
  }
  return worker
}

function send(request: DistributiveOmit<WorkerRequest, 'requestId'>): Promise<WorkerResponse> {
  const requestId = `req-${counter++}`
  return new Promise((resolve) => {
    pending.set(requestId, resolve)
    getWorker().postMessage({ ...request, requestId } as WorkerRequest)
  })
}

export const workerClient = {
  newGame: (playerEntityId: string) => send({ type: 'NEW_GAME', playerEntityId }),
  loadState: (state: import('@/domain/schemas').WorldState) => send({ type: 'LOAD_STATE', state }),
  submitAction: (action: import('@/domain/schemas').StructuredAction) => send({ type: 'SUBMIT_ACTION', action }),
  endTurn: () => send({ type: 'END_TURN' }),
}
