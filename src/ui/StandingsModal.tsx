import { useMemo } from 'react'
import { useGameStore } from '@/state/gameStore'
import { computeStandings, VICTORY_CATEGORIES, type CountryStanding, type VictoryCategory } from '@/simulation/victory'
import { formatGameDate, isGameOver } from '@/simulation/gameDate'

const TOP_N = 5

function formatValue(category: VictoryCategory, s: CountryStanding): string {
  if (category === 'territory') return `${Math.round(s.areaKm2).toLocaleString()} km²`
  if (category === 'economy') return `$${(s.gdpUsd / 1e12).toFixed(2)}T GDP · ${s.debtToGdpPct.toFixed(0)}% debt`
  return `${Math.round(s.militaryScore).toLocaleString()} strength`
}

/** Live standings in the three victory categories, and the final results
 *  screen once the game reaches January 1, 2126. */
export function StandingsModal() {
  const open = useGameStore((s) => s.standingsOpen)
  const toggle = useGameStore((s) => s.toggleStandings)
  const returnToMenu = useGameStore((s) => s.returnToMenu)
  const worldState = useGameStore((s) => s.worldState)
  const standings = useMemo(() => (open && worldState ? computeStandings(worldState) : null), [open, worldState])

  if (!open || !worldState || !standings) return null

  const final = isGameOver(worldState.turn)
  const playerId = worldState.playerEntityId
  const player = standings.countries.find((c) => c.entityId === playerId)
  const winner = standings.overall[0]
  const playerWon = final && winner?.entityId === playerId

  return (
    <div className="modal-overlay" onClick={toggle}>
      <div className="turn-summary-modal standings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="advisor-header">
          <strong>{final ? 'Final Results · January 1, 2126' : `Standings · ${formatGameDate(worldState.turn)}`}</strong>
          <button onClick={toggle} className="advisor-close">
            ✕
          </button>
        </div>

        {final && winner && (
          <section className="turn-summary-section standings-verdict">
            <div className={`standings-verdict-title ${playerWon ? 'won' : ''}`}>
              {playerWon ? 'Victory!' : `${winner.name} wins the century`}
            </div>
            <div className="standings-verdict-sub">
              <span className={`fi fi-${winner.flagCode}`} /> {winner.name} won {winner.categoriesWon} of 3 categories.
              {player && !playerWon && ` ${player.name} won ${player.categoriesWon}.`}
            </div>
          </section>
        )}

        {!final && (
          <section className="turn-summary-section standings-note">
            The game ends on January 1, 2126. Whoever leads the most categories then wins.
          </section>
        )}

        <div className="standings-scroll">
          {VICTORY_CATEGORIES.map((cat) => {
            const ranked = standings.byCategory[cat.id]
            const top = ranked.slice(0, TOP_N)
            const playerOutsideTop = player && player.ranks[cat.id] > TOP_N
            return (
              <section key={cat.id} className="turn-summary-section">
                <h4>
                  {cat.title} <span className="standings-desc">· {cat.description}</span>
                </h4>
                <ol className="standings-list">
                  {top.map((s) => (
                    <StandingRow key={s.entityId} standing={s} rank={s.ranks[cat.id]} category={cat.id} isPlayer={s.entityId === playerId} />
                  ))}
                  {playerOutsideTop && (
                    <>
                      <li className="standings-gap">⋯</li>
                      <StandingRow standing={player} rank={player.ranks[cat.id]} category={cat.id} isPlayer />
                    </>
                  )}
                </ol>
              </section>
            )
          })}
        </div>

        {final ? (
          <button className="primary turn-summary-continue" onClick={returnToMenu}>
            Return to Menu
          </button>
        ) : (
          <button className="primary turn-summary-continue" onClick={toggle}>
            Close
          </button>
        )}
      </div>
    </div>
  )
}

function StandingRow({ standing, rank, category, isPlayer }: { standing: CountryStanding; rank: number; category: VictoryCategory; isPlayer: boolean }) {
  return (
    <li className={`standings-row ${isPlayer ? 'is-player' : ''}`}>
      <span className="standings-rank">{rank}</span>
      <span className="color-swatch" style={{ background: standing.mapColor }} />
      <span className={`fi fi-${standing.flagCode}`} />
      <span className="standings-name">{standing.name}</span>
      <span className="standings-value">{formatValue(category, standing)}</span>
    </li>
  )
}
