import type { WorldState, StructuredPlan } from '@/domain/schemas'

export type WorkerRequest =
  | { type: 'NEW_GAME'; playerEntityId: string; requestId: string }
  | { type: 'LOAD_STATE'; state: WorldState; requestId: string }
  | { type: 'SUBMIT_ACTION'; plan: StructuredPlan; requestId: string }
  | { type: 'END_TURN'; requestId: string }
  | { type: 'TOGGLE_FOLLOW_STORY'; storyId: string; requestId: string }

export type WorkerResponse =
  | { type: 'STATE'; state: WorldState; requestId: string }
  | { type: 'ACTION_RESULT'; ok: boolean; message: string; state: WorldState | null; requestId: string }
  | { type: 'ERROR'; message: string; requestId: string }
