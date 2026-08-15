import type { WorldState } from '@/domain/schemas'
import { pushNews } from './news'

export function transferRegion(state: WorldState, regionId: string, newControllerId: string): void {
  const region = state.regions[regionId]
  if (!region) return
  const oldControllerId = region.controllerId
  if (oldControllerId === newControllerId) return

  const oldController = state.entities[oldControllerId]
  if (oldController) {
    oldController.territoryRegionIds = oldController.territoryRegionIds.filter((id) => id !== regionId)
  }
  const newController = state.entities[newControllerId]
  if (newController && !newController.territoryRegionIds.includes(regionId)) {
    newController.territoryRegionIds.push(regionId)
  }
  region.controllerId = newControllerId
  region.disputed = true
}

/** Annexation outside of a war: only permitted by the validator when the
 *  target has no defended claim (see actionValidator) -- this function just
 *  performs the mechanical transfer once legality has already been checked. */
export function applyAnnex(state: WorldState, actorId: string, targetId: string, turn: number): boolean {
  const actor = state.entities[actorId]
  const targetEntity = state.entities[targetId]
  const targetRegion = state.regions[targetId]

  if (targetRegion) {
    transferRegion(state, targetId, actorId)
    pushNews(state, turn, `${actor?.name ?? actorId} annexes ${targetRegion.name}`, `${actor?.name ?? actorId} has annexed ${targetRegion.name}.`, [actorId], 'major')
    return true
  }
  if (targetEntity) {
    for (const regionId of [...targetEntity.territoryRegionIds]) {
      transferRegion(state, regionId, actorId)
    }
    pushNews(state, turn, `${actor?.name ?? actorId} annexes ${targetEntity.name}`, `${actor?.name ?? actorId} has annexed all territory of ${targetEntity.name}.`, [actorId, targetId], 'major')
    return true
  }
  return false
}
