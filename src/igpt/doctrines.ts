import type { GovernmentType, WorldEntity } from '@/domain/schemas'

/**
 * IGPT's knowledge of how each country tends to behave -- its "personality".
 * Every value is 0..1. These were written by hand (they are what IGPT was
 * taught), as of January 2026; the simulation, not these profiles, decides
 * what actually happens, and IGPT's learned memory (memory.ts) can push a
 * country away from its doctrine if a strategy keeps failing.
 */
export interface Doctrine {
  /** Willingness to use force at all. */
  aggression: number
  /** Appetite for taking territory (the "Largest Country" victory race). */
  expansionism: number
  /** Weight on growth, low debt, trade (the "Strongest Economy" race). */
  economicFocus: number
  /** Weight on building and keeping a strong military. */
  militaryFocus: number
  /** Preference for alliances, treaties and improving relations. */
  diplomacy: number
  /** Readiness to use sanctions as a tool. */
  sanctionsUse: number
  /** 0 = very cautious, 1 = accepts long odds. */
  riskTolerance: number
  /** Never starts wars or joins defense pacts (e.g. Switzerland). */
  neutral?: boolean
  /** Entities it considers its own and may try to take. */
  claims?: string[]
  /** Countries it backs: sends aid, sanctions their attackers, may ally. */
  protects?: string[]
  /** Long-term adversaries it watches and opposes. */
  rivals?: string[]
  /** One-line description shown in the IGPT panel. */
  summary: string
}

type Traits = Omit<Doctrine, 'summary' | 'claims' | 'protects' | 'rivals' | 'neutral'>

/** Fallback personality by government type, for countries without a
 *  hand-written profile below. */
const BY_GOVERNMENT: Record<GovernmentType, Traits & { summary: string }> = {
  democracy: { aggression: 0.15, expansionism: 0.05, economicFocus: 0.8, militaryFocus: 0.4, diplomacy: 0.7, sanctionsUse: 0.55, riskTolerance: 0.3, summary: 'Trade-minded democracy; fights only when it must.' },
  authoritarian: { aggression: 0.4, expansionism: 0.3, economicFocus: 0.55, militaryFocus: 0.65, diplomacy: 0.4, sanctionsUse: 0.3, riskTolerance: 0.5, summary: 'Strongman state; values security and leverage.' },
  monarchy: { aggression: 0.25, expansionism: 0.15, economicFocus: 0.65, militaryFocus: 0.5, diplomacy: 0.55, sanctionsUse: 0.3, riskTolerance: 0.35, summary: 'Monarchy focused on stability and prosperity.' },
  theocracy: { aggression: 0.45, expansionism: 0.3, economicFocus: 0.4, militaryFocus: 0.6, diplomacy: 0.35, sanctionsUse: 0.4, riskTolerance: 0.55, summary: 'Ideological state; confrontational with rivals.' },
  military_junta: { aggression: 0.55, expansionism: 0.4, economicFocus: 0.35, militaryFocus: 0.8, diplomacy: 0.3, sanctionsUse: 0.2, riskTolerance: 0.6, summary: 'Military rulers; the army comes first.' },
  communist_state: { aggression: 0.35, expansionism: 0.3, economicFocus: 0.6, militaryFocus: 0.65, diplomacy: 0.4, sanctionsUse: 0.3, riskTolerance: 0.4, summary: 'One-party state; patient and security-minded.' },
  failed_state: { aggression: 0.3, expansionism: 0.15, economicFocus: 0.3, militaryFocus: 0.5, diplomacy: 0.25, sanctionsUse: 0.1, riskTolerance: 0.6, summary: 'Fractured state struggling to hold together.' },
}

const NATO_EU_UKRAINE_BACKERS = ['GBR', 'FRA', 'DEU', 'POL', 'CAN', 'NLD', 'SWE', 'NOR', 'DNK', 'FIN', 'EST', 'LVA', 'LTU', 'CZE', 'ROU', 'BEL', 'ITA', 'ESP']

