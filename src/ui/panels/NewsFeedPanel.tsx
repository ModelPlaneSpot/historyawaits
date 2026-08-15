import { useState } from 'react'
import { useGameStore } from '@/state/gameStore'
import type { NewsCategory } from '@/domain/schemas'
import { CATEGORY_ICONS, CATEGORY_LABELS, ALL_CATEGORIES } from './newsMeta'

export function NewsFeedPanel() {
  const open = useGameStore((s) => s.newsOpen)
  const toggleNews = useGameStore((s) => s.toggleNews)
  const worldState = useGameStore((s) => s.worldState)
  const focusOn = useGameStore((s) => s.focusOn)
  const cameraAutoFollow = useGameStore((s) => s.cameraAutoFollow)
  const setCameraAutoFollow = useGameStore((s) => s.setCameraAutoFollow)
  const [activeCategories, setActiveCategories] = useState<Set<NewsCategory>>(new Set())

  if (!open || !worldState) return null

  function toggleCategory(cat: NewsCategory) {
    setActiveCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const items = [...worldState!.news]
    .reverse()
    .filter((n) => activeCategories.size === 0 || activeCategories.has(n.category))
    .slice(0, 300)

  return (
    <div className="advisor-overlay" onClick={toggleNews}>
      <div className="news-feed-panel" onClick={(e) => e.stopPropagation()}>
        <div className="advisor-header">
          <strong>World News</strong>
          <label className="camera-follow-toggle">
            <input type="checkbox" checked={cameraAutoFollow} onChange={(e) => setCameraAutoFollow(e.target.checked)} />
            Auto-camera on critical events
          </label>
          <button onClick={toggleNews} className="advisor-close">
            ✕
          </button>
        </div>

        <div className="news-category-filters">
          {ALL_CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={`news-filter-chip ${activeCategories.has(cat) ? 'active' : ''}`}
              onClick={() => toggleCategory(cat)}
            >
              {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
            </button>
          ))}
          {activeCategories.size > 0 && (
            <button className="news-filter-chip news-filter-clear" onClick={() => setActiveCategories(new Set())}>
              Clear filters
            </button>
          )}
        </div>

        <div className="news-feed-list">
          {items.length === 0 && <div className="advisor-message assistant">No events match this filter yet.</div>}
          {items.map((n) => {
            const clickable = !!(n.locationEntityId || n.locationRegionId)
            return (
              <article
                key={n.id}
                className={`news-feed-item importance-${n.importance} ${clickable ? 'clickable' : ''}`}
                onClick={() => clickable && focusOn({ entityId: n.locationEntityId, regionId: n.locationRegionId })}
              >
                <header>
                  <span className="news-icon">{CATEGORY_ICONS[n.category]}</span>
                  <span className="news-feed-headline">{n.headline}</span>
                  <span className="news-feed-turn">T{n.turn}</span>
                </header>
                <p>{n.body}</p>
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}
