import { useGameStore } from '@/state/gameStore'
import { formatGameDate } from '@/simulation/gameDate'
import { STORY_TYPE_LABELS, STORY_STATUS_LABELS } from './panels/storyMeta'
import { IMPORTANCE_LABELS } from './panels/newsMeta'

export function EventDetailPanel() {
  const storyId = useGameStore((s) => s.storyDetailId)
  const worldState = useGameStore((s) => s.worldState)
  const closeStory = useGameStore((s) => s.closeStory)
  const focusOn = useGameStore((s) => s.focusOn)
  const toggleFollowStory = useGameStore((s) => s.toggleFollowStory)

  if (!storyId || !worldState) return null
  const story = worldState.storyEvents[storyId]
  if (!story) return null

  const countryNames = story.countryIds.map((id) => worldState.entities[id]?.name ?? id)
  const regionNames = story.regionIds.map((id) => worldState.regions[id]?.name).filter((n): n is string => !!n)
  const canViewOnMap = !!(story.countryIds[0] || story.regionIds[0])

  function viewOnMap() {
    focusOn({ entityId: story.regionIds[0] ? null : (story.countryIds[0] ?? null), regionId: story.regionIds[0] ?? null })
    closeStory()
  }

  return (
    <div className="modal-overlay" onClick={closeStory}>
      <div className="event-detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="advisor-header">
          <strong>{story.title}</strong>
          <button onClick={closeStory} className="advisor-close">
            ✕
          </button>
        </div>

        <div className="event-detail-scroll">
          <div className="event-meta-grid">
            <div>
              <span className="event-meta-label">Date</span>
              {formatGameDate(story.startTurn)}
              {story.endTurn !== null ? ` – ${formatGameDate(story.endTurn)}` : ''}
            </div>
            <div>
              <span className="event-meta-label">Location</span>
              {regionNames.length > 0 ? regionNames.join(', ') : countryNames.join(', ') || 'Unknown'}
            </div>
            <div>
              <span className="event-meta-label">Countries Involved</span>
              {countryNames.join(', ') || 'Unknown'}
            </div>
            <div>
              <span className="event-meta-label">Type</span>
              {STORY_TYPE_LABELS[story.type]}
            </div>
            <div>
              <span className="event-meta-label">Severity</span>
              {IMPORTANCE_LABELS[story.importance]}
            </div>
            <div>
              <span className="event-meta-label">Status</span>
              {STORY_STATUS_LABELS[story.status]}
            </div>
          </div>

          <div className="event-story-body">
            <h4>Background</h4>
            <p>{story.background}</p>
            <h4>Trigger</h4>
            <p>{story.trigger}</p>
            <h4>Current Situation</h4>
            <p className="event-situation">{story.situation}</p>
            <h4>International Reaction</h4>
            <p>{story.internationalReaction}</p>
            <h4>Possible Consequences</h4>
            <p>{story.consequences}</p>
          </div>

          <div className="event-timeline">
            <h4>Timeline</h4>
            {story.stages.map((stage, i) => (
              <div key={i} className="event-timeline-stage">
                <span className="event-timeline-turn">T{stage.turn}</span>
                <div>
                  <strong>{stage.headline}</strong>
                  <p>{stage.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="event-detail-actions">
          <button onClick={viewOnMap} disabled={!canViewOnMap}>
            View on Map
          </button>
          <button className={story.followed ? 'primary' : ''} onClick={() => toggleFollowStory(story.id)}>
            {story.followed ? '★ Following' : '☆ Follow Event'}
          </button>
        </div>
      </div>
    </div>
  )
}
