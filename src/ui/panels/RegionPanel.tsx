import type { Region, WorldState } from '@/domain/schemas'

const UNAVAILABLE = 'Data unavailable'

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString()
}
function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${n.toFixed(0)}`
}

export function RegionPanel({ region, worldState }: { region: Region; worldState: WorldState }) {
  const controller = worldState.entities[region.controllerId]
  const originalOwner = worldState.entities[region.countryId]
  const occupier = region.occupyingOrganizationId ? worldState.organizations[region.occupyingOrganizationId] : null
  const swatchColor = (controller ?? originalOwner)?.mapColor

  const estimatedPopulation = controller ? Math.round(controller.population.total * region.populationShare) : null
  const estimatedGdp = controller ? controller.economy.gdpUsd * region.gdpShare : null

  const activeWar = Object.values(worldState.wars).find(
    (w) => w.active && w.contestedRegionIds.includes(region.id),
  )
  const isForeignControlled = region.controllerId !== region.countryId && !occupier

  return (
    <section className="region-panel">
      <div className="region-panel-header">
        <span className="region-eyebrow">Region</span>
        {swatchColor && <span className="color-swatch" style={{ background: swatchColor }} />}
        <h2 className="region-name">{region.name}</h2>
        <div className="region-subtitle">
          {originalOwner ? `Region of ${originalOwner.name}` : UNAVAILABLE}
          {region.isCapitalRegion && <span className="region-tag capital-tag">Capital region</span>}
        </div>
      </div>

      <div className="stat-row">
        <span>Current controller</span>
        <span>{occupier ? occupier.name : (controller?.name ?? UNAVAILABLE)}</span>
      </div>
      <div className="stat-row">
        <span>Original owner</span>
        <span>{originalOwner?.name ?? UNAVAILABLE}</span>
      </div>
      <div className="stat-row">
        <span>Occupation status</span>
        <span>{occupier ? `Occupied by ${occupier.name}` : isForeignControlled ? 'Annexed by foreign power' : 'Not occupied'}</span>
      </div>
      <div className="stat-row">
        <span>Contested / disputed</span>
        <span>{region.disputed ? 'Yes' : 'No'}</span>
      </div>
      <div className="stat-row">
        <span>Frontline status</span>
        <span>{activeWar ? 'Active frontline (contested in ongoing war)' : 'No active conflict'}</span>
      </div>

      <h3>Population &amp; economy</h3>
      <div className="stat-row">
        <span>Population (est.)</span>
        <span>{estimatedPopulation !== null ? fmtNum(estimatedPopulation) : UNAVAILABLE}</span>
      </div>
      <div className="stat-row">
        <span>Share of national population</span>
        <span>{(region.populationShare * 100).toFixed(1)}%</span>
      </div>
      <div className="stat-row">
        <span>Economic output (est.)</span>
        <span>{estimatedGdp !== null ? fmtUsd(estimatedGdp) : UNAVAILABLE}</span>
      </div>
      <div className="stat-row">
        <span>Share of national GDP</span>
        <span>{(region.gdpShare * 100).toFixed(1)}%</span>
      </div>
      <div className="stat-row">
        <span>Infrastructure level</span>
        <span>{region.infrastructureLevel.toFixed(0)}/100</span>
      </div>
      <div className="stat-row">
        <span>Stability (unrest)</span>
        <span>{(100 - region.unrest).toFixed(0)}/100</span>
      </div>

      <h3>Local detail</h3>
      <div className="stat-row">
        <span>Major cities</span>
        <span>{UNAVAILABLE}</span>
      </div>
      <div className="stat-row">
        <span>Terrain</span>
        <span>{UNAVAILABLE}</span>
      </div>
      <div className="stat-row">
        <span>Local resources</span>
        <span>{UNAVAILABLE}</span>
      </div>
      <div className="stat-row">
        <span>Roads / railways</span>
        <span>{UNAVAILABLE}</span>
      </div>
      <div className="stat-row">
        <span>Airports / ports</span>
        <span>{UNAVAILABLE}</span>
      </div>
      <div className="stat-row">
        <span>Military bases</span>
        <span>{UNAVAILABLE}</span>
      </div>
      <div className="stat-row">
        <span>Military forces present</span>
        <span>{UNAVAILABLE}</span>
      </div>
      <p className="region-note">
        This simulation tracks military forces at the national level, not deployed per-region -- so the fields above are
        genuinely not modeled rather than omitted by mistake.
      </p>
    </section>
  )
}
