import { create } from 'zustand'
import type { StructuredAction, StructuredPlan, WorldState } from '@/domain/schemas'
import { workerClient } from './workerClient'
import { interpretCommand } from '@/command/commandOrchestrator'
import { confidenceTier } from '@/command/types'
import { localAiEngine, type AiEngineStatus } from '@/ai/localAiEngine'
import { sendAdvisorMessage, emptyAdvisorState, type AdvisorState } from '@/ai/advisorChat'
import { buildTurnSummary, type TurnSummary } from './turnSummary'
import {
  saveGame,
  loadGame,
  listSaves,
  AUTOSAVE_ID,
  saveAdvisorState,
  loadAdvisorState,
  type SaveRecord,
} from '@/persistence/db'

/** Local AI is the only AI backend the game has (no cloud fallback) -- start
 *  loading it as soon as a game is entered so it's the default experience,
 *  not something the player has to discover and opt into. No-op if it's
 *  already loading/ready, or if the browser doesn't support WebGPU. */
function startLocalAiIfSupported(): void {
  if (localAiEngine.getStatus() === 'unloaded' && localAiEngine.supportsWebGpu()) {
    void localAiEngine.initialize()
  }
}

export interface FocusTarget {
  entityId: string | null
  regionId: string | null
}

export interface LogEntry {
  id: string
  turn: number
  kind: 'player' | 'result' | 'error' | 'system'
  text: string
  source?: 'ai' | 'fallback'
}

export interface PendingCommand {
  raw: string
  plan: StructuredPlan
  source: 'ai' | 'fallback'
  summary: string
}

/** Figures out which of a resolved step's ids are a region vs. a country, so
 *  a later "there"/"them" pronoun in the next command resolves against the
 *  right kind of thing. */
