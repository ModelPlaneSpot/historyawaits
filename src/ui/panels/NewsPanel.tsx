import type { NewsEvent, WorldState } from '@/domain/schemas'
import { useGameStore } from '@/state/gameStore'
import { CATEGORY_ICONS } from './newsMeta'

export function NewsPanel({ news, worldState }: { news: NewsEvent[]; worldState: WorldState }) {
  const focusOn = useGameStore((s) => s.focusOn)
  const toggleNews = useGameStore((s) => s.toggleNews)
  const recent = [...news].slice(-30).reverse()

  return (
    <section>
      <div className="news-panel-header">
        <h3>News</h3>
        <button className="news-panel-more" onClick={toggleNews}>
          Full feed →
        </button>
      </div>
      {recent.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>Nothing yet.</div>}
      {recent.map((n) => {
        const color = worldState.entities[n.entityIds[0]]?.mapColor
        const clickable = !!(n.locationEntityId || n.locationRegionId)
        return (
          <div
            key={n.id}
            className={`news-item importance-${n.importance} ${clickable ? 'clickable' : ''}`}
            onClick={() => clickable && focusOn({ entityId: n.locationEntityId, regionId: n.locationRegionId })}
          >
            <span className="news-icon">{CATEGORY_ICONS[n.category]}</span>
            {color && <span className="color-swatch" style={{ background: color, marginRight: '0.3rem' }} />}
            <span className="turn">T{n.turn}</span>
            {n.headline}
          </div>
        )
      })}
    </section>
  )
}
