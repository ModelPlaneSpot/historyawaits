import { useRef, useState } from 'react'
import { useGameStore } from '@/state/gameStore'

export function CommandConsole() {
  const [input, setInput] = useState('')
  const log = useGameStore((s) => s.log)
  const submitCommand = useGameStore((s) => s.submitCommand)
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
      <form className="command-input-row" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='Try: "declare war on Iran", "annex Gaza and dissolve Hamas", "build 100 tanks"'
        />
        <button type="submit" className="primary">
          Send
        </button>
      </form>
    </div>
  )
}