function lastTargetsFrom(action: StructuredAction, worldState: WorldState): { entityId: string | null; regionId: string | null } {
  let entityId: string | null = null
  let regionId: string | null = null
  if (action.target) {
    if (worldState.regions[action.target]) regionId = action.target
    else if (worldState.entities[action.target]) entityId = action.target
  }
  if (action.organization && worldState.entities[action.organization]) entityId = action.organization
  return { entityId, regionId }
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

  turnSummary: TurnSummary | null
  showTurnSummary: boolean
  focusTarget: FocusTarget | null
  focusNonce: number
  cameraAutoFollow: boolean
  newsOpen: boolean
  storyDetailId: string | null

  /** What the player's last resolved command was about, for pronoun
   *  resolution ("send another 20,000 there" / "attack them"). */
  lastEntityId: string | null
  lastRegionId: string | null
  pendingCommand: PendingCommand | null

  startNewGame: (playerEntityId: string) => Promise<void>
  continueFromSave: (id: string) => Promise<void>
  refreshSaves: () => Promise<void>
  submitCommand: (text: string) => Promise<void>
  executePlan: (plan: StructuredPlan, source: 'ai' | 'fallback') => Promise<void>
  confirmPendingCommand: () => Promise<void>
  cancelPendingCommand: () => void
  endTurn: () => Promise<void>
  selectEntity: (id: string | null) => void
  selectRegion: (id: string | null) => void
  selectRegionAndEntity: (regionId: string, entityId: string) => void
  enableAi: () => Promise<void>
  saveNow: (name?: string) => Promise<void>
  returnToMenu: () => void
  toggleAdvisor: () => void
  askAdvisor: (text: string) => Promise<void>
  focusOn: (target: FocusTarget) => void
  clearFocus: () => void
  setCameraAutoFollow: (v: boolean) => void
  dismissTurnSummary: () => void
  toggleNews: () => void
  openStory: (id: string) => void
  closeStory: () => void
  toggleFollowStory: (id: string) => Promise<void>
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

  turnSummary: null,
  showTurnSummary: false,
  focusTarget: null,
  focusNonce: 0,
  cameraAutoFollow: true,
  newsOpen: false,
  storyDetailId: null,

  lastEntityId: null,
  lastRegionId: null,
  pendingCommand: null,

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
      startLocalAiIfSupported()
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
      startLocalAiIfSupported()
    } else {
      set({ busy: false })
    }
  },

  refreshSaves: async () => {
    set({ saves: await listSaves() })
  },

  submitCommand: async (text: string) => {
    const { worldState, selectedRegionId, lastEntityId, lastRegionId } = get()
    if (!worldState) return
    set((s) => ({ log: [...s.log, makeLogEntry({ turn: worldState.turn, kind: 'player', text })], pendingCommand: null }))

    const parsed = await interpretCommand(text, { worldState, playerEntityId: worldState.playerEntityId, selectedRegionId, lastEntityId, lastRegionId })
    if (!parsed.ok || !parsed.plan) {
      set((s) => ({
        log: [...s.log, makeLogEntry({ turn: worldState.turn, kind: 'error', text: parsed.clarificationQuestion ?? parsed.error ?? 'Could not understand that command.', source: parsed.source })],
      }))
      return
    }

    const tier = confidenceTier(parsed.confidence)
    if (tier === 'medium') {
      const summary = parsed.interpretedSummary ?? 'the command above'
      set((s) => ({
        log: [...s.log, makeLogEntry({ turn: worldState.turn, kind: 'system', text: `Interpreted as: ${summary}. Confirm or cancel below.`, source: parsed.source })],
        pendingCommand: { raw: text, plan: parsed.plan!, source: parsed.source, summary },
      }))
      return
    }

    await get().executePlan(parsed.plan, parsed.source)
  },

  executePlan: async (plan: StructuredPlan, source: 'ai' | 'fallback') => {
    const { worldState } = get()
    if (!worldState) return
    const res = await workerClient.submitAction(plan)
    if (res.type === 'ACTION_RESULT') {
      const lastStep = plan.steps[plan.steps.length - 1]
      const { entityId, regionId } = lastStep ? lastTargetsFrom(lastStep, worldState) : { entityId: null, regionId: null }
      set((s) => ({
        log: [...s.log, makeLogEntry({ turn: worldState.turn, kind: res.ok ? 'result' : 'error', text: res.message, source })],
        worldState: res.state ?? s.worldState,
        lastEntityId: entityId ?? s.lastEntityId,
        lastRegionId: regionId ?? s.lastRegionId,
        pendingCommand: null,
      }))
    }
  },

  confirmPendingCommand: async () => {
    const pending = get().pendingCommand
    if (!pending) return
    await get().executePlan(pending.plan, pending.source)
  },

  cancelPendingCommand: () => {
    const worldState = get().worldState
    set((s) => ({
      pendingCommand: null,
      log: [...s.log, makeLogEntry({ turn: worldState?.turn ?? 0, kind: 'system', text: 'Cancelled.' })],
    }))
  },

  endTurn: async () => {
    const prevState = get().worldState
    set({ busy: true })
    const res = await workerClient.endTurn()
    if (res.type === 'STATE') {
      const summary = prevState ? buildTurnSummary(prevState, res.state) : null
      set((s) => ({
        worldState: res.state,
        busy: false,
        log: [...s.log, makeLogEntry({ turn: res.state.turn, kind: 'system', text: `Turn ${res.state.turn} begins.` })],
        turnSummary: summary,
        showTurnSummary: summary !== null,
      }))

      // Critical events (major war, civil war, coup, collapse, major
      // territorial change...) pull the camera toward them automatically,
      // unless the player has turned that off.
      if (get().cameraAutoFollow) {
        const critical = summary?.worldEvents.find((e) => e.importance === 'critical')
        if (critical && (critical.locationEntityId || critical.locationRegionId)) {
          get().focusOn({ entityId: critical.locationEntityId, regionId: critical.locationRegionId })
        }
      }

      await saveGame(res.state, 'Autosave', true)
      await get().refreshSaves()
    } else {
      set({ busy: false })
    }
  },

  selectEntity: (id) => set({ selectedEntityId: id, selectedRegionId: null }),
  selectRegion: (id) => set({ selectedRegionId: id }),
  selectRegionAndEntity: (regionId, entityId) => set({ selectedRegionId: regionId, selectedEntityId: entityId }),

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
    // Belt-and-suspenders: the model already starts loading as soon as a
    // game is entered, but this catches it if that somehow hasn't fired yet.
    if (get().advisorOpen) startLocalAiIfSupported()
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

  focusOn: (target) => set((s) => ({ focusTarget: target, focusNonce: s.focusNonce + 1 })),
  clearFocus: () => set({ focusTarget: null }),
  setCameraAutoFollow: (v) => set({ cameraAutoFollow: v }),
  dismissTurnSummary: () => set({ showTurnSummary: false }),
  toggleNews: () => set((s) => ({ newsOpen: !s.newsOpen })),

  openStory: (id) => set({ storyDetailId: id }),
  closeStory: () => set({ storyDetailId: null }),
  toggleFollowStory: async (id) => {
    const res = await workerClient.toggleFollowStory(id)
    if (res.type === 'STATE') set({ worldState: res.state })
  },
}))

localAiEngine.onStatusChange((status) => {
  useGameStore.setState({ aiStatus: status })
})

export function isAutosave(save: SaveRecord): boolean {
  return save.id === AUTOSAVE_ID
}
