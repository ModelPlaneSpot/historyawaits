import fs from 'node:fs'
import path from 'node:path'
import worldCountries from 'world-countries'
import seedOverrides from './data/seed-overrides.json'
import organizationSeeds from './data/organizations.json'
import countryColors from './data/country-colors.json'
import {
  WorldEntity,
  Region,
  Organization,
  Treaty,
  GovernmentType,
  type Country as CountryT,
  type DisputedEntity as DisputedEntityT,
} from '../src/domain/schemas'

const OUT_DIR = path.resolve(import.meta.dirname, '..', 'src', 'data', 'generated')
const GEO_DIR = path.resolve(import.meta.dirname, '..', 'public', 'geo')

// ---------------------------------------------------------------------------
// Deterministic PRNG so regenerating the dataset doesn't cause spurious diffs.
// ---------------------------------------------------------------------------
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return h >>> 0
}
function mulberry32(seed: number) {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function rngFor(code: string, salt: string) {
  return mulberry32(hashSeed(`${code}:${salt}`))
}
function jitter(rng: () => number, min: number, max: number) {
  return min + rng() * (max - min)
}
function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)]
}

// ---------------------------------------------------------------------------
// Map colors: the hand-curated database (scripts/data/country-colors.json) is
// the single source of truth for every country/disputed-entity color, fixed
// for that entity's lifetime. This fallback only exists for an entity that
// (by some future data change) isn't in that table -- it must still never be
// left uncolored, and must be visibly distinguishable from every known color.
const COLOR_TABLE = countryColors as Record<string, string>
const usedColors = new Set(Object.values(COLOR_TABLE).map((c) => c.toLowerCase()))

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase()
}

function generateFallbackColor(rng: () => number): string {
  // Muted, earthy tones matching the hand-curated table's style.
  for (let attempt = 0; attempt < 50; attempt++) {
    const hue = Math.floor(jitter(rng, 0, 360))
    const sat = jitter(rng, 0.2, 0.4)
    const light = jitter(rng, 0.32, 0.48)
    const hex = hslToHex(hue, sat, light)
    if (!usedColors.has(hex.toLowerCase())) {
      usedColors.add(hex.toLowerCase())
      return hex
    }
  }
  throw new Error('Could not generate a distinguishable fallback map color')
}

function mapColorFor(name: string, id: string): string {
  const known = COLOR_TABLE[name]
  if (known) return known
  console.warn(`No hand-curated map color for "${name}" (${id}); generating a fallback.`)
  return generateFallbackColor(rngFor(id, 'mapColor'))
}

type SeedOverride = {
  population: number
  gdpUsdBillions: number
  militaryPersonnelActive: number
  militarySpendingPctOfGdp: number
  governmentType: GovernmentType
}
const SEEDS = seedOverrides as Record<string, SeedOverride>

// ---------------------------------------------------------------------------
// Regional bands used to procedurally estimate the ~140 countries with no
// hand-authored seed. Deliberately coarse -- these are gameplay numbers, not
// a factbook, which is why every generated record is tagged dataConfidence.
// ---------------------------------------------------------------------------
const REGION_BANDS: Record<
  string,
  { density: [number, number]; gdpPerCapita: [number, number]; popGrowth: [number, number] }
> = {
  Europe: { density: [30, 180], gdpPerCapita: [12000, 55000], popGrowth: [-0.3, 0.6] },
  Americas: { density: [10, 120], gdpPerCapita: [4000, 20000], popGrowth: [0.5, 2.2] },
  Africa: { density: [15, 120], gdpPerCapita: [800, 6000], popGrowth: [1.5, 3.4] },
  Asia: { density: [20, 300], gdpPerCapita: [1500, 20000], popGrowth: [0.3, 2.4] },
  Oceania: { density: [5, 80], gdpPerCapita: [2000, 25000], popGrowth: [0.8, 2.4] },
  Antarctic: { density: [0.01, 0.1], gdpPerCapita: [10000, 10000], popGrowth: [0, 0] },
}

const GOV_MIL_RATIO: Record<GovernmentType, [number, number]> = {
  democracy: [0.002, 0.005],
  authoritarian: [0.004, 0.009],
  monarchy: [0.003, 0.008],
  theocracy: [0.004, 0.008],
  military_junta: [0.006, 0.012],
  communist_state: [0.005, 0.01],
  failed_state: [0.001, 0.004],
}

