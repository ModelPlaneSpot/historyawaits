import { useEffect, useMemo, useRef, useState } from 'react'
import { geoPath, geoNaturalEarth1, type GeoPath, type GeoProjection } from 'd3-geo'
import { zoom as d3zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom'
import { select } from 'd3-selection'
import 'd3-transition'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import RBush, { type BBox } from 'rbush'
import geoIndex from '@/data/generated/geoIndex.json'
import type { WorldState } from '@/domain/schemas'
import { MapLegend } from './MapLegend'

interface Admin0Feature extends GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> {
  id?: string | number
  properties: { name: string }
}
interface Admin1Feature extends GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> {
  properties: { id: string; name: string; countryIso3: string; countryIso2: string; regionType: string }
}

interface RegionIndexItem extends BBox {
  regionId: string
  feature: Admin1Feature
}
interface EntityIndexItem extends BBox {
  entityId: string
  feature: Admin0Feature
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

export interface FocusTarget {
  entityId: string | null
  regionId: string | null
}

export interface MapViewProps {
  worldState: WorldState
  selectedEntityId: string | null
  selectedRegionId: string | null
  onSelectEntity: (id: string) => void
  onSelectRegion: (id: string, entityId: string) => void
  focusTarget?: FocusTarget | null
  focusNonce?: number
}

const UNKNOWN_COLOR = '#1c262b'
const PLAYER_OUTLINE = '#e2b23c'
const SELECTED_REGION_OUTLINE = '#f0c869'
const FRONTLINE_COLOR = '#c0392b'
const FRONTLINE_COLOR_DIM = 'rgba(192,57,43,0.5)'
const SELECTED_ENTITY_OUTLINE = 'rgba(255,255,255,0.55)'
const OCCUPIED_HATCH = 'rgba(10,10,10,0.4)'
const CONTESTED_DOT = 'rgba(230,180,80,0.75)'
const REBEL_HATCH = 'rgba(122,24,24,0.55)'
const HIGHLIGHT_FLASH_COLOR = '#ffe98a'
const HIGHLIGHT_FLASH_MS = 1600

/** Every country/disputed-entity has a fixed mapColor from generation time
 *  (see scripts/data/country-colors.json) -- this is never computed here. */
function baseColorFor(worldState: WorldState, entityId: string): string {
  return worldState.entities[entityId]?.mapColor ?? UNKNOWN_COLOR
}

function isAtWarWithPlayer(worldState: WorldState, entityId: string): boolean {
  if (entityId === worldState.playerEntityId) return false
  return Object.values(worldState.wars).some(
    (w) =>
      w.active &&
      ((w.attackerIds.includes(worldState.playerEntityId) && w.defenderIds.includes(entityId)) ||
        (w.defenderIds.includes(worldState.playerEntityId) && w.attackerIds.includes(entityId))),
  )
}

/** Any active war, anywhere -- used to give wars the player isn't even part
 *  of a visible (if subtler) frontline, since the world keeps fighting
 *  whether or not the player is watching. */
function isAtWarWithAnyone(worldState: WorldState, entityId: string): boolean {
  return Object.values(worldState.wars).some((w) => w.active && (w.attackerIds.includes(entityId) || w.defenderIds.includes(entityId)))
}

/** Draws a diagonal line-hatch clipped to whatever path is currently traced
 *  on the context. Must be called right after tracing the feature's path
 *  (fill/stroke don't consume the current path, so it's still active). */
function hatchCurrentPath(ctx: CanvasRenderingContext2D, bounds: [[number, number], [number, number]], color: string, spacing: number, k: number, crossHatch = false) {
  ctx.save()
  ctx.clip()
  ctx.strokeStyle = color
  ctx.lineWidth = 1 / k
  const [[minX, minY], [maxX, maxY]] = bounds
  const span = maxY - minY
  const draw = (sign: 1 | -1) => {
    ctx.beginPath()
    for (let x = minX - span; x < maxX + span; x += spacing) {
      ctx.moveTo(x, minY)
      ctx.lineTo(x + sign * span, maxY)
    }
    ctx.stroke()
  }
  draw(1)
  if (crossHatch) draw(-1)
  ctx.restore()
}

function dotCurrentPath(ctx: CanvasRenderingContext2D, bounds: [[number, number], [number, number]], color: string, spacing: number, k: number) {
  ctx.save()
  ctx.clip()
  ctx.fillStyle = color
  const [[minX, minY], [maxX, maxY]] = bounds
  for (let y = minY; y < maxY; y += spacing) {
    for (let x = minX; x < maxX; x += spacing) {
      ctx.beginPath()
      ctx.arc(x, y, 0.9 / k, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

export function MapView({
  worldState,
  selectedEntityId,
  selectedRegionId,
  onSelectEntity,
  onSelectRegion,
  focusTarget = null,
  focusNonce = 0,
}: MapViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const zoomBehaviorRef = useRef<ReturnType<typeof d3zoom<HTMLCanvasElement, unknown>> | null>(null)
  const [admin0, setAdmin0] = useState<Admin0Feature[] | null>(null)
  const [admin1, setAdmin1] = useState<Admin1Feature[] | null>(null)
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity)
  const [size, setSize] = useState({ width: 960, height: 540 })
  const [hoverName, setHoverName] = useState<string | null>(null)
  const [highlightRegionId, setHighlightRegionId] = useState<string | null>(null)

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

  // Every admin-1 region on Earth, colored purely from live worldState.regions[id].controllerId
  // at draw time -- this map holds no ownership data of its own, and the index below
  // only depends on geometry (admin1/path), never on worldState, so annexing a region
  // never requires rebuilding the spatial index, only a redraw.
  const admin1ById = useMemo(() => {
    const map = new Map<string, Admin1Feature>()
    if (admin1) for (const f of admin1) map.set(f.properties.id, f)
    return map
  }, [admin1])

  // Countries/disputed entities whose regions have no real admin-1 geometry
  // (a handful: South Sudan, Kosovo, Western Sahara) fall back to their
  // admin-0 country outline, still colored by that region's live controller.
  const admin0FallbackIds = useMemo(() => {
    const covered = new Set<string>()
    if (admin1) for (const f of admin1) covered.add(f.properties.countryIso3)
    const fallback = new Set<string>()
    for (const entity of Object.values(worldState.entities)) {
      if (!covered.has(entity.id)) fallback.add(entity.id)
    }
    return fallback
  }, [admin1, worldState.entities])

  const regionSpatialIndex = useMemo(() => {
    if (!admin1) return null
    const tree = new RBush<RegionIndexItem>()
    const items: RegionIndexItem[] = admin1.map((f) => ({
      ...bboxOf(f, path),
      regionId: f.properties.id,
      feature: f,
    }))
    tree.load(items)
    return tree
  }, [admin1, path])

  const entitySpatialIndex = useMemo(() => {
    if (!admin0) return null
    const tree = new RBush<EntityIndexItem>()
    const items: EntityIndexItem[] = admin0
      .map((f) => {
        const entityId = resolveEntityIdForAdmin0(f)
        if (!entityId) return null
        const item: EntityIndexItem = { ...bboxOf(f, path), entityId, feature: f }
        return item
      })
      .filter((x): x is EntityIndexItem => x !== null)
    tree.load(items)
    return tree
  }, [admin0, path])

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !admin0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size.width * dpr
    canvas.height = size.height * dpr
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${size.height}px`
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return
    const ctx: CanvasRenderingContext2D = ctx2d
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)
    ctx.save()
    ctx.translate(transform.x, transform.y)
    ctx.scale(transform.k, transform.k)

    ctx.fillStyle = '#0c1418'
    ctx.fillRect(-transform.x / transform.k, -transform.y / transform.k, size.width / transform.k, size.height / transform.k)

    const renderPath = path.context(ctx)
    const k = transform.k

    function paintRegion(f: GeoJSON.Feature, region: WorldState['regions'][string] | undefined, homeEntityId: string) {
      const controllerIsState = !!(region && worldState.entities[region.controllerId])
      const controllerId = controllerIsState ? region!.controllerId : homeEntityId
      ctx.beginPath()
      renderPath(f as never)
      ctx.fillStyle = baseColorFor(worldState, controllerId)
      ctx.fill()

      if (region) {
        const bounds = path.bounds(f as never)
        if (!controllerIsState) {
          hatchCurrentPath(ctx, bounds, REBEL_HATCH, 4, k, true)
        } else if (region.controllerId !== region.countryId) {
          hatchCurrentPath(ctx, bounds, OCCUPIED_HATCH, 4, k)
        } else if (region.disputed) {
          dotCurrentPath(ctx, bounds, CONTESTED_DOT, 5, k)
        }
      }

      ctx.lineWidth = 0.4 / k
      ctx.strokeStyle = 'rgba(12,20,24,0.6)'
      ctx.stroke()

      if (controllerId === worldState.playerEntityId) {
        ctx.lineWidth = 1.4 / k
        ctx.strokeStyle = PLAYER_OUTLINE
        ctx.stroke()
      } else if (isAtWarWithPlayer(worldState, controllerId)) {
        ctx.save()
        ctx.setLineDash([5 / k, 3 / k])
        ctx.lineWidth = 1.4 / k
        ctx.strokeStyle = FRONTLINE_COLOR
        ctx.stroke()
        ctx.restore()
      } else if (isAtWarWithAnyone(worldState, controllerId)) {
        // A war happening elsewhere in the world, not involving the player --
        // still worth a visible (subtler) frontline so the world reads as
        // active even when the player isn't part of the fighting.
        ctx.save()
        ctx.setLineDash([4 / k, 4 / k])
        ctx.lineWidth = 1 / k
        ctx.strokeStyle = FRONTLINE_COLOR_DIM
        ctx.stroke()
        ctx.restore()
      } else if (controllerId === selectedEntityId) {
        ctx.lineWidth = 1 / k
        ctx.strokeStyle = SELECTED_ENTITY_OUTLINE
        ctx.stroke()
      }

      if (region?.id === selectedRegionId) {
        ctx.lineWidth = 2.2 / k
        ctx.strokeStyle = SELECTED_REGION_OUTLINE
        ctx.stroke()
      }

      if (region?.id === highlightRegionId) {
        ctx.save()
        ctx.lineWidth = 3 / k
        ctx.strokeStyle = HIGHLIGHT_FLASH_COLOR
        ctx.shadowColor = HIGHLIGHT_FLASH_COLOR
        ctx.shadowBlur = 12 / k
        ctx.stroke()
        ctx.restore()
      }
    }

    // Base layer: every admin-1 region, live-colored by its current controller.
    for (const f of admin1ById.values()) {
      const region = worldState.regions[f.properties.id]
      paintRegion(f, region, f.properties.countryIso3)
    }

    // Fallback layer: entities with no admin-1 geometry render as their whole
    // admin-0 outline instead, still driven by their single region's live controller.
    for (const f of admin0) {
      const homeEntityId = resolveEntityIdForAdmin0(f)
      if (!homeEntityId || !admin0FallbackIds.has(homeEntityId)) continue
      const home = worldState.entities[homeEntityId]
      const regionId = home?.territoryRegionIds[0]
      const region = regionId ? worldState.regions[regionId] : undefined
      paintRegion(f, region, homeEntityId)
    }

    // Political (admin-0) borders drawn as a bolder overlay on top of the
    // region fills, purely for visual country grouping -- not a data source.
    ctx.lineWidth = 1 / k
    ctx.strokeStyle = 'rgba(12,20,24,0.85)'
    for (const f of admin0) {
      ctx.beginPath()
      renderPath(f as never)
      ctx.stroke()
    }

    ctx.restore()
  }, [admin0, admin1ById, admin0FallbackIds, path, transform, size, selectedRegionId, selectedEntityId, worldState, highlightRegionId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const zoomBehavior = d3zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([1, 60])
      .on('zoom', (event) => setTransform(event.transform))
    zoomBehaviorRef.current = zoomBehavior
    select(canvas).call(zoomBehavior)
    return () => {
      select(canvas).on('.zoom', null)
    }
  }, [])

  // Camera focus: pan/zoom smoothly to an entity or region and briefly
  // highlight it. Keyed on focusNonce (not the target object) so re-focusing
  // the same location twice in a row still re-triggers the animation.
  useEffect(() => {
    if (!focusTarget || (!focusTarget.entityId && !focusTarget.regionId) || !admin1 || !admin0) return
    const canvas = canvasRef.current
    const zoomBehavior = zoomBehaviorRef.current
    if (!canvas || !zoomBehavior) return

    let targetFeature: GeoJSON.Feature | null = null
    let targetRegionId: string | null = null

    if (focusTarget.regionId) {
      const f = admin1ById.get(focusTarget.regionId)
      if (f) {
        targetFeature = f
        targetRegionId = focusTarget.regionId
      }
    }
    if (!targetFeature && focusTarget.entityId) {
      const entity = worldState.entities[focusTarget.entityId]
      const firstRegionId = entity?.territoryRegionIds[0]
      const regionFeature = firstRegionId ? admin1ById.get(firstRegionId) : undefined
      if (regionFeature) {
        targetFeature = regionFeature
        targetRegionId = firstRegionId ?? null
      } else {
        targetFeature = admin0.find((f) => resolveEntityIdForAdmin0(f) === focusTarget.entityId) ?? null
      }
    }
    if (!targetFeature) return

    const bounds = path.bounds(targetFeature as never)
    const [[x0, y0], [x1, y1]] = bounds
    const w = Math.max(1, x1 - x0)
    const h = Math.max(1, y1 - y0)
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    const fitScale = 0.5 * Math.min(size.width / w, size.height / h)
    const scale = Math.min(24, Math.max(3, fitScale))
    const tx = size.width / 2 - scale * cx
    const ty = size.height / 2 - scale * cy
    const nextTransform = zoomIdentity.translate(tx, ty).scale(scale)

    select(canvas).transition().duration(750).call(zoomBehavior.transform, nextTransform)

    if (targetRegionId) {
      setHighlightRegionId(targetRegionId)
      const timeout = setTimeout(() => setHighlightRegionId(null), HIGHLIGHT_FLASH_MS)
      return () => clearTimeout(timeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce])

  function regionControllerId(regionId: string, fallbackHomeId: string): string {
    const region = worldState.regions[regionId]
    if (region && worldState.entities[region.controllerId]) return region.controllerId
    return fallbackHomeId
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = (e.clientX - rect.left - transform.x) / transform.k
    const y = (e.clientY - rect.top - transform.y) / transform.k

    if (regionSpatialIndex) {
      const hits = regionSpatialIndex.search({ minX: x, minY: y, maxX: x, maxY: y })
      for (const hit of hits) {
        if (pointInFeature(x, y, hit.feature, projection)) {
          const entityId = regionControllerId(hit.regionId, hit.feature.properties.countryIso3)
          onSelectRegion(hit.regionId, entityId)
          return
        }
      }
    }
    if (entitySpatialIndex) {
      const hits = entitySpatialIndex.search({ minX: x, minY: y, maxX: x, maxY: y })
      for (const hit of hits) {
        if (pointInFeature(x, y, hit.feature, projection)) {
          if (admin0FallbackIds.has(hit.entityId)) {
            const home = worldState.entities[hit.entityId]
            const regionId = home?.territoryRegionIds[0]
            if (regionId) {
              const entityId = regionControllerId(regionId, hit.entityId)
              onSelectRegion(regionId, entityId)
              return
            }
          }
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
    if (regionSpatialIndex) {
      const hits = regionSpatialIndex.search({ minX: x, minY: y, maxX: x, maxY: y })
      for (const hit of hits) {
        if (pointInFeature(x, y, hit.feature, projection)) {
          const entityId = regionControllerId(hit.regionId, hit.feature.properties.countryIso3)
          const name = worldState.entities[entityId]?.name
          setHoverName(name ? `${hit.feature.properties.name} (${name})` : hit.feature.properties.name)
          return
        }
      }
    }
    if (entitySpatialIndex) {
      const hits = entitySpatialIndex.search({ minX: x, minY: y, maxX: x, maxY: y })
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
      <MapLegend />
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
