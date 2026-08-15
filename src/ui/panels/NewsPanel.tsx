import type { NewsEvent, WorldState } from '@/domain/schemas'

export function NewsPanel({ news, worldState }: { news: NewsEvent[]; worldState: WorldState }) {
  const recent = [...news].slice(-30).reverse()
  return (
    <section>
      <h3>News</h3>
      {recent.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>Nothing yet.</div>}
      {recent.map((n) => {
        const color = worldState.entities[n.entityIds[0]]?.mapColor
        return (
          <div key={n.id} className={`news-item ${n.severity}`}>
            {color && <span className="color-swatch" style={{ background: color, marginRight: '0.4rem' }} />}
            <span className="turn">T{n.turn}</span>
            {n.headline}
          </div>
        )
      })}
    </section>
  )
}
