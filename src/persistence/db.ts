import Dexie, { type EntityTable } from 'dexie'
import type { WorldState } from '@/domain/schemas'

export interface SaveRecord {
  id: string
  name: string
  savedAt: number
  isAutosave: boolean
  state: WorldState
}

class HistoryAwaitsDB extends Dexie {
  saves!: EntityTable<SaveRecord, 'id'>

  constructor() {
    super('historyawaits')
    this.version(1).stores({
      saves: 'id, savedAt, isAutosave',
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
}
