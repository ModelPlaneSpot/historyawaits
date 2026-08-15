import type { WorldEntity } from '@/domain/schemas'

function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${n.toFixed(0)}`
}
function fmtNum(n: number): string {
  return n.toLocaleString()
}

export function EntityPanel({ entity }: { entity: WorldEntity }) {
  return (
    <>
      <section>
        <div className="entity-title">
          <span className="color-swatch" style={{ background: entity.mapColor }} />
          <span className={`fi fi-${entity.flagCode}`} />
          <span>{entity.name}</span>
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>{entity.officialName}</div>
        <div className="stat-row">
          <span>Capital</span>
          <span>{entity.capital}</span>
        </div>
        <div className="stat-row">
          <span>Government</span>
          <span>{entity.government.type.replace('_', ' ')}</span>
        </div>
        <div className="stat-row">
          <span>Stability</span>
          <span>{entity.government.stability.toFixed(0)}%</span>
        </div>
        {entity.kind === 'disputed_entity' && (
          <div className="stat-row">
            <span>Status</span>
            <span>{entity.status.replace(/_/g, ' ')}</span>
          </div>
        )}
      </section>
      <section>
        <h3>Population</h3>
        <div className="stat-row">
          <span>Total</span>
          <span>{fmtNum(entity.population.total)}</span>
        </div>
        <div className="stat-row">
          <span>Urbanization</span>
          <span>{entity.population.urbanizationPct.toFixed(0)}%</span>
        </div>
        <div className="stat-row">
          <span>Unrest</span>
          <span>{entity.population.unrest.toFixed(0)}%</span>
        </div>
      </section>
      <section>
        <h3>Economy</h3>
        <div className="stat-row">
          <span>GDP</span>
          <span>{fmtUsd(entity.economy.gdpUsd)}</span>
        </div>
        <div className="stat-row">
          <span>GDP / capita</span>
          <span>{fmtUsd(entity.economy.gdpPerCapitaUsd)}</span>
        </div>
        <div className="stat-row">
          <span>Growth</span>
          <span>{entity.economy.growthRatePct.toFixed(1)}%</span>
        </div>
        <div className="stat-row">
          <span>Treasury</span>
          <span>{fmtUsd(entity.economy.treasuryUsd)}</span>
        </div>
        <div className="stat-row">
          <span>Debt / GDP</span>
          <span>{entity.economy.debtToGdpPct.toFixed(0)}%</span>
        </div>
      </section>
      <section>
        <h3>Military</h3>
        <div className="stat-row">
          <span>Active personnel</span>
          <span>{fmtNum(entity.military.personnelActive)}</span>
        </div>
        <div className="stat-row">
          <span>Reserve</span>
          <span>{fmtNum(entity.military.personnelReserve)}</span>
        </div>
        <div className="stat-row">
          <span>Tanks</span>
          <span>{fmtNum(entity.military.equipment.tanks)}</span>
        </div>
        <div className="stat-row">
          <span>Aircraft</span>
          <span>{fmtNum(entity.military.equipment.aircraft)}</span>
        </div>
        <div className="stat-row">
          <span>Ships</span>
          <span>{fmtNum(entity.military.equipment.ships)}</span>
        </div>
        <div className="stat-row">
          <span>Artillery</span>
          <span>{fmtNum(entity.military.equipment.artillery)}</span>
        </div>
        <div className="stat-row">
          <span>Spending</span>
          <span>{entity.economy.militarySpendingPctOfGdp.toFixed(1)}% GDP</span>
        </div>
      </section>
      <section>
        <h3>Government</h3>
        <div className="stat-row">
          <span>Head of state</span>
          <span>{entity.government.headOfState}</span>
        </div>
        {entity.parties.map((p) => (
          <div className="stat-row" key={p.id}>
            <span>{p.name}{p.ruling ? ' (ruling)' : ''}</span>
            <span>{p.approval.toFixed(0)}%</span>
          </div>
        ))}
      </section>
    </>
  )
}
