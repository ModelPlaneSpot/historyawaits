import { WorldState, SAVE_FORMAT_VERSION, type WorldEntity, type Region, type Organization, type Treaty } from '@/domain/schemas'
import entitiesData from '@/data/generated/entities.json'
import regionsData from '@/data/generated/regions.json'
import organizationsData from '@/data/generated/organizations.json'
import treatiesData from '@/data/generated/treaties.json'

export function createNewGame(playerEntityId: string): WorldState {
  const entities = structuredClone(entitiesData) as unknown as Record<string, WorldEntity>
  const regions = structuredClone(regionsData) as unknown as Record<string, Region>
  const organizations = structuredClone(organizationsData) as unknown as Record<string, Organization>
  const treaties = structuredClone(treatiesData) as unknown as Record<string, Treaty>

  if (!entities[playerEntityId]) {
    throw new Error(`Unknown entity id: ${playerEntityId}`)
  }
  entities[playerEntityId].isPlayerControlled = true

  const state: WorldState = {
    saveVersion: SAVE_FORMAT_VERSION,
    turn: 0,
    playerEntityId,
    entities,
    regions,
    organizations,
    wars: {},
    treaties,
    news: [
      {
        id: 'NEWS-0-0',
        turn: 0,
        headline: `A new game begins as ${entities[playerEntityId].name}`,
        body: 'The world awaits your first move.',
        entityIds: [playerEntityId],
        category: 'breaking',
        importance: 'minor',
        locationEntityId: playerEntityId,
        locationRegionId: null,
        storyEventId: null,
      },
    ],
    storyEvents: {},
  }

  return WorldState.parse(state)
}

export function listPlayableEntities(): { id: string; name: string; kind: WorldEntity['kind']; flagCode: string; mapColor: string }[] {
  const entities = entitiesData as unknown as Record<string, WorldEntity>
  return Object.values(entities)
    .map((e) => ({ id: e.id, name: e.name, kind: e.kind, flagCode: e.flagCode, mapColor: e.mapColor }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