const GOV_TYPE_POOL: GovernmentType[] = [
  'democracy',
  'democracy',
  'democracy',
  'authoritarian',
  'authoritarian',
  'monarchy',
  'military_junta',
]

const FIRST_NAMES = ['Amara', 'Bek', 'Chen', 'Dinesh', 'Elif', 'Farid', 'Grace', 'Hassan', 'Ines', 'Jorge', 'Katarina', 'Luis', 'Mei', 'Ngozi', 'Oleh', 'Priya', 'Quentin', 'Rosa', 'Sami', 'Tariq']
const LAST_NAMES = ['Adeyemi', 'Bergman', 'Castillo', 'Demir', 'Eriksson', 'Faruqi', 'Garcia', 'Haddad', 'Ibarra', 'Jovanovic', 'Kowalski', 'Lindqvist', 'Mbeki', 'Nakamura', 'Okafor', 'Petrov', 'Quintana', 'Rahman', 'Suleiman', 'Tan']

function generateName(rng: () => number) {
  return `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`
}

function generateParties(rng: () => number, govType: GovernmentType) {
  const count = govType === 'failed_state' ? 2 : Math.floor(jitter(rng, 2, 5))
  const names = ['National Unity', 'Progressive Front', 'People\'s Alliance', 'Reform Bloc', 'Homeland Party', 'Democratic Union', 'Liberty Coalition']
  const parties = Array.from({ length: count }, (_, i) => {
    const approval = jitter(rng, 10, 60)
    const round1 = (n: number) => Math.round(n * 10) / 10
    return {
      id: `party-${i}`,
      name: names[i % names.length],
      ideology: {
        economicLeft: round1(jitter(rng, 0, 100)),
        socialLiberal: round1(jitter(rng, 0, 100)),
        nationalism: round1(jitter(rng, 0, 100)),
      },
      approval: round1(approval),
      seatShare: undefined as number | undefined,
      ruling: false,
    }
  })
  parties.sort((a, b) => b.approval - a.approval)
  parties[0].ruling = true
  const shares = parties.map(() => jitter(rng, 5, 40))
  const total = shares.reduce((a, b) => a + b, 0)
  parties.forEach((p, i) => {
    p.seatShare = Math.round((shares[i] / total) * 1000) / 10
  })
  return parties
}

// ---------------------------------------------------------------------------
// Identity backbone: sovereign countries + curated disputed entities.
// ---------------------------------------------------------------------------
type Identity = {
  id: string
  name: string
  officialName: string
  capital: string
  cca2: string
  latlng: [number, number]
  region: string
  subregion: string
  unMember: boolean
  kind: 'country' | 'disputed_entity'
  claimantIds?: string[]
  controllerId?: string | null
  recognitionCount?: number
  status?: DisputedEntityT['status']
}

const sovereign: Identity[] = worldCountries
  .filter((c) => c.independent)
  .map((c) => ({
    id: c.cca3,
    name: c.name.common,
    officialName: c.name.official,
    capital: c.capital?.[0] ?? c.name.common,
    cca2: c.cca2,
    latlng: [c.latlng[0], c.latlng[1]],
    region: c.region,
    subregion: c.subregion || c.region,
    unMember: c.unMember,
    kind: 'country' as const,
  }))

function fromWorldCountries(code: string): Omit<Identity, 'kind' | 'claimantIds' | 'controllerId' | 'recognitionCount' | 'status'> {
  const c = worldCountries.find((x) => x.cca3 === code)
  if (!c) throw new Error(`Expected ${code} in world-countries`)
  return {
    id: c.cca3,
    name: c.name.common,
    officialName: c.name.official,
    capital: c.capital?.[0] ?? c.name.common,
    cca2: c.cca2,
    latlng: [c.latlng[0], c.latlng[1]],
    region: c.region,
    subregion: c.subregion || c.region,
    unMember: c.unMember,
  }
}

