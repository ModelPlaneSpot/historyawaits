import type { WorldState, StructuredAction } from '@/domain/schemas'

export type WorkerRequest =
  | { type: 'NEW_GAME'; playerEntityId: string; requestId: string }
  | { type: 'LOAD_STATE'; state: WorldState; requestId: string }
  | { type: 'SUBMIT_ACTION'; action: StructuredAction; requestId: string }
  | { type: 'END_TURN'; requestId: string }

export type WorkerResponse =
  | { type: 'STATE'; state: WorldState; requestId: string }
  | { type: 'ACTION_RESULT'; ok: boolean; message: string; state: WorldState | null; requestId: string }
  | { type: 'ERROR'; message: string; requestId: string }
