import { useEffect, useRef } from 'react';
import CostBadge from './CostBadge';
import { createSandboxGame } from '../game/SandboxScene';
import './SandboxView.css';

function actionLabel(event) {
  const at = event.place ? ` at ${event.place}` : '';
  switch (event.action) {
    case 'move':
      return `${event.name} traveled to ${event.place || 'a new spot'}`;
    case 'talk':
      return `${event.name} → ${event.target_name}: "${event.dialogue}"`;
    case 'act':
      return `${event.name} — ${event.activity || 'did something'}${at}`;
    case 'work':
      return `${event.name} worked — now holds ${event.coins} coins`;
    case 'give':
      return `${event.name} gave ${event.amount} coins to ${event.target_name}`;
    case 'think':
      return `${event.name} thought: ${event.thought || '...'}`;
    default:
      return `${event.name} observed: ${event.thought || 'the surroundings'}`;
  }
}

export default function SandboxView({ sandboxState, isSimulating, onStop }) {
  const mountRef = useRef(null);
  const gameRef = useRef(null);
  // Shared channel between React and the Phaser scene.
  const channelRef = useRef({ state: null, scene: null });
  const logRef = useRef(null);

  // Create the Phaser game once.
  useEffect(() => {
    if (!mountRef.current || gameRef.current) return;
    gameRef.current = createSandboxGame(mountRef.current, channelRef.current);
    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
      channelRef.current = { state: null, scene: null };
    };
  }, []);

  // Push state into the scene whenever it changes.
  useEffect(() => {
    const channel = channelRef.current;
    channel.state = sandboxState;
    channel.scene?.syncState(sandboxState);
  }, [sandboxState]);

  // Auto-scroll the activity log.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [sandboxState?.events?.length]);

  if (!sandboxState) return null;

  const events = sandboxState.events || [];

  return (
    <div className="sandbox-view">
      {isSimulating && (
        <button className="run-stop-btn" onClick={onStop}>
          Stop Simulation
        </button>
      )}
      <div className="sandbox-canvas-panel">
        <div className="sandbox-status">
          {isSimulating ? (
            <span className="sandbox-running">
              <span className="pulse-dot"></span>
              Tick {(sandboxState.tick ?? 0) + 1} / {sandboxState.maxTicks || '?'}
            </span>
          ) : (
            <span className="sandbox-done">
              ✓ Simulation complete — {events.length} actions over{' '}
              {sandboxState.maxTicks || 0} ticks
            </span>
          )}
          <span className="treasury-badge">
            Treasury: {sandboxState.treasury ?? 0} coins
          </span>
          <CostBadge total={sandboxState.totalCost || 0} />
        </div>

        <div ref={mountRef} className="sandbox-game" />

        <div className="sandbox-legend">
          {(sandboxState.agents || []).map((a) => (
            <span key={a.id} className="legend-item">
              <span className="legend-dot" style={{ background: a.color }}></span>
              {a.name}
            </span>
          ))}
        </div>
        <div className="sandbox-hint">scroll to zoom · drag to pan</div>
      </div>

      <div className="sandbox-log-panel">
        {sandboxState.standings && (
          <div className="sandbox-standings">
            <h3>Final Standings</h3>
            {sandboxState.standings.map((s, i) => (
              <div key={s.id} className="standing-row">
                <span className="standing-rank">{i + 1}</span>
                <span className="standing-name">{s.name}</span>
                <span className="standing-coins">{s.coins} coins</span>
              </div>
            ))}
          </div>
        )}
        <h3>Activity Log</h3>
        <div className="sandbox-log" ref={logRef}>
          {events.length === 0 ? (
            <div className="log-empty">Waiting for the simulation to begin…</div>
          ) : (
            events.map((e, i) => (
              <div key={i} className={`log-entry log-${e.action}`}>
                <span className="log-tick">T{e.tick + 1}</span>
                <span className="log-text">{actionLabel(e)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