const disputed: Identity[] = [
  {
    ...fromWorldCountries('TWN'),
    kind: 'disputed_entity',
    claimantIds: ['CHN'],
    controllerId: 'TWN',
    recognitionCount: 12,
    status: 'self_governing',
  },
  {
    ...fromWorldCountries('PSE'),
    kind: 'disputed_entity',
    claimantIds: ['ISR'],
    controllerId: 'PSE',
    recognitionCount: 140,
    status: 'contested',
  },
  {
    ...fromWorldCountries('ESH'),
    kind: 'disputed_entity',
    claimantIds: ['MAR'],
    controllerId: 'MAR',
    recognitionCount: 40,
    status: 'occupied',
  },
  {
    id: 'XKX',
    name: 'Kosovo',
    officialName: 'Republic of Kosovo',
    capital: 'Pristina',
    cca2: 'XK',
    latlng: [42.6667, 21.1667],
    region: 'Europe',
    subregion: 'Southeast Europe',
    unMember: false,
    kind: 'disputed_entity',
    claimantIds: ['SRB'],
    controllerId: 'XKX',
    recognitionCount: 100,
    status: 'de_facto_independent',
  },
  {
    id: 'CYN',
    name: 'Northern Cyprus',
    officialName: 'Turkish Republic of Northern Cyprus',
    capital: 'North Nicosia',
    cca2: 'XN',
    latlng: [35.25, 33.55],
    region: 'Europe',
    subregion: 'Southern Europe',
    unMember: false,
    kind: 'disputed_entity',
    claimantIds: ['CYP'],
    controllerId: 'CYN',
    recognitionCount: 1,
    status: 'de_facto_independent',
  },
  {
    id: 'SOL',
    name: 'Somaliland',
    officialName: 'Republic of Somaliland',
    capital: 'Hargeisa',
    cca2: 'XS',
    latlng: [9.55, 44.05],
    region: 'Africa',
    subregion: 'Eastern Africa',
    unMember: false,
    kind: 'disputed_entity',
    claimantIds: ['SOM'],
    controllerId: 'SOL',
    recognitionCount: 0,
    status: 'self_governing',
  },
]

const allIdentities = [...sovereign, ...disputed]

// Countries with no ISO area figure fall back to a small nominal value.
const AREA_BY_CCA3: Record<string, number> = Object.fromEntries(
  worldCountries.map((c) => [c.cca3, c.area || 1000]),
)
AREA_BY_CCA3.XKX = 10887
AREA_BY_CCA3.CYN = 3355
AREA_BY_CCA3.SOL = 176120

function buildEconomyAndMilitary(identity: Identity) {
  const rng = rngFor(identity.id, 'stats')
  const seed = SEEDS[identity.id]
  const band = REGION_BANDS[identity.region] ?? REGION_BANDS.Asia

  let population: number
  let gdpUsd: number
  let militaryPersonnelActive: number
  let militarySpendingPctOfGdp: number
  let governmentType: GovernmentType
  let dataConfidence: 'authored' | 'estimated'

  if (seed) {
    population = seed.population
    gdpUsd = seed.gdpUsdBillions * 1e9
    militaryPersonnelActive = seed.militaryPersonnelActive
    militarySpendingPctOfGdp = seed.militarySpendingPctOfGdp
    governmentType = seed.governmentType
    dataConfidence = 'authored'
  } else {
    const area = AREA_BY_CCA3[identity.id] ?? 1000
    const density = jitter(rng, band.density[0], band.density[1])
    population = Math.max(50000, Math.round(area * density))
    const gdpPerCapita = jitter(rng, band.gdpPerCapita[0], band.gdpPerCapita[1])
    gdpUsd = population * gdpPerCapita
    governmentType = pick(rng, GOV_TYPE_POOL)
    const [minRatio, maxRatio] = GOV_MIL_RATIO[governmentType]
    militaryPersonnelActive = Math.round(population * jitter(rng, minRatio, maxRatio))
    militarySpendingPctOfGdp = jitter(rng, 1, 3.5)
    dataConfidence = 'estimated'
  }

  const gdpPerCapitaUsd = gdpUsd / population
  const techLevel = Math.min(100, Math.max(5, (gdpPerCapitaUsd / 60000) * 100))

  return {
    population,
    gdpUsd,
    gdpPerCapitaUsd,
    militaryPersonnelActive,
    militarySpendingPctOfGdp,
    governmentType,
    dataConfidence,
    techLevel,
    rng,
    band,
  }
}

