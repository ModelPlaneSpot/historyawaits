import { useRef, useState } from 'react'
import { useGameStore } from '@/state/gameStore'

export function CommandConsole() {
  const [input, setInput] = useState('')
  const log = useGameStore((s) => s.log)
  const submitCommand = useGameStore((s) => s.submitCommand)
  const pendingCommand = useGameStore((s) => s.pendingCommand)
  const confirmPendingCommand = useGameStore((s) => s.confirmPendingCommand)
  const cancelPendingCommand = useGameStore((s) => s.cancelPendingCommand)
  const logRef = useRef<HTMLDivElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    setInput('')
    await submitCommand(text)
    requestAnimationFrame(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
    })
  }

  async function handleConfirm() {
    await confirmPendingCommand()
    requestAnimationFrame(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
    })
  }

  return (
    <div className="command-console">
      <div className="command-log" ref={logRef}>
        {log.map((entry) => (
          <div key={entry.id} className={`command-log-entry ${entry.kind}`}>
            {entry.kind === 'player' ? '> ' : ''}
            {entry.text}
            {entry.source === 'ai' && <span style={{ color: 'var(--text-dim)' }}> (AI)</span>}
          </div>
        ))}
      </div>
      {pendingCommand && (
        <div className="pending-command-row">
          <span>
            Interpreted as: <strong>{pendingCommand.summary}</strong>
          </span>
          <div className="pending-command-actions">
            <button className="primary" onClick={handleConfirm}>
              Confirm
            </button>
            <button onClick={cancelPendingCommand}>Cancel</button>
          </div>
        </div>
      )}
      <form className="command-input-row" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='Talk to your government naturally, e.g. "atack iran and moblize 50k troops"'
        />
        <button type="submit" className="primary">
          Send
        </button>
      </form>
    </div>
  )
}
