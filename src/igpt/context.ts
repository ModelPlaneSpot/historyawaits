import type { War, WorldEntity, WorldState } from '@/domain/schemas'
import { militaryStrength } from '@/simulation/modules/military'
import { economyScore, landArea } from '@/simulation/victory'
import { doctrineFor, type Doctrine } from './doctrines'

/**
 * Everything IGPT needs about the world, computed ONCE per tick and shared by
 * every country that thinks that tick -- so a decision costs a few lookups,
 * not a scan of the whole world (which is what made the old AI slow down
 * over a long game).
 */
export interface WorldIndex {
  state: WorldState
  turn: number
  strength: Map<string, number>
  /** Active wars each entity is fighting in. */
  wars: Map<string, War[]>
  /** Same-subregion countries -- the simulation's "neighbor" approximation. */
  neighbors: Map<string, string[]>
  /** Active alliance partners. */
  allies: Map<string, Set<string>>
  /** Countries whose doctrine says they back each entity (USA -> Taiwan...). */
  protectorsOf: Map<string, string[]>
  /** Members of an active trade agreement with each entity. */
  tradePartners: Map<string, Set<string>>
  doctrines: Map<string, Doctrine>
  /** Victory-race fitness (see fitness()), and the world average. */
  fitness: Map<string, number>
  worldFitness: number
  worldGdp: number
  /** Rank in each victory category (1 = leading). */
  ranks: Map<string, { territory: number; economy: number; military: number }>
}

/** One number summarizing how well a country is doing in the three victory
 *  races; IGPT's learning compares it before and after each decision. Logs
 *  keep giants and micro-states on the same scale. */
export function fitness(area: number, econ: number, mil: number): number {
  return (Math.log10(1 + area) + Math.log10(1 + econ / 1e9) + Math.log10(1 + mil)) / 3
}

export function isAlive(e: WorldEntity): boolean {
  return e.territoryRegionIds.length > 0
}

export function buildWorldIndex(state: WorldState, turn: number): WorldIndex {
  const alive = Object.values(state.entities).filter(isAlive)
  const strength = new Map<string, number>()
  const doctrines = new Map<string, Doctrine>()
  const fit = new Map<string, number>()
  const area = new Map<string, number>()
  const econ = new Map<string, number>()
  let worldGdp = 0
  let fitSum = 0

  for (const e of alive) {
    const s = militaryStrength(e)
    const a = landArea(e)
    const ec = economyScore(e)
    strength.set(e.id, s)
    area.set(e.id, a)
    econ.set(e.id, ec)
    doctrines.set(e.id, doctrineFor(e))
    const f = fitness(a, ec, s)
    fit.set(e.id, f)
    fitSum += f
    worldGdp += e.economy.gdpUsd
  }

  const wars = new Map<string, War[]>()
  for (const w of Object.values(state.wars)) {
    if (!w.active) continue
    for (const id of [...w.attackerIds, ...w.defenderIds]) {
      const list = wars.get(id)
      if (list) list.push(w)
      else wars.set(id, [w])
    }
  }

  const bySub = new Map<string, string[]>()
  for (const e of alive) {
    if (e.kind !== 'country') continue
    const list = bySub.get(e.subregion) ?? []
    list.push(e.id)
    bySub.set(e.subregion, list)
  }
  const neighbors = new Map<string, string[]>()
  for (const e of alive) {
    if (e.kind === 'country') neighbors.set(e.id, (bySub.get(e.subregion) ?? []).filter((id) => id !== e.id))
    else {
      // Disputed entities neighbor their claimants.
      neighbors.set(e.id, e.claimantIds.filter((id) => state.entities[id]))
    }
  }

  const allies = new Map<string, Set<string>>()
  const tradePartners = new Map<string, Set<string>>()
  for (const t of Object.values(state.treaties)) {
    if (!t.active) continue
    const target = t.type === 'defense_pact' ? allies : t.type === 'trade_agreement' ? tradePartners : null
    if (!target) continue
    for (const a of t.memberIds) {
      for (const b of t.memberIds) {
        if (a === b) continue
        let set = target.get(a)
        if (!set) target.set(a, (set = new Set()))
        set.add(b)
      }
    }
  }

  const protectorsOf = new Map<string, string[]>()
  for (const [id, d] of doctrines) {
    for (const p of d.protects ?? []) {
      const list = protectorsOf.get(p) ?? []
      list.push(id)
      protectorsOf.set(p, list)
    }
  }

  const ranks = new Map<string, { territory: number; economy: number; military: number }>()
  const rank = (metric: Map<string, number>, key: 'territory' | 'economy' | 'military') => {
    ;[...metric.entries()]
      .sort((x, y) => y[1] - x[1])
      .forEach(([id], i) => {
        const r = ranks.get(id) ?? { territory: 0, economy: 0, military: 0 }
        r[key] = i + 1
        ranks.set(id, r)
      })
  }
  rank(area, 'territory')
  rank(econ, 'economy')
  rank(strength, 'military')

  return {
    state,
    turn,
    strength,
    wars,
    neighbors,
    allies,
    protectorsOf,
    tradePartners,
    doctrines,
    fitness: fit,
    worldFitness: alive.length ? fitSum / alive.length : 0,
    worldGdp,
    ranks,
  }
}

export function atWarWith(index: WorldIndex, a: string, b: string): War | null {
  return index.wars.get(a)?.find((w) => (w.attackerIds.includes(a) && w.defenderIds.includes(b)) || (w.attackerIds.includes(b) && w.defenderIds.includes(a))) ?? null
}

/** Strength of a country plus half the strength of its allies and a third
 *  of its protectors' (who may intervene) -- what an attacker should
 *  actually expect to face. */
export function effectiveDefense(index: WorldIndex, id: string): number {
  let total = index.strength.get(id) ?? 0
  const allies = index.allies.get(id)
  for (const ally of allies ?? []) total += (index.strength.get(ally) ?? 0) * 0.5
  for (const p of index.protectorsOf.get(id) ?? []) if (!allies?.has(p)) total += (index.strength.get(p) ?? 0) * 0.33
  return total
}

/** The strongest country that backs this one (formally or by doctrine). */
export function strongestBacker(index: WorldIndex, id: string): { id: string; strength: number } | null {
  let best: { id: string; strength: number } | null = null
  for (const p of [...(index.allies.get(id) ?? []), ...(index.protectorsOf.get(id) ?? [])]) {
    const s = index.strength.get(p) ?? 0
    if (!best || s > best.strength) best = { id: p, strength: s }
  }
  return best
}