function buildEntity(identity: Identity): WorldEntity {
  const stats = buildEconomyAndMilitary(identity)
  const rng = stats.rng
  const parties = generateParties(rng, stats.governmentType)
  const ruling = parties.find((p) => p.ruling)!

  const stability =
    stats.governmentType === 'failed_state'
      ? jitter(rng, 5, 25)
      : stats.governmentType === 'democracy' || stats.governmentType === 'monarchy'
        ? jitter(rng, 55, 90)
        : jitter(rng, 30, 70)
  const coupRisk =
    stats.governmentType === 'military_junta'
      ? jitter(rng, 20, 45)
      : stats.governmentType === 'failed_state'
        ? jitter(rng, 15, 40)
        : jitter(rng, 0, 12)

  const base = {
    id: identity.id,
    name: identity.name,
    officialName: identity.officialName,
    capital: identity.capital,
    flagCode: identity.cca2.toLowerCase(),
    mapColor: mapColorFor(identity.name, identity.id),
    latlng: identity.latlng,
    government: {
      type: stats.governmentType,
      headOfState: generateName(rng),
      rulingPartyId: ruling.id,
      stability: Math.round(stability),
      coupRisk: Math.round(coupRisk),
      electionDueTurn: stats.governmentType === 'democracy' ? Math.floor(jitter(rng, 8, 32)) : null,
    },
    parties,
    economy: {
      gdpUsd: Math.round(stats.gdpUsd),
      gdpPerCapitaUsd: Math.round(stats.gdpPerCapitaUsd),
      growthRatePct: Math.round(jitter(rng, -1, 5) * 10) / 10,
      treasuryUsd: Math.round(stats.gdpUsd * jitter(rng, 0.01, 0.05)),
      debtToGdpPct: Math.round(jitter(rng, 20, 110)),
      militarySpendingPctOfGdp: Math.round(stats.militarySpendingPctOfGdp * 10) / 10,
      taxRatePct: Math.round(jitter(rng, 15, 40) * 10) / 10,
      unemploymentRatePct: Math.round(jitter(rng, 3, 16) * 10) / 10,
      inflationPct: Math.round(jitter(rng, 1, 9) * 10) / 10,
      tradeBalanceUsd: Math.round(stats.gdpUsd * jitter(rng, -0.05, 0.05)),
      resources: buildResources(rng),
    },
    military: {
      personnelActive: stats.militaryPersonnelActive,
      personnelReserve: Math.round(stats.militaryPersonnelActive * jitter(rng, 0.5, 2)),
      equipment: {
        tanks: Math.round((stats.militaryPersonnelActive / 350) * jitter(rng, 0.5, 1.5)),
        aircraft: Math.round((stats.militaryPersonnelActive / 900) * jitter(rng, 0.5, 1.5)),
        ships: Math.round((stats.militaryPersonnelActive / 2500) * jitter(rng, 0.5, 1.5)),
        artillery: Math.round((stats.militaryPersonnelActive / 250) * jitter(rng, 0.5, 1.5)),
      },
      techLevel: Math.round(stats.techLevel),
      morale: Math.round(jitter(rng, 45, 85)),
      mobilizationLevel: 10,
    },
    population: {
      total: stats.population,
      growthRatePct: Math.round(jitter(rng, stats.band.popGrowth[0], stats.band.popGrowth[1]) * 10) / 10,
      urbanizationPct: Math.round(jitter(rng, 25, 92)),
      unrest: Math.round(
        stats.governmentType === 'failed_state' ? jitter(rng, 40, 75) : jitter(rng, 5, 30),
      ),
    },
    relations: [],
    allianceIds: [],
    territoryRegionIds: [] as string[],
    isPlayerControlled: false,
    dataConfidence: stats.dataConfidence,
  }

  if (identity.kind === 'country') {
    return {
      ...base,
      kind: 'country',
      cca2: identity.cca2,
      cca3: identity.id,
      region: identity.region,
      subregion: identity.subregion,
      unMember: identity.unMember,
    } satisfies CountryT
  }
  return {
    ...base,
    kind: 'disputed_entity',
    claimantIds: identity.claimantIds ?? [],
    controllerId: identity.controllerId ?? null,
    recognitionCount: identity.recognitionCount ?? 0,
    status: identity.status ?? 'contested',
  } satisfies DisputedEntityT
}

