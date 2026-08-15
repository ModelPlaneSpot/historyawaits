import { z } from 'zod'
import { Government, PoliticalParty } from './government'
import { Economy } from './economy'
import { Military } from './military'
import { Population } from './population'
import { Relation } from './diplomacy'
import { DataConfidence } from './common'

/**
 * A WorldEntity is anything the player (or an AI) can act as/on: a sovereign
 * country, or a non-UN disputed territory (Taiwan, Kosovo, Palestine, etc.)
 * that is selectable and simulated the same way but carries extra claim state.
 */
const WorldEntityBase = z.object({
  id: z.string(),
  name: z.string(),
  officialName: z.string(),
  capital: z.string(),
  flagCode: z.string(),
  latlng: z.tuple([z.number(), z.number()]),
  government: Government,
  parties: z.array(PoliticalParty),
  economy: Economy,
  military: Military,
  population: Population,
  relations: z.array(Relation),
  allianceIds: z.array(z.string()),
  territoryRegionIds: z.array(z.string()),
  isPlayerControlled: z.boolean(),
  dataConfidence: DataConfidence,
})

export const Country = WorldEntityBase.extend({
  kind: z.literal('country'),
  cca2: z.string().length(2),
  cca3: z.string().length(3),
  region: z.string(),
  subregion: z.string(),
  unMember: z.boolean(),
})
export type Country = z.infer<typeof Country>

export const DisputedEntity = WorldEntityBase.extend({
  kind: z.literal('disputed_entity'),
  claimantIds: z.array(z.string()),
  controllerId: z.string().nullable(),
  recognitionCount: z.number().int().min(0),
  status: z.enum(['self_governing', 'occupied', 'contested', 'de_facto_independent']),
})
export type DisputedEntity = z.infer<typeof DisputedEntity>

export const WorldEntity = z.discriminatedUnion('kind', [Country, DisputedEntity])
export type WorldEntity = z.infer<typeof WorldEntity>
