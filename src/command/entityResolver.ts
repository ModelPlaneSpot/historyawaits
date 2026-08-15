import type { WorldState } from '@/domain/schemas'

const ALIASES: Record<string, string> = {
  us: 'USA',
  usa: 'USA',
  america: 'USA',
  'united states': 'USA',
  uk: 'GBR',
  britain: 'GBR',
  'great britain': 'GBR',
  'united kingdom': 'GBR',
  uae: 'ARE',
  emirates: 'ARE',
  drc: 'COD',
  congo: 'COD',
  'north korea': 'PRK',
  'south korea': 'KOR',
  russia: 'RUS',
  iran: 'IRN',
  'palestinian territories': 'PSE',
  palestine: 'PSE',
  taiwan: 'TWN',
  kosovo: 'XKX',
  'northern cyprus': 'CYN',
  somaliland: 'SOL',
  'western sahara': 'ESH',
}

export interface ResolverIndex {
  entities: Map<string, string>
  regions: Map<string, string>
  organizations: Map<string, string>
}

// A few contested territories are commonly referred to by a short name that
// collides with an unrelated region elsewhere in the world (e.g. Mozambique
// also has a province called "Gaza"). These take priority over the general
// substring search below.
const REGION_ALIASES: Record<string, string> = {
  gaza: 'PSE-GAZA',
  'gaza strip': 'PSE-GAZA',
  'the gaza strip': 'PSE-GAZA',
  'west bank': 'PSE-WBK',
  'the west bank': 'PSE-WBK',
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/^the\s+/, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
}

export function buildResolverIndex(state: WorldState): ResolverIndex {
  const entities = new Map<string, string>()
  for (const [alias, id] of Object.entries(ALIASES)) entities.set(alias, id)
  for (const entity of Object.values(state.entities)) {
    entities.set(normalize(entity.name), entity.id)
    entities.set(normalize(entity.officialName), entity.id)
    entities.set(entity.id.toLowerCase(), entity.id)
    if ('cca2' in entity) entities.set(entity.cca2.toLowerCase(), entity.id)
  }

  const regions = new Map<string, string>()
  for (const region of Object.values(state.regions)) {
    regions.set(normalize(region.name), region.id)
    regions.set(region.id.toLowerCase(), region.id)
  }

  const organizations = new Map<string, string>()
  for (const org of Object.values(state.organizations)) {
    organizations.set(normalize(org.name), org.id)
    organizations.set(org.id.toLowerCase(), org.id)
  }

  return { entities, regions, organizations }
}

/** Find the longest known name/alias that appears in `text`, preferring
 *  regions/organizations over entities when phrases overlap (e.g. "Gaza" vs
 *  a country called "Gazastan" -- not real, but the principle holds). */
function findLongestMatch(text: string, index: Map<string, string>): string | null {
  const normalized = normalize(text)
  let best: string | null = null
  let bestLen = 0
  for (const [name, id] of index) {
    if (name.length < 3) continue
    if (normalized.includes(name) && name.length > bestLen) {
      best = id
      bestLen = name.length
    }
  }
  return best
}

export function resolveRegionOrOrganizationOrEntity(
  text: string,
  index: ResolverIndex,
): { id: string; kind: 'region' | 'organization' | 'entity' } | null {
  const aliasHit = REGION_ALIASES[normalize(text)]
  if (aliasHit) return { id: aliasHit, kind: 'region' }

  const region = findLongestMatch(text, index.regions)
  const org = findLongestMatch(text, index.organizations)
  const entity = findLongestMatch(text, index.entities)

  const candidates: { id: string; kind: 'region' | 'organization' | 'entity'; len: number }[] = []
  if (region) candidates.push({ id: region, kind: 'region', len: region.length })
  if (org) candidates.push({ id: org, kind: 'organization', len: org.length })
  if (entity) candidates.push({ id: entity, kind: 'entity', len: entity.length })
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.len - a.len)
  return candidates[0]
}

export function resolveEntity(text: string, index: ResolverIndex): string | null {
  return findLongestMatch(text, index.entities)
}

export function resolveOrganization(text: string, index: ResolverIndex): string | null {
  return findLongestMatch(text, index.organizations)
}
