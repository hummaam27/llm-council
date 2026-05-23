import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import CostBadge from './CostBadge';
import SourceList from './SourceList';
import './DebateView.css';

export default function DebateView({
  debateState,
  isDebating,
  onStop,
  onInterject,
  onPause,
  onResume,
  onNewDebate,
}) {
  const messagesEndRef = useRef(null);
  const [interjectionText, setInterjectionText] = useState('');
  const [interjectionPending, setInterjectionPending] = useState(false);

  const sendInterjection = async () => {
    const text = interjectionText.trim();
    if (!text || !onInterject || interjectionPending) return;
    setInterjectionPending(true);
    try {
      await onInterject(text);
      setInterjectionText('');
    } finally {
      setInterjectionPending(false);
    }
  };

  const handleInterjectKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendInterjection();
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [debateState]);

  if (!debateState) {
    return null;
  }

  const { topic, participants, phase, turns, currentSpeaker, summary, moderatorDecision, totalCost, stopReason, moderatorName, moderatorModel, summaryStreaming } = debateState;

  // Per-panelist color palette. Earthy, desaturated, editorial — designed to sit
  // alongside the burnt-orange brand color without competing with it. Avoid bright
  // primaries; everything here is muted enough that the orange (user voice) still
  // reads as the focal accent. Order matches the participants list.
  const SPEAKER_PALETTE = [
    '#5e7a4a',  // moss green
    '#4a6f8e',  // slate blue
    '#6b4a63',  // plum
    '#8e6c2e',  // ochre (darkened from #b08c3e so white text hits WCAG AA on colored bubbles)
    '#2c6b6b',  // deep teal
    '#8a5a4a',  // umber (sibling to brand orange, doesn't clash)
  ];
  const colorByModel = {};
  (participants || []).forEach((p, i) => {
    colorByModel[p.id] = SPEAKER_PALETTE[i % SPEAKER_PALETTE.length];
  });
  const USER_COLOR = '#d2694a';
  const getSpeakerColor = (modelId) => modelId === 'user' ? USER_COLOR : (colorByModel[modelId] || '#64748b');

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
              {participants.map((p) => {
                const c = colorByModel[p.id];
                const isSpeaking = currentSpeaker === p.id;
                return (
                  <span
                    key={p.id}
                    className={`participant-chip ${isSpeaking ? 'speaking' : ''}`}
                    style={c ? {
                      background: isSpeaking ? c : undefined,
                      color: isSpeaking ? 'white' : undefined,
                      borderLeft: `3px solid ${c}`,
                    } : undefined}
                  >
                    {p.name}
                  </span>
                );
              })}
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
        {turns && turns.map((turn, index) => {
          const color = getSpeakerColor(turn.model);
          const isUser = turn.turn_type === 'user_interjection' || turn.model === 'user';
          return (
            <div
              key={index}
              className={`debate-turn ${turn.turn_type} ${turn.isStreaming ? 'streaming' : ''} ${isUser ? 'is-user' : 'is-panelist'}`}
              style={{ '--speaker-color': color }}
            >
              <div className="turn-header">
                <div className="speaker-avatar" style={{ background: color }}>
                  {turn.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <span className="speaker-name" style={{ color }}>{turn.name}</span>
                <span className={`turn-type-badge ${turn.turn_type}`}>
                  {turn.turn_type === 'opening' && 'Opening'}
                  {turn.turn_type === 'discussion' && 'Response'}
                  {turn.turn_type === 'summary' && 'Summary'}
                  {turn.turn_type === 'user_interjection' && 'You'}
                </span>
              </div>
              <div className="speech-bubble">
                <div className="turn-content">
                  {turn.isStreaming && !turn.content ? (
                    <div className="typing-indicator inline">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  ) : (
                    <ReactMarkdown>{turn.content}</ReactMarkdown>
                  )}
                </div>
                <SourceList annotations={turn.annotations} />
              </div>
            </div>
          );
        })}

        {/* Moderator Decision */}
        {moderatorDecision && !moderatorDecision.continue && (
          <div className="moderator-note">
            <span>Moderator: {moderatorDecision.reason || 'The discussion has reached its conclusion.'}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Summary Section */}
      {(summary || summaryStreaming) && (
        <div className={`debate-summary ${summaryStreaming ? 'streaming' : ''}`}>
          <div className="summary-header">
            <h3>Moderator's Summary</h3>
            {(moderatorName || moderatorModel) && (
              <span className="summary-author">
                by <strong>{moderatorName || moderatorModel}</strong>
                {moderatorModel && moderatorName && (
                  <span className="summary-author-id">  ({moderatorModel})</span>
                )}
                {summaryStreaming && <span className="summary-typing"> · writing…</span>}
              </span>
            )}
          </div>
          <div className="summary-content markdown-content">
            <ReactMarkdown>{summary || ''}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Debate Status — only shown when the debate has ended. While live, the
          Opening/Discussion phase badge at top and the raise-hand bar at bottom
          already communicate state; a third pulsing indicator in the middle is noise. */}
      {!isDebating && stopReason && (
        <div className="debate-status debate-status-done">
          <span>{stopReasonText[stopReason] || 'Debate ended'}</span>
        </div>
      )}

      {!isDebating && debateState?.turns?.length > 0 && onNewDebate && (
        <div className="debate-footer-actions">
          <button className="new-debate-btn-inline" onClick={onNewDebate}>
            Start New Debate
          </button>
        </div>
      )}

      {isDebating && onInterject && debateState?.debateId && (
        <div className={`debate-interject ${debateState?.isPaused ? 'paused' : ''}`}>
          <div className="interject-label">
            {debateState?.isPaused
              ? '✋ Hand raised — debate paused, take your time. Send or cancel when ready.'
              : 'Have something to add? Raise your hand to pause the debate while you compose.'}
          </div>
          <div className="interject-row">
            <textarea
              className="interject-input"
              rows={2}
              placeholder={debateState?.isPaused
                ? "Type your question, steer, or thought..."
                : "Click 'Raise Hand' to pause, or just type and hit Send..."}
              value={interjectionText}
              onChange={(e) => setInterjectionText(e.target.value)}
              onKeyDown={handleInterjectKeyDown}
              disabled={interjectionPending}
            />
            <div className="interject-actions">
              {!debateState?.isPaused && onPause && (
                <button
                  className="raise-hand-btn"
                  onClick={onPause}
                  disabled={interjectionPending}
                  title="Pause the debate while you type"
                >
                  🙋 Raise Hand
                </button>
              )}
              {debateState?.isPaused && onResume && (
                <button
                  className="cancel-hand-btn"
                  onClick={onResume}
                  disabled={interjectionPending}
                  title="Resume debate without sending"
                >
                  Cancel
                </button>
              )}
              <button
                className="interject-send"
                onClick={sendInterjection}
                disabled={interjectionPending || !interjectionText.trim()}
              >
                {interjectionPending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