/** Hand-written profiles. Only the fields that differ from the
 *  government-type default need to be given. */
const PROFILES: Record<string, Partial<Doctrine> & { summary: string }> = {
  USA: {
    aggression: 0.3, expansionism: 0.05, economicFocus: 0.85, militaryFocus: 0.85, diplomacy: 0.85, sanctionsUse: 0.9, riskTolerance: 0.4,
    protects: ['UKR', 'TWN', 'ISR', 'KOR', 'JPN', 'PHL', 'POL', 'EST', 'LVA', 'LTU', 'GUY', 'XKX'],
    rivals: ['CHN', 'RUS', 'IRN', 'PRK'],
    summary: 'Superpower that leads alliances and sanctions coalitions.',
  },
  CHN: {
    aggression: 0.3, expansionism: 0.35, economicFocus: 0.9, militaryFocus: 0.75, diplomacy: 0.6, sanctionsUse: 0.4, riskTolerance: 0.35,
    claims: ['TWN'], protects: ['PRK'], rivals: ['USA', 'TWN', 'JPN', 'IND'],
    summary: 'Rising power; patient, economy-first, but claims Taiwan.',
  },
  RUS: {
    aggression: 0.7, expansionism: 0.7, economicFocus: 0.35, militaryFocus: 0.9, diplomacy: 0.35, sanctionsUse: 0.4, riskTolerance: 0.7,
    claims: ['UKR'], protects: ['BLR'], rivals: ['UKR', 'USA', 'POL', 'GBR'],
    summary: 'Revisionist power at war in Ukraine; accepts high risk for territory.',
  },
  UKR: {
    aggression: 0.2, expansionism: 0.05, economicFocus: 0.5, militaryFocus: 0.95, diplomacy: 0.9, sanctionsUse: 0.7, riskTolerance: 0.5,
    rivals: ['RUS', 'BLR'],
    summary: 'Defending against invasion; seeks allies and arms above all.',
  },
  BLR: { aggression: 0.3, militaryFocus: 0.6, protects: ['RUS'], rivals: ['UKR', 'POL', 'LTU'], summary: "Russia's closest ally." },
  GBR: { aggression: 0.25, militaryFocus: 0.6, diplomacy: 0.8, sanctionsUse: 0.8, protects: ['UKR', 'EST', 'LVA', 'LTU', 'POL'], rivals: ['RUS'], summary: 'Atlanticist power; backs Ukraine, leans on sanctions.' },
  FRA: { aggression: 0.25, militaryFocus: 0.6, diplomacy: 0.8, sanctionsUse: 0.75, protects: ['UKR'], rivals: ['RUS'], summary: 'Nuclear power with independent streak; backs Ukraine.' },
  DEU: { aggression: 0.05, militaryFocus: 0.45, economicFocus: 0.95, diplomacy: 0.85, sanctionsUse: 0.7, protects: ['UKR', 'POL'], rivals: ['RUS'], summary: 'Industrial giant, wary of force; rearming slowly.' },
  POL: { aggression: 0.2, militaryFocus: 0.9, diplomacy: 0.8, sanctionsUse: 0.85, protects: ['UKR', 'LTU', 'LVA', 'EST'], rivals: ['RUS', 'BLR'], summary: 'Frontline NATO state rapidly building its army.' },
  JPN: { aggression: 0.05, expansionism: 0, militaryFocus: 0.55, economicFocus: 0.9, diplomacy: 0.8, protects: ['TWN', 'PHL'], rivals: ['CHN', 'PRK'], summary: 'Pacifist constitution, growing defense budget.' },
  KOR: { aggression: 0.1, militaryFocus: 0.8, economicFocus: 0.85, diplomacy: 0.7, rivals: ['PRK'], summary: 'Tech economy living next to North Korea.' },
  PRK: { aggression: 0.5, expansionism: 0.4, militaryFocus: 1, economicFocus: 0.15, diplomacy: 0.1, riskTolerance: 0.75, claims: ['KOR'], protects: ['RUS'], rivals: ['KOR', 'USA', 'JPN'], summary: 'Garrison state; military first, everything else second.' },
  TWN: { aggression: 0.02, expansionism: 0, militaryFocus: 0.85, economicFocus: 0.9, diplomacy: 0.85, riskTolerance: 0.2, rivals: ['CHN'], summary: 'Semiconductor economy deterring invasion.' },
  IND: { aggression: 0.25, militaryFocus: 0.7, economicFocus: 0.85, diplomacy: 0.6, sanctionsUse: 0.2, rivals: ['PAK', 'CHN'], summary: 'Fast-growing giant; strategic autonomy, avoids blocs.' },
  PAK: { aggression: 0.35, militaryFocus: 0.85, economicFocus: 0.4, riskTolerance: 0.5, protects: [], rivals: ['IND', 'AFG'], summary: 'Army-dominated state fixated on India.' },
  ISR: { aggression: 0.5, expansionism: 0.15, militaryFocus: 0.95, economicFocus: 0.7, riskTolerance: 0.55, rivals: ['IRN', 'PSE', 'LBN', 'SYR'], summary: 'Small, highly capable military; strikes threats early.' },
  IRN: { aggression: 0.5, expansionism: 0.2, militaryFocus: 0.75, economicFocus: 0.35, diplomacy: 0.3, sanctionsUse: 0.2, riskTolerance: 0.55, protects: ['SYR', 'LBN', 'YEM', 'PSE'], rivals: ['ISR', 'USA', 'SAU', 'ARE'], summary: 'Works through proxies; confronts Israel and the Gulf.' },
  SAU: { aggression: 0.3, militaryFocus: 0.7, economicFocus: 0.8, diplomacy: 0.6, rivals: ['IRN'], summary: 'Oil power diversifying its economy; rival of Iran.' },
  ARE: { aggression: 0.2, militaryFocus: 0.6, economicFocus: 0.95, diplomacy: 0.75, rivals: ['IRN'], summary: 'Trading hub with a capable small military.' },
  TUR: { aggression: 0.45, expansionism: 0.2, militaryFocus: 0.75, economicFocus: 0.6, diplomacy: 0.6, riskTolerance: 0.5, protects: ['AZE', 'CYN'], rivals: ['GRC', 'CYP', 'ARM', 'SYR'], summary: 'Regional power playing all sides.' },
  GRC: { aggression: 0.1, militaryFocus: 0.6, protects: ['CYP'], rivals: ['TUR', 'CYN'], summary: 'Watches Turkey across the Aegean.' },
  CYP: { aggression: 0.05, claims: ['CYN'], rivals: ['TUR', 'CYN'], summary: 'Divided island; wants the north back peacefully.' },
  AZE: { aggression: 0.45, expansionism: 0.3, militaryFocus: 0.7, riskTolerance: 0.5, protects: [], rivals: ['ARM'], summary: 'Oil-funded military; recently victorious over Armenia.' },
  ARM: { aggression: 0.1, militaryFocus: 0.7, diplomacy: 0.75, rivals: ['AZE', 'TUR'], summary: 'Small state seeking new protectors.' },
  EGY: { aggression: 0.25, militaryFocus: 0.65, rivals: ['ETH'], summary: 'Army-led state; Nile water dispute with Ethiopia.' },
  ETH: { aggression: 0.35, expansionism: 0.2, militaryFocus: 0.6, rivals: ['EGY', 'ERI'], summary: 'Regional heavyweight seeking sea access.' },
  ERI: { aggression: 0.4, militaryFocus: 0.85, economicFocus: 0.2, rivals: ['ETH'], summary: 'Highly militarized, isolated state.' },
  MAR: { aggression: 0.3, expansionism: 0.3, claims: ['ESH'], rivals: ['DZA', 'ESH'], summary: 'Holds Western Sahara; rival of Algeria.' },
  DZA: { aggression: 0.3, militaryFocus: 0.75, protects: ['ESH'], rivals: ['MAR'], summary: 'Large army; backs Western Saharan independence.' },
  ESH: { aggression: 0.3, rivals: ['MAR'], summary: 'Independence movement against Morocco.' },
  SRB: { aggression: 0.25, expansionism: 0.25, claims: ['XKX'], rivals: ['XKX'], summary: 'Does not recognize Kosovo.' },
  XKX: { aggression: 0.05, diplomacy: 0.85, rivals: ['SRB'], summary: 'Young state seeking recognition.' },
  VEN: { aggression: 0.4, expansionism: 0.4, economicFocus: 0.3, riskTolerance: 0.6, claims: ['GUY'], rivals: ['GUY', 'USA'], summary: "Crisis-hit state claiming Guyana's Essequibo." },
  GUY: { aggression: 0.02, diplomacy: 0.85, rivals: ['VEN'], summary: 'Oil boom economy under Venezuelan threat.' },
  THA: { aggression: 0.3, militaryFocus: 0.6, rivals: ['KHM'], summary: 'Army-influenced politics; border dispute with Cambodia.' },
  KHM: { aggression: 0.3, militaryFocus: 0.55, protects: [], rivals: ['THA'], summary: 'Contests its border with Thailand.' },
  VNM: { aggression: 0.15, militaryFocus: 0.6, economicFocus: 0.85, rivals: ['CHN'], summary: 'Manufacturing boom; wary of China at sea.' },
  PHL: { aggression: 0.05, militaryFocus: 0.55, diplomacy: 0.8, rivals: ['CHN'], summary: 'Archipelago leaning on its US alliance.' },
  SOM: { aggression: 0.3, claims: ['SOL'], rivals: ['SOL'], summary: 'Fragile federal state that claims Somaliland.' },
  SOL: { aggression: 0.1, diplomacy: 0.85, rivals: ['SOM'], summary: 'Self-governing, unrecognized, seeking recognition.' },
  PSE: { aggression: 0.2, militaryFocus: 0.3, diplomacy: 0.8, rivals: ['ISR'], summary: 'Occupied territories seeking statehood.' },
  CHE: { aggression: 0, expansionism: 0, economicFocus: 1, militaryFocus: 0.35, diplomacy: 0.6, sanctionsUse: 0.4, riskTolerance: 0.1, neutral: true, summary: 'Armed neutrality; banking and trade above all.' },
  AUT: { aggression: 0.02, expansionism: 0, economicFocus: 0.9, diplomacy: 0.7, sanctionsUse: 0.5, neutral: true, summary: 'Neutral EU member.' },
  IRL: { aggression: 0.01, expansionism: 0, economicFocus: 0.95, militaryFocus: 0.1, diplomacy: 0.75, sanctionsUse: 0.6, neutral: true, summary: 'Neutral, low-tax tech hub.' },
  SGP: { aggression: 0.02, expansionism: 0, economicFocus: 1, militaryFocus: 0.6, diplomacy: 0.8, summary: 'Trading city-state with a strong defense force.' },
  BRA: { aggression: 0.05, economicFocus: 0.8, diplomacy: 0.7, sanctionsUse: 0.1, summary: 'Regional giant; non-aligned, trade-focused.' },
  MEX: { aggression: 0.03, economicFocus: 0.85, militaryFocus: 0.25, sanctionsUse: 0.1, summary: 'Manufacturing partner of the US; avoids conflict.' },
}
for (const id of NATO_EU_UKRAINE_BACKERS) {
  const p = PROFILES[id]
  if (p) p.protects = Array.from(new Set([...(p.protects ?? []), 'UKR']))
  else PROFILES[id] = { protects: ['UKR'], rivals: ['RUS'], sanctionsUse: 0.75, summary: 'European democracy backing Ukraine.' }
}

export function doctrineFor(entity: WorldEntity): Doctrine {
  const base = BY_GOVERNMENT[entity.government.type]
  const profile = PROFILES[entity.id]
  return { ...base, ...profile, summary: profile?.summary ?? base.summary } as Doctrine
}

export function hasProfile(entityId: string): boolean {
  return !!PROFILES[entityId]
}