const RESOURCE_TYPES = ['oil', 'naturalGas', 'coal', 'freshWater', 'arableLand', 'rareMinerals', 'timber'] as const
function buildResources(rng: () => number) {
  const out: Record<string, number> = {}
  for (const r of RESOURCE_TYPES) out[r] = Math.round(jitter(rng, 0, 100))
  return out
}

// ---------------------------------------------------------------------------
// Regions: derived from the admin-1 topology, with a synthetic whole-country
// fallback for the handful of entities Natural Earth doesn't subdivide.
// ---------------------------------------------------------------------------
function loadAdmin1Index(): Map<string, { id: string; name: string }[]> {
  const raw = JSON.parse(fs.readFileSync(path.join(GEO_DIR, 'world-admin1.topojson'), 'utf-8'))
  const geoms = raw.objects.admin1.geometries as { properties: { id: string; name: string; countryIso3: string } }[]
  const index = new Map<string, { id: string; name: string }[]>()
  for (const g of geoms) {
    const list = index.get(g.properties.countryIso3) ?? []
    list.push({ id: g.properties.id, name: g.properties.name })
    index.set(g.properties.countryIso3, list)
  }
  return index
}

function loadPalestineRegions(): { id: string; name: string }[] {
  const raw = JSON.parse(fs.readFileSync(path.join(GEO_DIR, 'palestine-regions.geojson'), 'utf-8'))
  return raw.features.map((f: any) => ({ id: f.properties.id, name: f.properties.name }))
}

function buildRegionsForEntity(
  identity: Identity,
  entity: WorldEntity,
  admin1Index: Map<string, { id: string; name: string }[]>,
): Region[] {
  const rng = rngFor(identity.id, 'regions')
  let featureList = admin1Index.get(identity.id) ?? []
  if (identity.id === 'PSE') featureList = loadPalestineRegions()
  if (featureList.length === 0) {
    featureList = [{ id: `${identity.id}-WHOLE`, name: identity.name }]
  }

  const weights = featureList.map(() => jitter(rng, 0.5, 1.5))
  const totalWeight = weights.reduce((a, b) => a + b, 0)

  const baseInfra = Math.min(95, Math.max(10, (entity.economy.gdpPerCapitaUsd / 55000) * 100))
  const baseUnrest = entity.population.unrest

  const capitalLower = identity.capital.toLowerCase()
  let capitalIdx = featureList.findIndex((f) => f.name.toLowerCase().includes(capitalLower))
  if (capitalIdx === -1) capitalIdx = identity.id === 'PSE' ? featureList.findIndex((f) => f.id === 'PSE-WBK') : 0
  if (capitalIdx === -1) capitalIdx = 0

  return featureList.map((f, i) => {
    const isGaza = f.id === 'PSE-GAZA'
    const isWestBank = f.id === 'PSE-WBK'
    return {
      id: f.id,
      name: f.name,
      countryId: identity.id,
      controllerId: isGaza ? 'ORG-HAMAS' : identity.id,
      populationShare: Math.round((weights[i] / totalWeight) * 10000) / 10000,
      gdpShare: Math.round((weights[i] / totalWeight) * 10000) / 10000,
      unrest: Math.round(Math.min(100, Math.max(0, baseUnrest + jitter(rng, -10, 10) + (isGaza || isWestBank ? 25 : 0)))),
      infrastructureLevel: Math.round(Math.min(100, Math.max(0, baseInfra + jitter(rng, -15, 15)))),
      isCapitalRegion: i === capitalIdx,
      disputed: isGaza || isWestBank,
      contestedByIds: isGaza || isWestBank ? ['ISR'] : [],
      occupyingOrganizationId: isGaza ? 'ORG-HAMAS' : null,
    }
  })
}

