import { useMemo, useState } from 'react'
import { useGameStore } from '@/state/gameStore'
import { adviseCountry } from '@/igpt/igpt'
import { ACT_THRESHOLD, type IgptDecision } from '@/igpt/brain'
import { doctrineFor } from '@/igpt/doctrines'
import { learnedBias } from '@/igpt/memory'
import { formatShortGameDate, isGameOver } from '@/simulation/gameDate'
import type { IgptMove } from '@/domain/schemas'

const MOVE_LABELS: Record<IgptMove, string> = {
  declare_war: 'Declaring war',
  propose_peace: 'Making peace',
  sanction: 'Sanctions',
  lift_sanction: 'Lifting sanctions',
  improve_relations: 'Diplomacy',
  form_alliance: 'Alliances',
  sign_trade: 'Trade deals',
  send_aid: 'Foreign aid',
  raise_military: 'Military build-up',
  cut_military: 'Military cuts',
  raise_taxes: 'Tax rises',
  cut_taxes: 'Tax cuts',
  research: 'Research',
  build_army: 'Arms purchases',
  mobilize: 'Mobilizing',
  demobilize: 'Demobilizing',
}

/** IGPT: the game's built-in decision engine. Suggests moves for the player's
 *  country (with the reasoning behind each), can take over as autopilot, and
 *  shows what it has been deciding for every other country. Runs locally --
 *  no model download, no network, no tokens. */
