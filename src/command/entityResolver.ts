import type { WorldState } from '@/domain/schemas'
import { levenshtein } from './fuzzyMatch'

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
  'dr congo': 'COD',
  congo: 'COD',
  'north korea': 'PRK',
  dprk: 'PRK',
  'south korea': 'KOR',
  rok: 'KOR',
  russia: 'RUS',
  'russian federation': 'RUS',
  iran: 'IRN',
  'palestinian territories': 'PSE',
  palestine: 'PSE',
  taiwan: 'TWN',
  kosovo: 'XKX',
  'northern cyprus': 'CYN',
  somaliland: 'SOL',
  'western sahara': 'ESH',
  turkey: 'TUR',
  turkiye: 'TUR',
}

export interface ResolverIndex {
  entities: Map<string, string>
  regions: Map<string, string>
  organizations: Map<string, string>
  /** id -> a human-readable display name, for building clarification
   *  questions ("did you mean X or Y?") without a second lookup pass. */
  displayNames: Map<string, string>
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

/** Strips diacritics (Turkiye -> turkiye, Cote d'Ivoire -> cote d'ivoire) so
 *  players typing plain ASCII still match names the data stores with accents,
 *  then lowercases and strips punctuation. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/^the\s+/, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
}

export function buildResolverIndex(state: WorldState): ResolverIndex {
  const entities = new Map<string, string>()
  const displayNames = new Map<string, string>()
  for (const [alias, id] of Object.entries(ALIASES)) entities.set(alias, id)
  for (const entity of Object.values(state.entities)) {
    entities.set(normalize(entity.name), entity.id)
    entities.set(normalize(entity.officialName), entity.id)
    entities.set(entity.id.toLowerCase(), entity.id)
    if ('cca2' in entity) entities.set(entity.cca2.toLowerCase(), entity.id)
    if ('cca3' in entity) entities.set(entity.cca3.toLowerCase(), entity.id)
    displayNames.set(entity.id, entity.name)
  }

  const regions = new Map<string, string>()
  for (const region of Object.values(state.regions)) {
    regions.set(normalize(region.name), region.id)
    regions.set(region.id.toLowerCase(), region.id)
    displayNames.set(region.id, region.name)
  }

  const organizations = new Map<string, string>()
  for (const org of Object.values(state.organizations)) {
    organizations.set(normalize(org.name), org.id)
    organizations.set(org.id.toLowerCase(), org.id)
    displayNames.set(org.id, org.name)
  }

  return { entities, regions, organizations, displayNames }
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

const FUZZY_SIMILARITY_THRESHOLD = 0.72
/** How close two fuzzy candidates' scores need to be to count as a genuine
 *  tie -- below this margin we ask the player instead of guessing. */
const AMBIGUITY_MARGIN = 0.06

/** Typo-tolerant fallback for when no exact substring match exists. Slides a
 *  1-3 word window across the input and edit-distance-compares each window
 *  against every known name, so "Isreal" still finds Israel, "Camboda"
 *  still finds Cambodia, even embedded in a longer sentence. Returns EVERY
 *  id that scored above threshold (deduped, best score per id, sorted) so
 *  the caller can detect a near-tie and ask rather than guess. */
function fuzzyFindAll(text: string, index: Map<string, string>): { id: string; score: number }[] {
  const words = normalize(text).split(' ').filter(Boolean)
  const spans: string[] = []
  for (let len = 1; len <= 3 && len <= words.length; len++) {
    for (let i = 0; i + len <= words.length; i++) spans.push(words.slice(i, i + len).join(' '))
  }
  if (spans.length === 0) return []

  const bestPerId = new Map<string, number>()
  for (const [name, id] of index) {
    if (name.length < 4) continue
    let best = 0
    for (const span of spans) {
      if (Math.abs(span.length - name.length) > 4) continue // cheap length prune
      const dist = levenshtein(span, name)
      const score = 1 - dist / Math.max(span.length, name.length)
      if (score > best) best = score
    }
    if (best >= FUZZY_SIMILARITY_THRESHOLD) {
      const existing = bestPerId.get(id)
      if (!existing || best > existing) bestPerId.set(id, best)
    }
  }

  return [...bestPerId.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score)
}

export interface ResolveResult {
  id: string | null
  kind: 'region' | 'organization' | 'entity' | null
  /** 1.0 = exact substring match, <1.0 = fuzzy/typo-corrected match, 0 = not found. */
  confidence: number
  /** True when multiple distinct entities were plausible and neither
   *  clearly wins -- id is null in this case; the caller must ask, not guess. */
  ambiguous: boolean
  /** Display names of the tied candidates, for a clarification question. */
  alternatives: string[]
}

function notFound(): ResolveResult {
  return { id: null, kind: null, confidence: 0, ambiguous: false, alternatives: [] }
}

function fromFuzzy(ranked: { id: string; score: number }[], kind: ResolveResult['kind'], index: ResolverIndex): ResolveResult {
  if (ranked.length === 0) return notFound()
  const [best, second] = ranked
  if (second && best.score - second.score < AMBIGUITY_MARGIN) {
    const tied = ranked.filter((r) => best.score - r.score < AMBIGUITY_MARGIN)
    return {
      id: null,
      kind,
      confidence: best.score,
      ambiguous: true,
      alternatives: tied.map((r) => index.displayNames.get(r.id) ?? r.id),
    }
  }
  return { id: best.id, kind, confidence: best.score, ambiguous: false, alternatives: [] }
}

/** Resolves a region, organization, or country from free text, in that
 *  priority order when names overlap. Tries an exact substring match first
 *  (fast, unambiguous); falls back to fuzzy/typo-tolerant matching only if
 *  that fails, and refuses to guess between near-tied candidates. */
export function resolveRegionOrOrganizationOrEntity(text: string, index: ResolverIndex): ResolveResult {
  const aliasHit = REGION_ALIASES[normalize(text)]
  if (aliasHit) return { id: aliasHit, kind: 'region', confidence: 1, ambiguous: false, alternatives: [] }

  const region = findLongestMatch(text, index.regions)
  const org = findLongestMatch(text, index.organizations)
  const entity = findLongestMatch(text, index.entities)

  const exactCandidates: { id: string; kind: ResolveResult['kind']; len: number }[] = []
  if (region) exactCandidates.push({ id: region, kind: 'region', len: region.length })
  if (org) exactCandidates.push({ id: org, kind: 'organization', len: org.length })
  if (entity) exactCandidates.push({ id: entity, kind: 'entity', len: entity.length })
  if (exactCandidates.length > 0) {
    exactCandidates.sort((a, b) => b.len - a.len)
    const top = exactCandidates[0]
    return { id: top.id, kind: top.kind, confidence: 1, ambiguous: false, alternatives: [] }
  }

  const fuzzyRegion = fuzzyFindAll(text, index.regions).map((r) => ({ ...r, kind: 'region' as const }))
  const fuzzyOrg = fuzzyFindAll(text, index.organizations).map((r) => ({ ...r, kind: 'organization' as const }))
  const fuzzyEntity = fuzzyFindAll(text, index.entities).map((r) => ({ ...r, kind: 'entity' as const }))
  const allFuzzy = [...fuzzyRegion, ...fuzzyOrg, ...fuzzyEntity].sort((a, b) => b.score - a.score)
  if (allFuzzy.length === 0) return notFound()
  return fromFuzzy(allFuzzy, allFuzzy[0].kind, index)
}

export function resolveEntity(text: string, index: ResolverIndex): ResolveResult {
  const exact = findLongestMatch(text, index.entities)
  if (exact) return { id: exact, kind: 'entity', confidence: 1, ambiguous: false, alternatives: [] }
  return fromFuzzy(fuzzyFindAll(text, index.entities), 'entity', index)
}

export function resolveOrganization(text: string, index: ResolverIndex): ResolveResult {
  const exact = findLongestMatch(text, index.organizations)
  if (exact) return { id: exact, kind: 'organization', confidence: 1, ambiguous: false, alternatives: [] }
  return fromFuzzy(fuzzyFindAll(text, index.organizations), 'organization', index)
}
