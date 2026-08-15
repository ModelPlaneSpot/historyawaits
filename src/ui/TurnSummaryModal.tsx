import { useGameStore } from '@/state/gameStore'
import { CATEGORY_ICONS } from './panels/newsMeta'

export function TurnSummaryModal() {
  const show = useGameStore((s) => s.showTurnSummary)
  const summary = useGameStore((s) => s.turnSummary)
  const dismiss = useGameStore((s) => s.dismissTurnSummary)
  const focusOn = useGameStore((s) => s.focusOn)

  if (!show || !summary) return null

  return (
    <div className="modal-overlay" onClick={dismiss}>
      <div className="turn-summary-modal" onClick={(e) => e.stopPropagation()}>
        <div className="advisor-header">
          <strong>Turn {summary.turn} Complete</strong>
          <button onClick={dismiss} className="advisor-close">
            ✕
          </button>
        </div>

        <section className="turn-summary-section">
          <h4>Your Country</h4>
          <ul className="turn-summary-list">
            {summary.playerChanges.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>

        <section className="turn-summary-section">
          <h4>World Events</h4>
          {summary.worldEvents.length === 0 && <div className="turn-summary-empty">A quiet turn around the world.</div>}
          <ul className="turn-summary-list turn-summary-events">
            {summary.worldEvents.map((e) => {
              const clickable = !!(e.locationEntityId || e.locationRegionId)
              return (
                <li
                  key={e.id}
                  className={`importance-${e.importance} ${clickable ? 'clickable' : ''}`}
                  onClick={() => {
                    if (!clickable) return
                    focusOn({ entityId: e.locationEntityId, regionId: e.locationRegionId })
                    dismiss()
                  }}
                >
                  <span className="news-icon">{CATEGORY_ICONS[e.category]}</span>
                  {e.headline}
                </li>
              )
            })}
          </ul>
        </section>

        <button className="primary turn-summary-continue" onClick={dismiss}>
          Continue
        </button>
      </div>
    </div>
  )
}
