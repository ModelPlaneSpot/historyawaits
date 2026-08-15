import Dexie, { type EntityTable } from 'dexie'
import type { WorldState } from '@/domain/schemas'
import type { AdvisorState } from '@/ai/advisorChat'

export interface SaveRecord {
  id: string
  name: string
  savedAt: number
  isAutosave: boolean
  state: WorldState
}

export interface AdvisorRecord {
  saveId: string
  state: AdvisorState
}

class HistoryAwaitsDB extends Dexie {
  saves!: EntityTable<SaveRecord, 'id'>
  advisorChats!: EntityTable<AdvisorRecord, 'saveId'>

  constructor() {
    super('historyawaits')
    this.version(1).stores({
      saves: 'id, savedAt, isAutosave',
    })
    this.version(2).stores({
      saves: 'id, savedAt, isAutosave',
      advisorChats: 'saveId',
    })
  }
}

export const db = new HistoryAwaitsDB()

export const AUTOSAVE_ID = 'autosave'

export async function saveGame(state: WorldState, name: string, isAutosave = false): Promise<string> {
  const id = isAutosave ? AUTOSAVE_ID : `save-${Date.now()}`
  await db.saves.put({ id, name, savedAt: Date.now(), isAutosave, state })
  return id
}

export async function loadGame(id: string): Promise<WorldState | null> {
  const record = await db.saves.get(id)
  return record?.state ?? null
}

export async function listSaves(): Promise<SaveRecord[]> {
  const all = await db.saves.toArray()
  return all.sort((a, b) => b.savedAt - a.savedAt)
}

export async function deleteSave(id: string): Promise<void> {
  await db.saves.delete(id)
  await db.advisorChats.delete(id)
}

export async function saveAdvisorState(saveId: string, state: AdvisorState): Promise<void> {
  await db.advisorChats.put({ saveId, state })
}

export async function loadAdvisorState(saveId: string): Promise<AdvisorState | null> {
  const record = await db.advisorChats.get(saveId)
  return record?.state ?? null
}
