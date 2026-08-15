import { create } from 'zustand'
import type { WorldState } from '@/domain/schemas'
import { workerClient } from './workerClient'
import { interpretCommand } from '@/command/commandOrchestrator'
import { localAiEngine, type AiEngineStatus } from '@/ai/localAiEngine'
import { sendAdvisorMessage, emptyAdvisorState, type AdvisorState } from '@/ai/advisorChat'
import {
  saveGame,
  loadGame,
  listSaves,
  AUTOSAVE_ID,
  saveAdvisorState,
  loadAdvisorState,
  type SaveRecord,
} from '@/persistence/db'

export interface LogEntry {
  id: string
  turn: number
  kind: 'player' | 'result' | 'error' | 'system'
  text: string
  source?: 'ai' | 'fallback'
}

interface GameStore {
  screen: 'menu' | 'playing'
  worldState: WorldState | null
  currentSaveId: string
  selectedEntityId: string | null
  selectedRegionId: string | null
  log: LogEntry[]
  aiStatus: AiEngineStatus
  saves: SaveRecord[]
  busy: boolean
  advisorState: AdvisorState
  advisorOpen: boolean
  advisorBusy: boolean
  advisorError: string | null

  startNewGame: (playerEntityId: string) => Promise<void>
  continueFromSave: (id: string) => Promise<void>
  refreshSaves: () => Promise<void>
  submitCommand: (text: string) => Promise<void>
  endTurn: () => Promise<void>
  selectEntity: (id: string | null) => void
  selectRegion: (id: string | null) => void
  enableAi: () => Promise<void>
  saveNow: (name?: string) => Promise<void>
  returnToMenu: () => void
  toggleAdvisor: () => void
  askAdvisor: (text: string) => Promise<void>
}

let logCounter = 0
function makeLogEntry(partial: Omit<LogEntry, 'id'>): LogEntry {
  logCounter += 1
  return { id: `log-${logCounter}`, ...partial }
}

export const useGameStore = create<GameStore>((set, get) => ({
  screen: 'menu',
  worldState: null,
  currentSaveId: AUTOSAVE_ID,
  selectedEntityId: null,
  selectedRegionId: null,
  log: [],
  aiStatus: localAiEngine.getStatus(),
  saves: [],
  busy: false,
  advisorState: emptyAdvisorState(),
  advisorOpen: false,
  advisorBusy: false,
  advisorError: null,

  startNewGame: async (playerEntityId: string) => {
    set({ busy: true })
    const res = await workerClient.newGame(playerEntityId)
    if (res.type === 'STATE') {
      set({
        worldState: res.state,
        screen: 'playing',
        currentSaveId: AUTOSAVE_ID,
        selectedEntityId: playerEntityId,
        selectedRegionId: null,
        log: [makeLogEntry({ turn: 0, kind: 'system', text: `New game started as ${res.state.entities[playerEntityId]?.name}.` })],
        advisorState: emptyAdvisorState(),
        busy: false,
      })
      await saveGame(res.state, 'Autosave', true)
      await saveAdvisorState(AUTOSAVE_ID, emptyAdvisorState())
      await get().refreshSaves()
    } else {
      set({ busy: false })
    }
  },

  continueFromSave: async (id: string) => {
    set({ busy: true })
    const state = await loadGame(id)
    if (!state) {
      set({ busy: false })
      return
    }
    const res = await workerClient.loadState(state)
    if (res.type === 'STATE') {
      const advisorState = (await loadAdvisorState(id)) ?? emptyAdvisorState()
      set({
        worldState: res.state,
        screen: 'playing',
        currentSaveId: id,
        selectedEntityId: res.state.playerEntityId,
        selectedRegionId: null,
        log: [makeLogEntry({ turn: res.state.turn, kind: 'system', text: 'Game loaded.' })],
        advisorState,
        busy: false,
      })
    } else {
      set({ busy: false })
    }
  },

  refreshSaves: async () => {
    set({ saves: await listSaves() })
  },

  submitCommand: async (text: string) => {
    const { worldState } = get()
    if (!worldState) return
    set((s) => ({ log: [...s.log, makeLogEntry({ turn: worldState.turn, kind: 'player', text })] }))

    const parsed = await interpretCommand(text, { worldState, playerEntityId: worldState.playerEntityId })
    if (!parsed.ok || !parsed.action) {
      set((s) => ({
        log: [...s.log, makeLogEntry({ turn: worldState.turn, kind: 'error', text: parsed.error ?? 'Could not understand that command.', source: parsed.source })],
      }))
      return
    }

    const res = await workerClient.submitAction(parsed.action)
    if (res.type === 'ACTION_RESULT') {
      set((s) => ({
        log: [...s.log, makeLogEntry({ turn: worldState.turn, kind: res.ok ? 'result' : 'error', text: res.message, source: parsed.source })],
        worldState: res.state ?? s.worldState,
      }))
    }
  },

  endTurn: async () => {
    set({ busy: true })
    const res = await workerClient.endTurn()
    if (res.type === 'STATE') {
      set((s) => ({
        worldState: res.state,
        busy: false,
        log: [...s.log, makeLogEntry({ turn: res.state.turn, kind: 'system', text: `Turn ${res.state.turn} begins.` })],
      }))
      await saveGame(res.state, 'Autosave', true)
      await get().refreshSaves()
    } else {
      set({ busy: false })
    }
  },

  selectEntity: (id) => set({ selectedEntityId: id, selectedRegionId: null }),
  selectRegion: (id) => set({ selectedRegionId: id }),

  enableAi: async () => {
    await localAiEngine.initialize()
  },

  saveNow: async (name = `Save ${new Date().toLocaleString()}`) => {
    const { worldState, advisorState } = get()
    if (!worldState) return
    const id = await saveGame(worldState, name, false)
    await saveAdvisorState(id, advisorState)
    set({ currentSaveId: id })
    await get().refreshSaves()
  },

  returnToMenu: () => set({ screen: 'menu', worldState: null, advisorOpen: false }),

  toggleAdvisor: () => {
    set((s) => ({ advisorOpen: !s.advisorOpen, advisorError: null }))
    // Opening the advisor is the player's clear signal they want AI features --
    // start the (one-time, cached) model download automatically so they don't
    // have to find and click a separate "enable" button first.
    if (get().advisorOpen && localAiEngine.getStatus() === 'unloaded' && localAiEngine.supportsWebGpu()) {
      void localAiEngine.initialize()
    }
  },

  askAdvisor: async (text: string) => {
    const { worldState, advisorState, currentSaveId } = get()
    if (!worldState) return
    set({ advisorBusy: true, advisorError: null })
    try {
      const { state: newState } = await sendAdvisorMessage(worldState, advisorState, text)
      set({ advisorState: newState, advisorBusy: false })
      await saveAdvisorState(currentSaveId, newState)
    } catch (err) {
      console.error('Advisor chat failed', err)
      set({ advisorBusy: false, advisorError: 'The advisor failed to respond. Try again.' })
    }
  },
}))

localAiEngine.onStatusChange((status) => {
  useGameStore.setState({ aiStatus: status })
})

export function isAutosave(save: SaveRecord): boolean {
  return save.id === AUTOSAVE_ID
}