export function IgptPanel() {
  const open = useGameStore((s) => s.igptOpen)
  const toggle = useGameStore((s) => s.toggleIgpt)
  const worldState = useGameStore((s) => s.worldState)
  const busy = useGameStore((s) => s.busy)
  const execute = useGameStore((s) => s.executeIgptSuggestion)
  const setAutopilot = useGameStore((s) => s.setIgptAutopilot)
  const [tab, setTab] = useState<'advice' | 'world' | 'learned'>('advice')

  const advice = useMemo(() => (open && worldState ? adviseCountry(worldState, worldState.playerEntityId) : []), [open, worldState])
  if (!open || !worldState) return null

  const player = worldState.entities[worldState.playerEntityId]
  const doctrine = doctrineFor(player)
  const autopilot = worldState.igpt.autopilot
  const gameOver = isGameOver(worldState.turn)
  const name = (id: string | null) => (id ? (worldState.entities[id]?.name ?? id) : '')

  return (
    <div className="advisor-overlay">
      <div className="advisor-panel igpt-panel">
        <div className="advisor-header">
          <strong>IGPT</strong>
          <span className="advisor-readonly-tag">local · no tokens</span>
          <button onClick={toggle} className="advisor-close">
            ✕
          </button>
        </div>

        <div className="igpt-doctrine">
          <div className="igpt-doctrine-title">
            <span className={`fi fi-${player.flagCode}`} /> {player.name} doctrine
          </div>
          <div className="igpt-doctrine-summary">{doctrine.summary}</div>
          <label className="igpt-autopilot">
            <input type="checkbox" checked={autopilot} disabled={busy || gameOver} onChange={(e) => setAutopilot(e.target.checked)} />
            Autopilot: let IGPT run {player.name} as turns advance
          </label>
        </div>

        <div className="igpt-tabs">
          <button className={tab === 'advice' ? 'active' : ''} onClick={() => setTab('advice')}>
            Advice
          </button>
          <button className={tab === 'world' ? 'active' : ''} onClick={() => setTab('world')}>
            World decisions
          </button>
          <button className={tab === 'learned' ? 'active' : ''} onClick={() => setTab('learned')}>
            Learned
          </button>
        </div>

        <div className="igpt-body">
          {tab === 'advice' && (
            <>
              {advice.length === 0 && <div className="igpt-empty">IGPT has no moves to suggest right now.</div>}
              {advice.map((d) => (
                <SuggestionCard key={`${d.move}:${d.targetId}`} decision={d} disabled={busy || gameOver || autopilot} onExecute={() => execute(d.action, d.summary)} />
              ))}
              {autopilot && <div className="igpt-empty">Autopilot is on. IGPT makes these calls itself when the turn advances.</div>}
              {worldState.igpt.playerLog.length > 0 && (
                <>
                  <h4 className="igpt-subhead">Decided for {player.name} on autopilot</h4>
                  <ul className="igpt-feed">
                    {[...worldState.igpt.playerLog].reverse().slice(0, 15).map((e, i) => (
                      <li key={`${e.turn}-${i}`}>
                        <div className="igpt-feed-head">
                          <span className="turn-summary-date">{formatShortGameDate(e.turn)}</span>
                          {e.summary.replace(/^[^:]+: /, '')}
                        </div>
                        <div className="igpt-feed-why">{e.reasons[0]}</div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}

          {tab === 'world' && (
            <ul className="igpt-feed">
              {worldState.igpt.log.length === 0 && <li className="igpt-empty">No decisions yet. End a turn to see the world move.</li>}
              {[...worldState.igpt.log].reverse().slice(0, 40).map((e, i) => (
                <li key={`${e.turn}-${i}`}>
                  <div className="igpt-feed-head">
                    <span className="turn-summary-date">{formatShortGameDate(e.turn)}</span>
                    <span className={`fi fi-${worldState.entities[e.actorId]?.flagCode ?? ''}`} /> {e.summary}
                  </div>
                  <div className="igpt-feed-why">{e.reasons[0]}</div>
                </li>
              ))}
            </ul>
          )}

          {tab === 'learned' && (
            <>
              <p className="igpt-note">
                IGPT judges every decision about 3 months later, by how the country's standing in the three victory races changed compared to the rest of the world. What worked
                gets favored; what backfired gets avoided. This is {name(player.id)}'s experience, blended with every country's:
              </p>
              <ul className="igpt-learned">
                {(Object.keys(MOVE_LABELS) as IgptMove[]).map((move) => {
                  const bias = learnedBias(worldState, player.id, move)
                  const own = worldState.igpt.memory[player.id]?.moves[move]?.n ?? 0
                  const world = worldState.igpt.global[move]?.n ?? 0
                  if (own === 0 && world === 0) return null
                  return (
                    <li key={move}>
                      <span className="igpt-learned-name">{MOVE_LABELS[move]}</span>
                      <span className="igpt-meter">
                        <span className={`igpt-meter-fill ${bias >= 0 ? 'pos' : 'neg'}`} style={{ width: `${Math.min(100, (Math.abs(bias) / 0.3) * 50)}%`, [bias >= 0 ? 'left' : 'right']: '50%' }} />
                      </span>
                      <span className="igpt-learned-n">
                        {own} / {world}
                      </span>
                    </li>
                  )
                })}
              </ul>
              <p className="igpt-note">Counts: decisions judged for {player.name} / world-wide.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SuggestionCard({ decision, disabled, onExecute }: { decision: IgptDecision; disabled: boolean; onExecute: () => void }) {
  const recommended = decision.score >= ACT_THRESHOLD
  const confidence = Math.max(0, Math.min(1, decision.score))
  return (
    <div className={`igpt-card ${recommended ? 'recommended' : ''}`}>
      <div className="igpt-card-head">
        <strong>{decision.summary}</strong>
        <button className={recommended ? 'primary' : ''} disabled={disabled} onClick={onExecute}>
          Do it
        </button>
      </div>
      <div className="igpt-score">
        <span className="igpt-score-bar">
          <span style={{ width: `${confidence * 100}%` }} />
        </span>
        <span className="igpt-score-label">{recommended ? 'Recommended' : 'Worth considering'}</span>
      </div>
      <ul className="igpt-reasons">
        {decision.reasons.slice(0, 4).map((r, i) => (
          <li key={i} className={r.startsWith('Caution') || r.includes('backfired') ? 'neg' : ''}>
            {r}
          </li>
        ))}
      </ul>
    </div>
  )
}
