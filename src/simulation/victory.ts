import type { WorldEntity, WorldState } from '@/domain/schemas'
import regionAreasData from '@/data/generated/regionAreas.json'
import { militaryStrength } from './modules/military'

const REGION_AREAS = regionAreasData as Record<string, number>

/** The three ways to win when the game ends on January 1, 2126. A country
 *  that tops more categories than anyone else is the overall winner. */
export type VictoryCategory = 'territory' | 'economy' | 'military'

export const VICTORY_CATEGORIES: { id: VictoryCategory; title: string; description: string }[] = [
  { id: 'territory', title: 'Largest Country', description: 'Most land area controlled' },
  { id: 'economy', title: 'Strongest Economy', description: 'Biggest GDP with the least debt' },
  { id: 'military', title: 'Strongest Military', description: 'Highest military strength' },
]

export interface CountryStanding {
  entityId: string
  name: string
  flagCode: string
  mapColor: string
  /** km² of regions this country currently controls. */
  areaKm2: number
  gdpUsd: number
  debtToGdpPct: number
  /** GDP discounted by debt: GDP ÷ (1 + debt-to-GDP). A country at 100%
   *  debt-to-GDP scores half its GDP. */
  economyScore: number
  militaryScore: number
  ranks: Record<VictoryCategory, number>
  categoriesWon: number
}

export interface Standings {
  countries: CountryStanding[]
  byCategory: Record<VictoryCategory, CountryStanding[]>
  /** Sorted by categories won, then by best combined rank. */
  overall: CountryStanding[]
}

export function economyScore(entity: WorldEntity): number {
  return entity.economy.gdpUsd / (1 + entity.economy.debtToGdpPct / 100)
}

export function landArea(entity: WorldEntity): number {
  return entity.territoryRegionIds.reduce((sum, id) => sum + (REGION_AREAS[id] ?? 0), 0)
}

const METRIC: Record<VictoryCategory, (s: CountryStanding) => number> = {
  territory: (s) => s.areaKm2,
  economy: (s) => s.economyScore,
  military: (s) => s.militaryScore,
}

export function computeStandings(state: WorldState): Standings {
  const countries: CountryStanding[] = Object.values(state.entities)
    .filter((e) => e.territoryRegionIds.length > 0)
    .map((e) => ({
      entityId: e.id,
      name: e.name,
      flagCode: e.flagCode,
      mapColor: e.mapColor,
      areaKm2: landArea(e),
      gdpUsd: e.economy.gdpUsd,
      debtToGdpPct: e.economy.debtToGdpPct,
      economyScore: economyScore(e),
      militaryScore: militaryStrength(e),
      ranks: { territory: 0, economy: 0, military: 0 },
      categoriesWon: 0,
    }))

  const byCategory = {} as Record<VictoryCategory, CountryStanding[]>
  for (const { id } of VICTORY_CATEGORIES) {
    const sorted = [...countries].sort((a, b) => METRIC[id](b) - METRIC[id](a))
    sorted.forEach((s, i) => (s.ranks[id] = i + 1))
    if (sorted[0]) sorted[0].categoriesWon += 1
    byCategory[id] = sorted
  }

  const rankSum = (s: CountryStanding) => s.ranks.territory + s.ranks.economy + s.ranks.military
  const overall = [...countries].sort((a, b) => b.categoriesWon - a.categoriesWon || rankSum(a) - rankSum(b))

  return { countries, byCategory, overall }
}
