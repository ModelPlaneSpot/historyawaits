import { z } from 'zod'

/** Every kind of decision IGPT (the game's internal decision engine, see
 *  src/igpt/) can make for a country. Each maps onto an ordinary
 *  StructuredAction, so the player can execute an IGPT suggestion through the
 *  same validator as a typed command. */
export const IgptMove = z.enum([
  'declare_war',
  'propose_peace',
  'sanction',
  'lift_sanction',
  'improve_relations',
  'form_alliance',
  'sign_trade',
  'send_aid',
  'raise_military',
  'cut_military',
  'raise_taxes',
  'cut_taxes',
  'research',
  'build_army',
  'mobilize',
  'demobilize',
])
export type IgptMove = z.infer<typeof IgptMove>

/** Running average of how a move worked out (see src/igpt/memory.ts). */
export const IgptMoveStats = z.object({
  n: z.number().int().min(0),
  reward: z.number(),
})
export type IgptMoveStats = z.infer<typeof IgptMoveStats>

/** A decision waiting to be judged: the actor's fitness (and the world
 *  average) when it was made, compared again a few months later. */
export const IgptPendingOutcome = z.object({
  move: IgptMove,
  turn: z.number().int(),
  fitness: z.number(),
  worldFitness: z.number(),
})
export type IgptPendingOutcome = z.infer<typeof IgptPendingOutcome>

export const IgptCountryMemory = z.object({
  moves: z.record(z.string(), IgptMoveStats),
  pending: z.array(IgptPendingOutcome),
  lastWarTurn: z.number().int().nullable(),
})
export type IgptCountryMemory = z.infer<typeof IgptCountryMemory>

export const IgptLogEntry = z.object({
  turn: z.number().int(),
  actorId: z.string(),
  targetId: z.string().nullable(),
  move: IgptMove,
  summary: z.string(),
  reasons: z.array(z.string()),
})
export type IgptLogEntry = z.infer<typeof IgptLogEntry>

export const IgptState = z.object({
  /** When on, IGPT also runs the player's country. */
  autopilot: z.boolean(),
  memory: z.record(z.string(), IgptCountryMemory),
  /** What every country together has learned about each move. */
  global: z.record(z.string(), IgptMoveStats),
  /** Most recent decisions world-wide, newest last (bounded). */
  log: z.array(IgptLogEntry),
  /** Decisions IGPT made for the player's country on autopilot (bounded). */
  playerLog: z.array(IgptLogEntry),
})
export type IgptState = z.infer<typeof IgptState>

export function emptyIgptState(): IgptState {
  return { autopilot: false, memory: {}, global: {}, log: [], playerLog: [] }
}

/** An active sanction; while it lasts it drags on the target's economy
 *  (see applySanctionsAndTrade in modules/economy.ts). */
export const Sanction = z.object({
  id: z.string(),
  actorId: z.string(),
  targetId: z.string(),
  startTurn: z.number().int(),
})
export type Sanction = z.infer<typeof Sanction>
