import { useEffect, useMemo, useState } from 'react'
import { listPlayableEntities } from '@/simulation/newGame'
import { useGameStore } from '@/state/gameStore'
import { deleteSave, type SaveRecord } from '@/persistence/db'

export function MainMenu() {
  const [query, setQuery] = useState('')
  const startNewGame = useGameStore((s) => s.startNewGame)
  const continueFromSave = useGameStore((s) => s.continueFromSave)
  const refreshSaves = useGameStore((s) => s.refreshSaves)
  const saves = useGameStore((s) => s.saves)
  const busy = useGameStore((s) => s.busy)

  useEffect(() => {
    refreshSaves()
  }, [refreshSaves])

  const entities = useMemo(() => listPlayableEntities(), [])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entities
    return entities.filter((e) => e.name.toLowerCase().includes(q))
  }, [entities, query])

  async function handleDelete(save: SaveRecord, e: React.MouseEvent) {
    e.stopPropagation()
    await deleteSave(save.id)
    await refreshSaves()
  }

  return (
    <div className="main-menu">
      <div className="main-menu-card">
        <div className="main-menu-title">HISTORY AWAITS</div>
        <div className="main-menu-subtitle">
          A world simulation. Command your nation with natural language -- a local AI model, running entirely in your
          browser, translates it into action.
        </div>
        <div className="main-menu-columns">
          <div>
            <h3 style={{ color: 'var(--text-dim)', fontSize: '0.85rem', textTransform: 'uppercase' }}>New Game</h3>
            <input
              placeholder="Search countries..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: '100%', marginBottom: '0.6rem' }}
            />
            <div className="entity-picker">
              {filtered.map((entity) => (
                <div
                  key={entity.id}
                  className="entity-picker-row"
                  onClick={() => !busy && startNewGame(entity.id)}
                >
                  <span className={`fi fi-${entity.flagCode}`} />
                  {entity.name}
                  {entity.kind === 'disputed_entity' && <span className="kind-tag">disputed</span>}
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 style={{ color: 'var(--text-dim)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Continue</h3>
            <div className="entity-picker">
              {saves.length === 0 && (
                <div style={{ padding: '0.8rem', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                  No saved games yet.
                </div>
              )}
              {saves.map((save) => (
                <div key={save.id} className="save-row" style={{ cursor: 'pointer' }} onClick={() => !busy && continueFromSave(save.id)}>
                  <div>
                    <div>{save.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                      {new Date(save.savedAt).toLocaleString()} {save.isAutosave ? '(autosave)' : ''}
                    </div>
                  </div>
                  <button onClick={(e) => handleDelete(save, e)}>Delete</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
