/** Computes each admin-1 region's land area (km²) from the same simplified
 *  geometry the map draws, for the "largest country" victory category. Run
 *  after gen:geo; writes src/data/generated/regionAreas.json. */
import fs from 'node:fs'
import path from 'node:path'
import { geoArea } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Feature, Geometry } from 'geojson'

const EARTH_RADIUS_KM = 6371.0088
const root = path.resolve(import.meta.dirname, '..')

type RegionFeature = Feature<Geometry, { id: string }>

function main() {
  const topo = JSON.parse(fs.readFileSync(path.join(root, 'public/geo/world-admin1.topojson'), 'utf8')) as Topology
  const admin1 = feature(topo, topo.objects.admin1 as GeometryCollection).features as RegionFeature[]
  const palestine = JSON.parse(fs.readFileSync(path.join(root, 'public/geo/palestine-regions.geojson'), 'utf8')).features as RegionFeature[]
  const regions = JSON.parse(fs.readFileSync(path.join(root, 'src/data/generated/regions.json'), 'utf8')) as Record<string, unknown>

  const areas: Record<string, number> = {}
  for (const f of [...admin1, ...palestine]) {
    const id = f.properties?.id
    if (!id || !regions[id]) continue
    let steradians = geoArea(f)
    // A ring wound the wrong way makes d3 return the area of the rest of the
    // globe -- no admin-1 region is anywhere near a hemisphere.
    if (steradians > 2 * Math.PI) steradians = 4 * Math.PI - steradians
    areas[id] = Math.round((areas[id] ?? 0) + steradians * EARTH_RADIUS_KM ** 2)
  }

  const missing = Object.keys(regions).filter((id) => areas[id] === undefined)
  const out = path.join(root, 'src/data/generated/regionAreas.json')
  fs.writeFileSync(out, JSON.stringify(areas))
  console.log(`Wrote ${Object.keys(areas).length} region areas to ${out} (${missing.length} regions without geometry)`)
}

main()
