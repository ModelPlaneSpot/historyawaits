import type { Region, WorldState } from '@/domain/schemas'

export function RegionPanel({ region, worldState }: { region: Region; worldState: WorldState }) {
  const controller = worldState.entities[region.controllerId]
  const occupier = region.occupyingOrganizationId ? worldState.organizations[region.occupyingOrganizationId] : null
  return (
    <section>
      <h3>Region</h3>
      <div className="entity-title">
        <span>{region.name}</span>
      </div>
      <div className="stat-row">
        <span>Controlled by</span>
        <span>{occupier ? occupier.name : (controller?.name ?? region.controllerId)}</span>
      </div>
      <div className="stat-row">
        <span>Population share</span>
        <span>{(region.populationShare * 100).toFixed(1)}%</span>
      </div>
      <div className="stat-row">
        <span>GDP share</span>
        <span>{(region.gdpShare * 100).toFixed(1)}%</span>
      </div>
      <div className="stat-row">
        <span>Infrastructure</span>
        <span>{region.infrastructureLevel.toFixed(0)}%</span>
      </div>
      <div className="stat-row">
        <span>Unrest</span>
        <span>{region.unrest.toFixed(0)}%</span>
      </div>
      {region.disputed && (
        <div className="stat-row">
          <span>Disputed</span>
          <span>yes</span>
        </div>
      )}
      {region.isCapitalRegion && (
        <div className="stat-row">
          <span>Capital region</span>
          <span>yes</span>
        </div>
      )}
    </section>
  )
}
