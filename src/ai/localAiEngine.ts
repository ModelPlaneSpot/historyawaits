import type { MLCEngine, InitProgressReport } from '@mlc-ai/web-llm'

export const AI_MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'

export type AiEngineStatus = 'unloaded' | 'loading' | 'ready' | 'unavailable' | 'error'
type StatusListener = (status: AiEngineStatus, report?: InitProgressReport) => void

/**
 * Single shared local-model instance used by both the command parser
 * (src/command/aiParser.ts) and the advisor chat (src/ai/advisorChat.ts) --
 * one ~1GB download, one loaded model, two different prompts against it.
 */
class LocalAiEngine {
  private engine: MLCEngine | null = null
  private status: AiEngineStatus = 'unloaded'
  private listeners = new Set<StatusListener>()
  private loadPromise: Promise<void> | null = null

  supportsWebGpu(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator
  }

  isReady(): boolean {
    return this.status === 'ready' && this.engine !== null
  }

  getEngine(): MLCEngine | null {
    return this.engine
  }

  getStatus(): AiEngineStatus {
    return this.status
  }

  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setStatus(status: AiEngineStatus, report?: InitProgressReport) {
    this.status = status
    for (const listener of this.listeners) listener(status, report)
  }

  /** Explicitly triggered by the UI, never on the hot path of a single
   *  parse/chat call -- first load downloads ~1GB. */
  async initialize(): Promise<void> {
    if (this.status === 'ready') return
    if (this.loadPromise) return this.loadPromise
    if (!this.supportsWebGpu()) {
      this.setStatus('unavailable')
      return
    }
    this.setStatus('loading')
    this.loadPromise = (async () => {
      try {
        const webllm = await import('@mlc-ai/web-llm')
        this.engine = await webllm.CreateMLCEngine(AI_MODEL_ID, {
          initProgressCallback: (report) => this.setStatus('loading', report),
        })
        this.setStatus('ready')
      } catch (err) {
        console.error('Local AI model failed to load', err)
        this.setStatus('error')
        this.engine = null
      } finally {
        this.loadPromise = null
      }
    })()
    return this.loadPromise
  }

  unload(): void {
    this.engine = null
    this.setStatus(this.supportsWebGpu() ? 'unloaded' : 'unavailable')
  }
}

export const localAiEngine = new LocalAiEngine()
