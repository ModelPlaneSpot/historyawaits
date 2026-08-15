import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '@/state/gameStore'
import { localAiEngine } from '@/ai/localAiEngine'
import { currentAdvisorSource, type AdvisorSource } from '@/ai/advisorChat'

const SUGGESTED_QUESTIONS = [
  'What should I do next?',
  'What are my biggest weaknesses?',
  'How strong is my military?',
  'Which country is the biggest threat to me?',
  'Give me three possible strategies.',
]

const SOURCE_LABELS: Record<AdvisorSource, string> = {
  'local-ai': 'Local AI',
  'cloud-ai': 'Cloud AI',
  fallback: 'Basic fallback parser',
}

export function AdvisorPanel() {
  const open = useGameStore((s) => s.advisorOpen)
  const toggleAdvisor = useGameStore((s) => s.toggleAdvisor)
  const advisorState = useGameStore((s) => s.advisorState)
  const advisorBusy = useGameStore((s) => s.advisorBusy)
  const advisorError = useGameStore((s) => s.advisorError)
  const askAdvisor = useGameStore((s) => s.askAdvisor)
  const aiStatus = useGameStore((s) => s.aiStatus)

  const [input, setInput] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [advisorState.messages.length, advisorBusy])

  if (!open) return null

  const source = currentAdvisorSource()

  async function handleSend(text: string) {
    if (!text.trim() || advisorBusy) return
    setInput('')
    await askAdvisor(text.trim())
  }

  return (
    <div className="advisor-overlay">
      <div className="advisor-panel">
        <div className="advisor-header">
          <strong>AI Advisor</strong>
          <span className="advisor-readonly-tag">read-only</span>
          <button onClick={toggleAdvisor} className="advisor-close">
            ✕
          </button>
        </div>

        <div className={`advisor-source-row ${source}`}>
          <span className="dot" />
          {SOURCE_LABELS[source]}
          {aiStatus === 'loading' && <span className="advisor-loading-note"> -- downloading local model (one-time, cached after)…</span>}
          {aiStatus === 'error' && (
            <button className="advisor-retry" onClick={() => localAiEngine.initialize()}>
              Retry
            </button>
          )}
        </div>

        <div className="advisor-log" ref={logRef}>
          {advisorState.messages.length === 0 && <div className="advisor-message assistant">How can I help?</div>}
          {advisorState.summary && <div className="advisor-summary-note">Earlier conversation summarized to save memory.</div>}
          {advisorState.messages.map((m) => (
            <div key={m.id} className={`advisor-message ${m.role}`}>
              {m.content}
            </div>
          ))}
          {advisorBusy && <div className="advisor-message assistant advisor-thinking">Thinking…</div>}
        </div>

        {advisorError && <div className="advisor-error">{advisorError}</div>}

        {advisorState.messages.length === 0 && (
          <div className="advisor-suggestions">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button key={q} onClick={() => handleSend(q)} disabled={advisorBusy}>
                {q}
              </button>
            ))}
          </div>
        )}

        <form
          className="advisor-input-row"
          onSubmit={(e) => {
            e.preventDefault()
            handleSend(input)
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your advisor anything…"
            disabled={advisorBusy}
          />
          <button type="submit" className="primary" disabled={advisorBusy || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  )
}
