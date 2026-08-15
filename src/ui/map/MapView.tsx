import { useEffect, useMemo, useRef, useState } from 'react'
import { geoPath, geoNaturalEarth1, type GeoPath, type GeoProjection } from 'd3-geo'
import { zoom as d3zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom'
import { select } from 'd3-selection'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import RBush, { type BBox } from 'rbush'
import geoIndex from '@/data/generated/geoIndex.json'
import type { WorldState } from '@/domain/schemas'

interface Admin0Feature extends GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> {
  id?: string | number
  properties: { name: string }
}
interface Admin1Feature extends GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> {
  properties: { id: string; name: string; countryIso3: string; countryIso2: string; regionType: string }
}

interface IndexedItem extends BBox {
  entityId: string
  regionId: string | null
  feature: GeoJSON.Feature
}

const CCN3_TO_ENTITY: Record<string, string> = geoIndex.byCcn3
const NAME_TO_ENTITY: Record<string, string> = geoIndex.byName

function resolveEntityIdForAdmin0(f: Admin0Feature): string | null {
  if (f.id !== undefined && CCN3_TO_ENTITY[String(f.id)]) return CCN3_TO_ENTITY[String(f.id)]
  if (NAME_TO_ENTITY[f.properties.name]) return NAME_TO_ENTITY[f.properties.name]
  return null
}

/** Must use the same projected path generator as rendering -- bounds computed
 *  in unprojected lon/lat space would be incomparable with the pixel-space
 *  coordinates click/hover events query the spatial index with. */
function bboxOf(f: GeoJSON.Feature, projectedPath: GeoPath): BBox {
  const b = projectedPath.bounds(f as never)
  return { minX: b[0][0], minY: b[0][1], maxX: b[1][0], maxY: b[1][1] }
}

export interface MapViewProps {
  worldState: WorldState
  selectedEntityId: string | null
  selectedRegionId: string | null
  onSelectEntity: (id: string) => void
  onSelectRegion: (id: string) => void
}

const STATUS_COLORS: Record<string, string> = {
  player: '#e2b23c',
  war: '#c0392b',
  ally: '#3f7ea6',
  neutral: '#3a4a52',
}

export function MapView({ worldState, selectedEntityId, selectedRegionId, onSelectEntity, onSelectRegion }: MapViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [admin0, setAdmin0] = useState<Admin0Feature[] | null>(null)
  const [admin1, setAdmin1] = useState<Admin1Feature[] | null>(null)
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity)
  const [size, setSize] = useState({ width: 960, height: 540 })
  const [hoverName, setHoverName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${import.meta.env.BASE_URL}geo/world-admin0.topojson`).then((r) => r.json()),
      fetch(`${import.meta.env.BASE_URL}geo/world-admin1.topojson`).then((r) => r.json()),
      fetch(`${import.meta.env.BASE_URL}geo/palestine-regions.geojson`).then((r) => r.json()),
    ]).then(([topo0, topo1, palestineGeo]) => {
      if (cancelled) return
      const admin0Topology = topo0 as unknown as Topology
      const admin1Topology = topo1 as unknown as Topology
      const admin0FC = feature(
        admin0Topology,
        admin0Topology.objects.countries as GeometryCollection,
      ) as unknown as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
      const admin1FC = feature(
        admin1Topology,
        admin1Topology.objects.admin1 as GeometryCollection,
      ) as unknown as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
      setAdmin0(admin0FC.features as Admin0Feature[])
      setAdmin1([...(admin1FC.features as Admin1Feature[]), ...palestineGeo.features])
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const projection = useMemo<GeoProjection>(() => {
    return geoNaturalEarth1().scale(size.width / 6.2).translate([size.width / 2, size.height / 2])
  }, [size.width, size.height])

  const path = useMemo<GeoPath>(() => geoPath(projection), [projection])

  const admin0Index = useMemo(() => {
    if (!admin0) return null
    const tree = new RBush<IndexedItem>()
    const items: IndexedItem[] = admin0
      .map((f) => {
        const entityId = resolveEntityIdForAdmin0(f)
        if (!entityId) return null
        const item: IndexedItem = { ...bboxOf(f, path), entityId, regionId: null, feature: f }
        return item
      })
      .filter((x): x is IndexedItem => x !== null)
    tree.load(items)
    return tree
  }, [admin0, path])

  const admin1ByCountry = useMemo(() => {
    if (!admin1) return new Map<string, Admin1Feature[]>()
    const map = new Map<string, Admin1Feature[]>()
    for (const f of admin1) {
      const list = map.get(f.properties.countryIso3) ?? []
      list.push(f)
      map.set(f.properties.countryIso3, list)
    }
    return map
  }, [admin1])

  const admin1Index = useMemo(() => {
    if (!admin1) return null
    const tree = new RBush<IndexedItem>()
    const selectedCountryIso3 =
      selectedEntityId && 'cca3' in worldState.entities[selectedEntityId] ? selectedEntityId : null
    const relevant = selectedCountryIso3 ? (admin1ByCountry.get(selectedCountryIso3) ?? []) : []
    const items: IndexedItem[] = relevant.map((f) => ({
      ...bboxOf(f, path),
      entityId: worldState.regions[f.properties.id]?.controllerId ?? f.properties.countryIso3,
      regionId: f.properties.id,
      feature: f,
    }))
    tree.load(items)
    return tree
  }, [admin1, admin1ByCountry, selectedEntityId, worldState, path])

  function colorForEntity(entityId: string): string {
    if (entityId === worldState.playerEntityId) return STATUS_COLORS.player
    const relation = worldState.entities[worldState.playerEntityId]?.relations.find((r) => r.otherEntityId === entityId)
    if (relation?.status === 'war') return STATUS_COLORS.war
    if (relation?.status === 'allied') return STATUS_COLORS.ally
    return STATUS_COLORS.neutral
  }

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !admin0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size.width * dpr
    canvas.height = size.height * dpr
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${size.height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)
    ctx.save()
    ctx.translate(transform.x, transform.y)
    ctx.scale(transform.k, transform.k)

    ctx.fillStyle = '#0c1418'
    ctx.fillRect(-transform.x / transform.k, -transform.y / transform.k, size.width / transform.k, size.height / transform.k)

    const renderPath = path.context(ctx)

    for (const f of admin0) {
      const entityId = resolveEntityIdForAdmin0(f)
      ctx.beginPath()
      renderPath(f as never)
      ctx.fillStyle = entityId ? colorForEntity(entityId) : '#1c262b'
      ctx.fill()
      ctx.lineWidth = 0.5 / transform.k
      ctx.strokeStyle = '#0c1418'
      ctx.stroke()
    }

    const selectedCountryIso3 =
      selectedEntityId && worldState.entities[selectedEntityId] && 'cca3' in worldState.entities[selectedEntityId]
        ? selectedEntityId
        : null
    if (selectedCountryIso3) {
      const regionsForCountry = admin1ByCountry.get(selectedCountryIso3) ?? []
      for (const f of regionsForCountry) {
        const region = worldState.regions[f.properties.id]
        ctx.beginPath()
        renderPath(f as never)
        ctx.fillStyle = region && region.id === selectedRegionId ? '#f0c869' : 'rgba(255,255,255,0.06)'
        ctx.fill()
        ctx.lineWidth = 0.7 / transform.k
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'
        ctx.stroke()
      }
    }

    ctx.restore()
  }, [admin0, admin1ByCountry, path, transform, size, selectedEntityId, selectedRegionId, worldState])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const zoomBehavior = d3zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([1, 12])
      .on('zoom', (event) => setTransform(event.transform))
    select(canvas).call(zoomBehavior)
    return () => {
      select(canvas).on('.zoom', null)
    }
  }, [])

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = (e.clientX - rect.left - transform.x) / transform.k
    const y = (e.clientY - rect.top - transform.y) / transform.k

    if (admin1Index) {
      const hits = admin1Index.search({ minX: x, minY: y, maxX: x, maxY: y })
      for (const hit of hits) {
        if (pointInFeature(x, y, hit.feature, projection)) {
          if (hit.regionId) onSelectRegion(hit.regionId)
          return
        }
      }
    }
    if (admin0Index) {
      const hits = admin0Index.search({ minX: x, minY: y, maxX: x, maxY: y })
      for (const hit of hits) {
        if (pointInFeature(x, y, hit.feature, projection)) {
          onSelectEntity(hit.entityId)
          return
        }
      }
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = (e.clientX - rect.left - transform.x) / transform.k
    const y = (e.clientY - rect.top - transform.y) / transform.k
    if (admin0Index) {
      const hits = admin0Index.search({ minX: x, minY: y, maxX: x, maxY: y })
      for (const hit of hits) {
        if (pointInFeature(x, y, hit.feature, projection)) {
          setHoverName(worldState.entities[hit.entityId]?.name ?? null)
          return
        }
      }
    }
    setHoverName(null)
  }

  return (
    <div ref={containerRef} className="map-view">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverName(null)}
      />
      {hoverName && <div className="map-hover-label">{hoverName}</div>}
      {!admin0 && <div className="map-loading">Loading world map...</div>}
    </div>
  )
}

function pointInFeature(x: number, y: number, f: GeoJSON.Feature, projection: GeoProjection): boolean {
  const lonlat = projection.invert?.([x, y])
  if (!lonlat) return false
  return geoContains(f, lonlat)
}

// Minimal point-in-polygon test against a GeoJSON Polygon/MultiPolygon in lon/lat space.
function geoContains(f: GeoJSON.Feature, point: [number, number]): boolean {
  const geom = f.geometry
  if (geom.type === 'Polygon') return polygonContains(geom.coordinates, point)
  if (geom.type === 'MultiPolygon') return geom.coordinates.some((poly) => polygonContains(poly, point))
  return false
}

function polygonContains(rings: number[][][], point: [number, number]): boolean {
  if (!ringContains(rings[0], point)) return false
  for (let i = 1; i < rings.length; i++) {
    if (ringContains(rings[i], point)) return false
  }
  return true
}

function ringContains(ring: number[][], [px, py]: [number, number]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}
