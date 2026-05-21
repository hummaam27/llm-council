import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import CostBadge from './CostBadge';
import './DebateView.css';

export default function DebateView({
  debateState,
  isDebating,
  onStop,
}) {
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [debateState]);

  if (!debateState) {
    return null;
  }

  const { topic, participants, phase, turns, currentSpeaker, summary, moderatorDecision, totalCost, stopReason } = debateState;

  const stopReasonText = {
    cost_limit: 'Debate ended — cost limit reached',
    max_rounds: 'Debate ended — round limit reached',
    concluded: 'Debate ended — the moderator concluded the discussion',
  };

  return (
    <div className="debate-view">
      {isDebating && (
        <button className="run-stop-btn" onClick={onStop}>
          Stop Debate
        </button>
      )}
      {/* Debate Header */}
      <div className="debate-header">
        <div className="debate-topic">
          <span className="topic-label">Debate Topic</span>
          <h2>{topic}</h2>
        </div>
        <div className="debate-cost">
          <CostBadge total={totalCost || 0} />
        </div>
        {participants && participants.length > 0 && (
          <div className="debate-participants">
            <span className="participants-label">Panelists</span>
            <div className="participant-chips">
              {participants.map((p) => (
                <span
                  key={p.id}
                  className={`participant-chip ${currentSpeaker === p.id ? 'speaking' : ''}`}
                >
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Phase Indicator */}
      {phase && (
        <div className="debate-phase">
          <span className={`phase-badge ${phase}`}>
            {phase === 'opening_statements' && 'Opening Statements'}
            {phase === 'discussion' && 'Discussion'}
            {phase === 'conclusion' && 'Conclusion'}
          </span>
        </div>
      )}

      {/* Debate Turns */}
      <div className="debate-turns">
        {turns && turns.map((turn, index) => (
          <div
            key={index}
            className={`debate-turn ${turn.turn_type} ${turn.isStreaming ? 'streaming' : ''}`}
          >
            <div className="turn-header">
              <div className="speaker-avatar">
                {turn.name?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <span className="speaker-name">{turn.name}</span>
              <span className={`turn-type-badge ${turn.turn_type}`}>
                {turn.turn_type === 'opening' && 'Opening'}
                {turn.turn_type === 'discussion' && 'Response'}
                {turn.turn_type === 'summary' && 'Summary'}
              </span>
            </div>
            <div className="speech-bubble">
              <div className="turn-content">
                <ReactMarkdown>{turn.content}</ReactMarkdown>
              </div>
            </div>
          </div>
        ))}

        {/* Current Speaker Indicator */}
        {isDebating && currentSpeaker && (
          <div className="current-speaker-indicator">
            <div className="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <span className="speaker-typing">
              {participants?.find(p => p.id === currentSpeaker)?.name || 'Someone'} is speaking...
            </span>
          </div>
        )}

        {/* Moderator Decision */}
        {moderatorDecision && !moderatorDecision.continue && (
          <div className="moderator-note">
            <span>Moderator: {moderatorDecision.reason || 'The discussion has reached its conclusion.'}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Summary Section */}
      {summary && (
        <div className="debate-summary">
          <div className="summary-header">
            <h3>Moderator's Summary</h3>
          </div>
          <div className="summary-content">
            <ReactMarkdown>{summary}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Debate Status */}
      {isDebating && (
        <div className="debate-status">
          <div className="status-pulse"></div>
          <span>Debate in progress...</span>
        </div>
      )}
      {!isDebating && stopReason && (
        <div className="debate-status debate-status-done">
          <span>{stopReasonText[stopReason] || 'Debate ended'}</span>
        </div>
      )}
    </div>
  );
}
