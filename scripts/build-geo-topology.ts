import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { feature } from 'topojson-client'

const SRC_DIR = path.resolve(import.meta.dirname, 'geo-src')
const OUT_DIR = path.resolve(import.meta.dirname, '..', 'public', 'geo')

const NATURAL_EARTH_BASE =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/10m_cultural'

async function ensureAdmin1Source() {
  fs.mkdirSync(SRC_DIR, { recursive: true })
  for (const ext of ['shp', 'dbf', 'shx']) {
    const dest = path.join(SRC_DIR, `admin1_10m.${ext}`)
    if (fs.existsSync(dest)) continue
    console.log(`Downloading admin1_10m.${ext} from Natural Earth...`)
    const res = await fetch(`${NATURAL_EARTH_BASE}/ne_10m_admin_1_states_provinces.${ext}`)
    if (!res.ok) throw new Error(`Failed to download ${ext}: ${res.status}`)
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  }
}

async function buildAdmin1Topology() {
  await ensureAdmin1Source()
  const src = path.join(SRC_DIR, 'admin1_10m.shp')
  const out = path.join(OUT_DIR, 'world-admin1.topojson')
  // mapshaper does topology-aware simplification (shared borders stay shared)
  // and handles DBF field trimming correctly, unlike raw topojson-server output.
  // Invoke the bin script directly via node (no shell) so the `-each` expression's
  // `|` and `;` characters aren't reinterpreted by the OS shell.
  const mapshaperBin = path.resolve(
    import.meta.dirname,
    '..',
    'node_modules',
    'mapshaper',
    'bin',
    'mapshaper',
  )
  execFileSync(
    process.execPath,
    [
      mapshaperBin,
      src,
      '-filter-fields',
      'adm1_code,name,name_en,adm0_a3,iso_a2,type_en,type',
      '-rename-fields',
      'id=adm1_code,countryIso3=adm0_a3,countryIso2=iso_a2',
      '-each',
      'name = name || name_en; regionType = type_en || type',
      '-filter-fields',
      'id,name,countryIso3,countryIso2,regionType',
      '-simplify',
      'visvalingam',
      '4%',
      'keep-shapes',
      '-rename-layers',
      'admin1',
      '-o',
      out,
      'format=topojson',
      'quantization=1e4',
    ],
    { stdio: 'inherit' },
  )
  const sizeKb = (fs.statSync(out).size / 1024).toFixed(0)
  console.log(`Wrote ${out} (${sizeKb} KB)`)
}

/**
 * Natural Earth ships Palestine as a single admin-0 MultiPolygon (Gaza Strip +
 * West Bank) with no admin-1 subdivision. Split it into two named regions so
 * "annex Gaza" has real geometry to point at -- the smaller, coastal, more
 * southern part is Gaza; the larger, more northern/inland part is the West Bank.
 */
function buildPalestineRegions(admin0: { objects: { countries: { geometries: any[] } } }) {
  const geoms = admin0.objects.countries.geometries
  const pse = geoms.find((g) => g.properties?.name === 'Palestine')
  if (!pse) {
    console.warn('Palestine admin-0 feature not found; skipping Gaza/West Bank split')
    return
  }
  const geo = feature(admin0 as any, { type: 'GeometryCollection', geometries: [pse] } as any) as any
  const f = 'features' in geo ? geo.features[0] : geo
  if (f.geometry.type !== 'MultiPolygon') {
    console.warn(`Expected Palestine to be a MultiPolygon, got ${f.geometry.type}; skipping split`)
    return
  }
  const parts: { poly: number[][][]; centroidLat: number; centroidLon: number }[] =
    f.geometry.coordinates.map((poly: number[][][]) => {
      const ring = poly[0]
      const lats = ring.map((p) => p[1])
      const lons = ring.map((p) => p[0])
      return {
        poly,
        centroidLat: lats.reduce((a, b) => a + b, 0) / lats.length,
        centroidLon: lons.reduce((a, b) => a + b, 0) / lons.length,
      }
    })
  parts.sort((a, b) => a.centroidLat - b.centroidLat)
  const [gazaPart, westBankPart] = parts

  const regions = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: gazaPart.poly },
        properties: { id: 'PSE-GAZA', name: 'Gaza Strip', countryIso3: 'PSE', countryIso2: 'PS', regionType: 'Territory' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: westBankPart.poly },
        properties: { id: 'PSE-WBK', name: 'West Bank', countryIso3: 'PSE', countryIso2: 'PS', regionType: 'Territory' },
      },
    ],
  }
  const outPath = path.join(OUT_DIR, 'palestine-regions.geojson')
  fs.writeFileSync(outPath, JSON.stringify(regions))
  console.log(`Wrote ${outPath} (Gaza Strip + West Bank, split from Palestine admin-0)`)
}

function buildAdmin0Topology() {
  const srcPath = path.resolve(
    import.meta.dirname,
    '..',
    'node_modules',
    'world-atlas',
    'countries-50m.json',
  )
  const raw = JSON.parse(fs.readFileSync(srcPath, 'utf-8'))
  buildPalestineRegions(raw)
  // Drop the coastline 'land' object -- we only render country polygons.
  delete raw.objects.land
  const outPath = path.join(OUT_DIR, 'world-admin0.topojson')
  fs.writeFileSync(outPath, JSON.stringify(raw))
  const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(0)
  console.log(`Wrote ${outPath} (${sizeKb} KB)`)
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  buildAdmin0Topology()
  await buildAdmin1Topology()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
