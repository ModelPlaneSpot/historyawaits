import type { WorldState } from '@/domain/schemas'
import { setRelationStatus, adjustOpinion, getOrCreateRelation } from './modules/diplomacy'
import { transferRegion } from './modules/territory'
import { createStory } from './modules/story'
import { buildWarNarrative, buildDiplomaticCrisisNarrative } from './modules/storyTemplates'
import { yearsToTicks } from './gameDate'

/** Conflicts already underway on January 1, 2026, so the world starts out
 *  moving instead of from a blank peace. Each one runs through the normal
 *  simulation from here: AI countries can win, lose, sue for peace, or
 *  escalate them, whatever country the player is. */
export function applyOpeningScenario(state: WorldState): void {
  seedRussiaUkraineWar(state)
  seedThailandCambodiaDispute(state)
  spreadElections(state)
}

/** Baseline data schedules every democracy's first election within ~8 months
 *  (it was generated for weekly turns); spread them across a 4-year cycle
 *  instead, deterministically per country so every new game matches. */
function spreadElections(state: WorldState): void {
  const cycle = yearsToTicks(4)
  for (const entity of Object.values(state.entities)) {
    if (entity.government.electionDueTurn === null) continue
    let hash = 0
    for (const ch of entity.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
    entity.government.electionDueTurn = 1 + (hash % cycle)
  }
}

const UKR_OCCUPIED = ['UKR-329'] // Luhansk
const UKR_FRONTLINE = ['UKR-327', 'UKR-331', 'UKR-4827', 'UKR-328'] // Donetsk, Zaporizhzhia, Kherson, Kharkiv

function seedRussiaUkraineWar(state: WorldState): void {
  const rus = state.entities.RUS
  const ukr = state.entities.UKR
  if (!rus || !ukr) return

  for (const id of UKR_OCCUPIED) if (state.regions[id]) transferRegion(state, id, 'RUS')
  const contested = UKR_FRONTLINE.filter((id) => state.regions[id])
  for (const id of contested) {
    const region = state.regions[id]
    region.disputed = true
    if (!region.contestedByIds.includes('RUS')) region.contestedByIds.push('RUS')
  }

  setRelationStatus(state, 'RUS', 'UKR', 'war')
  getOrCreateRelation(rus, 'UKR').opinion = -90
  getOrCreateRelation(ukr, 'RUS').opinion = -90
  rus.military.mobilizationLevel = Math.max(rus.military.mobilizationLevel, 60)
  ukr.military.mobilizationLevel = Math.max(ukr.military.mobilizationLevel, 90)

  const title = 'THE RUSSIA-UKRAINE WAR ENTERS 2026'
  const storyId = createStory(state, 0, {
    ...buildWarNarrative(rus, ukr, -90),
    type: 'war',
    title,
    importance: 'critical',
    category: 'war',
    countryIds: ['RUS', 'UKR'],
    regionIds: [...UKR_OCCUPIED, ...contested],
    headline: title,
    body: 'Fighting continues along the front in Donetsk, Zaporizhzhia, Kherson, and Kharkiv as the war begins its fifth year.',
    locationEntityId: 'UKR',
    background: 'Russia launched a full-scale invasion of Ukraine in February 2022, after annexing Crimea in 2014. Luhansk is almost entirely under Russian control.',
    trigger: 'Ongoing since February 2022.',
  })

  state.wars['WAR-RUS-UKR-0'] = {
    id: 'WAR-RUS-UKR-0',
    attackerIds: ['RUS'],
    defenderIds: ['UKR'],
    startTurn: 0,
    endTurn: null,
    warGoal: 'annexation',
    contestedRegionIds: contested,
    warScore: 10,
    active: true,
    level: 4,
    isCivilWar: false,
    storyEventId: storyId,
  }
}

function seedThailandCambodiaDispute(state: WorldState): void {
  const tha = state.entities.THA
  const khm = state.entities.KHM
  if (!tha || !khm) return

  getOrCreateRelation(tha, 'KHM').opinion = 0
  getOrCreateRelation(khm, 'THA').opinion = 0
  adjustOpinion(state, 'THA', 'KHM', -48)
  setRelationStatus(state, 'THA', 'KHM', 'hostile')

  const title = 'Tensions Rise Along the Thailand-Cambodia Border'
  createStory(state, 0, {
    ...buildDiplomaticCrisisNarrative(tha, khm, -48),
    type: 'diplomatic_crisis',
    title,
    importance: 'medium',
    category: 'diplomacy',
    countryIds: ['THA', 'KHM'],
    regionIds: [],
    headline: title,
    body: 'A fragile ceasefire holds after deadly border clashes in 2025, but troops remain massed near the disputed temples.',
    locationEntityId: 'THA',
    background: 'Thailand and Cambodia have disputed parts of their border for over a century. Clashes in July 2025 killed dozens before a ceasefire was brokered.',
  })
}
