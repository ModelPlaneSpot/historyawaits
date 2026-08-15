import { useEffect, useRef } from 'react'
import { useGameStore } from '@/state/gameStore'
import { MapView } from './map/MapView'
import { EntityPanel } from './panels/EntityPanel'
import { RegionPanel } from './panels/RegionPanel'
import { NewsPanel } from './panels/NewsPanel'
import { NewsFeedPanel } from './panels/NewsFeedPanel'
import { CommandConsole } from './CommandConsole'
import { AiStatusBadge } from './AiStatusBadge'
import { AdvisorPanel } from './AdvisorPanel'
import { TurnSummaryModal } from './TurnSummaryModal'
import { EventDetailPanel } from './EventDetailPanel'
import { formatGameDate } from '@/simulation/gameDate'

export function GameScreen() {
  const worldState = useGameStore((s) => s.worldState)
  const selectedEntityId = useGameStore((s) => s.selectedEntityId)
  const selectedRegionId = useGameStore((s) => s.selectedRegionId)
  const selectEntity = useGameStore((s) => s.selectEntity)
  const selectRegionAndEntity = useGameStore((s) => s.selectRegionAndEntity)
  const focusTarget = useGameStore((s) => s.focusTarget)
  const focusNonce = useGameStore((s) => s.focusNonce)
  const endTurn = useGameStore((s) => s.endTurn)
  const saveNow = useGameStore((s) => s.saveNow)
  const returnToMenu = useGameStore((s) => s.returnToMenu)
  const busy = useGameStore((s) => s.busy)
  const toggleAdvisor = useGameStore((s) => s.toggleAdvisor)
  const toggleNews = useGameStore((s) => s.toggleNews)
  const sidePanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selectedRegionId) sidePanelRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [selectedRegionId])

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
        <span className="turn-label">
          Turn {worldState.turn} &middot; {formatGameDate(worldState.turn)}
        </span>
        <div className="spacer" />
        <AiStatusBadge />
        <button onClick={toggleNews}>World News</button>
        <button onClick={toggleAdvisor}>AI Advisor</button>
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
          onSelectRegion={selectRegionAndEntity}
          focusTarget={focusTarget}
          focusNonce={focusNonce}
        />
        <div className="side-panel" ref={sidePanelRef}>
          {selectedRegion && <RegionPanel region={selectedRegion} worldState={worldState} />}
          {selectedEntity && <EntityPanel entity={selectedEntity} />}
          <NewsPanel news={worldState.news} worldState={worldState} />
        </div>
      </div>
      <CommandConsole />
      <AdvisorPanel />
      <NewsFeedPanel />
      <TurnSummaryModal />
      <EventDetailPanel />
    </div>
  )
}
