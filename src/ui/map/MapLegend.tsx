export function MapLegend() {
  return (
    <div className="map-legend">
      <div className="map-legend-row">
        <span className="map-legend-swatch" style={{ background: '#5B7C5A', outline: '2px solid #e2b23c', outlineOffset: 1 }} />
        Your country
      </div>
      <div className="map-legend-row">
        <span
          className="map-legend-swatch"
          style={{ background: '#5B7C5A', outline: '2px dashed #c0392b', outlineOffset: 1 }}
        />
        At war / frontline
      </div>
      <div className="map-legend-row">
        <span className="map-legend-swatch map-legend-hatch-occupied" />
        Occupied territory
      </div>
      <div className="map-legend-row">
        <span className="map-legend-swatch map-legend-hatch-contested" />
        Contested territory
      </div>
      <div className="map-legend-row">
        <span className="map-legend-swatch map-legend-hatch-rebel" />
        Rebel-controlled
      </div>
      <div className="map-legend-row">
        <span className="map-legend-swatch" style={{ background: '#5B7C5A' }} />
        Neutral / normal control
      </div>
    </div>
  )
}