// ---------------------------------------------------------------------------
// A handful of hand-seeded real-world alliances, represented as active
// defense-pact treaties so the world doesn't start with zero diplomacy.
// ---------------------------------------------------------------------------
const ALLIANCE_SEEDS: { id: string; type: Treaty['type']; memberIds: string[] }[] = [
  {
    id: 'TREATY-NATO',
    type: 'defense_pact',
    memberIds: ['USA', 'CAN', 'GBR', 'FRA', 'DEU', 'ITA', 'ESP', 'POL', 'NOR', 'NLD', 'TUR'],
  },
]

// A handful of real-world rivalries seeded as hostile relations so the world
// isn't diplomatically inert on turn 0 -- gives the AI-nation heuristics
// (see aiDecisions.ts) something to react to even before the player acts.
const RIVALRY_SEEDS: [string, string][] = [
  ['PRK', 'KOR'],
  ['IND', 'PAK'],
  ['ISR', 'IRN'],
  ['RUS', 'UKR'],
  ['ARE', 'IRN'],
  ['SAU', 'IRN'],
  ['MAR', 'ESH'],
  ['CHN', 'TWN'],
  ['SOM', 'SOL'],
]

function main() {
  const admin1Index = loadAdmin1Index()

  const entities: Record<string, WorldEntity> = {}
  const regions: Record<string, Region> = {}

  for (const identity of allIdentities) {
    const entity = buildEntity(identity)
    const entityRegions = buildRegionsForEntity(identity, entity, admin1Index)
    entity.territoryRegionIds = entityRegions.map((r) => r.id)
    for (const r of entityRegions) {
      Region.parse(r)
      regions[r.id] = r
    }
    WorldEntity.parse(entity)
    entities[entity.id] = entity
  }

  const organizations: Record<string, Organization> = {}
  for (const org of organizationSeeds as any[]) {
    const parsed = Organization.parse({ ...org, active: true, dissolvedTurn: null })
    organizations[parsed.id] = parsed
  }

  const treaties: Record<string, Treaty> = {}
  for (const seed of ALLIANCE_SEEDS) {
    const treaty = Treaty.parse({ ...seed, signedTurn: 0, active: true })
    treaties[treaty.id] = treaty
    for (const memberId of treaty.memberIds) {
      entities[memberId]?.allianceIds.push(treaty.id)
    }
  }

  for (const [aId, bId] of RIVALRY_SEEDS) {
    const a = entities[aId]
    const b = entities[bId]
    if (!a || !b) continue
    a.relations.push({ otherEntityId: bId, opinion: -60, status: 'hostile', treatyIds: [] })
    b.relations.push({ otherEntityId: aId, opinion: -60, status: 'hostile', treatyIds: [] })
  }

  // Maps admin-0 map-unit topojson feature ids to our entity ids, for the map
  // renderer. Most countries resolve by ISO numeric (ccn3); Kosovo, Northern
  // Cyprus, and Somaliland have no ISO code so the map falls back to the
  // admin-0 feature's name field instead.
  const byCcn3: Record<string, string> = {}
  for (const c of worldCountries) {
    if (c.independent && c.ccn3) byCcn3[c.ccn3] = c.cca3
  }
  byCcn3['732'] = 'ESH'
  byCcn3['275'] = 'PSE'
  byCcn3['158'] = 'TWN'
  const byName: Record<string, string> = { Kosovo: 'XKX', Somaliland: 'SOL', 'N. Cyprus': 'CYN' }
  const geoIndex = { byCcn3, byName }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, 'entities.json'), JSON.stringify(entities))
  fs.writeFileSync(path.join(OUT_DIR, 'regions.json'), JSON.stringify(regions))
  fs.writeFileSync(path.join(OUT_DIR, 'organizations.json'), JSON.stringify(organizations))
  fs.writeFileSync(path.join(OUT_DIR, 'treaties.json'), JSON.stringify(treaties))
  fs.writeFileSync(path.join(OUT_DIR, 'geoIndex.json'), JSON.stringify(geoIndex))

  console.log(`Generated ${Object.keys(entities).length} entities (${sovereign.length} sovereign + ${disputed.length} disputed)`)
  console.log(`Generated ${Object.keys(regions).length} regions`)
  console.log(`Generated ${Object.keys(organizations).length} organizations`)
  console.log(`Generated ${Object.keys(treaties).length} treaties`)
}

main()
