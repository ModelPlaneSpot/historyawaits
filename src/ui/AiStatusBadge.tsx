import { useGameStore } from '@/state/gameStore'
import { localAiEngine } from '@/ai/localAiEngine'

const LABELS: Record<string, string> = {
  unloaded: 'Local AI: off',
  loading: 'Local AI: loading model...',
  ready: 'Local AI: ready',
  unavailable: 'Local AI: unsupported browser',
  error: 'Local AI: failed to load',
}

export function AiStatusBadge() {
  const aiStatus = useGameStore((s) => s.aiStatus)
  const enableAi = useGameStore((s) => s.enableAi)

  const canEnable = aiStatus === 'unloaded' && localAiEngine.supportsWebGpu()

  return (
    <div className={`ai-status ${aiStatus}`}>
      <span className="dot" />
      <span>{LABELS[aiStatus] ?? aiStatus}</span>
      {canEnable && (
        <button onClick={() => enableAi()} style={{ marginLeft: '0.4rem' }}>
          Enable (~1GB download)
        </button>
      )}
    </div>
  )
}
