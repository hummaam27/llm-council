import { useState, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import './Stage3Streaming.css';

export default function Stage3Streaming({ stream }) {
  const [panelHeight, setPanelHeight] = useState(300);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  const handleMouseDown = useCallback((e) => {
    isDragging.current = true;
    startY.current = e.clientY;
    startHeight.current = panelHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    
    const handleMouseMove = (e) => {
      if (!isDragging.current) return;
      const delta = e.clientY - startY.current;
      const newHeight = Math.max(150, Math.min(800, startHeight.current + delta));
      setPanelHeight(newHeight);
    };
    
    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [panelHeight]);

  if (!stream) {
    return null;
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'streaming':
        return '⏳';
      case 'complete':
        return '✓';
      case 'failed':
        return '✗';
      default:
        return '○';
    }
  };

  const getStatusClass = (status) => {
    switch (status) {
      case 'streaming':
        return 'status-streaming';
      case 'complete':
        return 'status-complete';
      case 'failed':
        return 'status-failed';
      default:
        return '';
    }
  };

  const getModelShortName = (model) => {
    if (!model) return 'Chairman';
    const parts = model.split('/');
    return parts[parts.length - 1];
  };

  return (
    <div className="stage3-streaming">
      <div className="streaming-header">
        <h3>Stage 3: Final Synthesis</h3>
        <div className="streaming-actions">
          <div className="streaming-summary">
            Chairman: {getModelShortName(stream.model)}
          </div>
        </div>
      </div>

      <div className="model-content" style={{ height: `${panelHeight}px` }}>
        <div className="stream-panel">
          <div className="stream-header">
            <span className="model-name">{stream.model || 'Chairman'}</span>
            <div className="stream-header-right">
              <span className={`stream-status ${getStatusClass(stream.status)}`}>
                {stream.status === 'streaming' && (
                  <>
                    <span className="pulse-dot"></span>
                    Synthesizing...
                  </>
                )}
                {stream.status === 'complete' && 'Complete'}
                {stream.status === 'failed' && 'Failed'}
                {stream.status === 'pending' && 'Waiting...'}
              </span>
              {stream.char_count > 0 && (
                <span className="char-count">
                  {(stream.char_count / 1000).toFixed(1)}k chars
                </span>
              )}
            </div>
          </div>
          <div className="stream-content">
            {stream.content ? (
              <ReactMarkdown>{stream.content}</ReactMarkdown>
            ) : (
              <div className="waiting-message">
                {stream.status === 'failed' 
                  ? 'Chairman failed to respond'
                  : 'Waiting for synthesis...'}
              </div>
            )}
          </div>
          {stream.status === 'streaming' && (
            <div className="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div 
        className="resize-handle"
        onMouseDown={handleMouseDown}
        title="Drag to resize"
      >
        <div className="resize-grip"></div>
      </div>
    </div>
  );
}
