import type { NewsEvent } from '@/domain/schemas'

export function NewsPanel({ news }: { news: NewsEvent[] }) {
  const recent = [...news].slice(-30).reverse()
  return (
    <section>
      <h3>News</h3>
      {recent.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>Nothing yet.</div>}
      {recent.map((n) => (
        <div key={n.id} className={`news-item ${n.severity}`}>
          <span className="turn">T{n.turn}</span>
          {n.headline}
        </div>
      ))}
    </section>
  )
}
