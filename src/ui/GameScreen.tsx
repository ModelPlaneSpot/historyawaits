import { useGameStore } from '@/state/gameStore'
import { MapView } from './map/MapView'
import { EntityPanel } from './panels/EntityPanel'
import { RegionPanel } from './panels/RegionPanel'
import { NewsPanel } from './panels/NewsPanel'
import { CommandConsole } from './CommandConsole'
import { AiStatusBadge } from './AiStatusBadge'

export function GameScreen() {
  const worldState = useGameStore((s) => s.worldState)
  const selectedEntityId = useGameStore((s) => s.selectedEntityId)
  const selectedRegionId = useGameStore((s) => s.selectedRegionId)
  const selectEntity = useGameStore((s) => s.selectEntity)
  const selectRegion = useGameStore((s) => s.selectRegion)
  const endTurn = useGameStore((s) => s.endTurn)
  const saveNow = useGameStore((s) => s.saveNow)
  const returnToMenu = useGameStore((s) => s.returnToMenu)
  const busy = useGameStore((s) => s.busy)

  if (!worldState) return null

  const player = worldState.entities[worldState.playerEntityId]
  const selectedEntity = selectedEntityId ? worldState.entities[selectedEntityId] : null
  const selectedRegion = selectedRegionId ? worldState.regions[selectedRegionId] : null

  return (
    <div className="game-screen">
      <div className="top-bar">
        <span className="color-swatch" style={{ background: player.mapColor }} />
        <span className={`fi fi-${player.flagCode}`} />
        <strong>{player.name}</strong>
        <span className="turn-label">Turn {worldState.turn}</span>
        <div className="spacer" />
        <AiStatusBadge />
        <button onClick={() => saveNow()}>Save</button>
        <button onClick={returnToMenu}>Menu</button>
        <button className="primary" onClick={() => endTurn()} disabled={busy}>
          {busy ? 'Working...' : 'End Turn'}
        </button>
      </div>
      <div className="game-body">
        <MapView
          worldState={worldState}
          selectedEntityId={selectedEntityId}
          selectedRegionId={selectedRegionId}
          onSelectEntity={selectEntity}
          onSelectRegion={selectRegion}
        />
        <div className="side-panel">
          {selectedEntity && <EntityPanel entity={selectedEntity} />}
          {selectedRegion && <RegionPanel region={selectedRegion} worldState={worldState} />}
          <NewsPanel news={worldState.news} worldState={worldState} />
        </div>
      </div>
      <CommandConsole />
    </div>
  )
}
