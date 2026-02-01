import { useState, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import './Stage1Streaming.css';

export default function Stage1Streaming({ modelStreams, isLoading }) {
  const models = Object.keys(modelStreams || {});
  const [activeTab, setActiveTab] = useState(models[0] || null);
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

  if (!modelStreams || models.length === 0) {
    return null;
  }

  // Update active tab if it doesn't exist
  if (activeTab && !models.includes(activeTab)) {
    setActiveTab(models[0]);
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
    // Extract just the model name without provider
    const parts = model.split('/');
    return parts[parts.length - 1];
  };

  return (
    <div className="stage1-streaming">
      <div className="streaming-header">
        <h3>Stage 1: Individual Responses</h3>
        <div className="streaming-summary">
          {models.filter(m => modelStreams[m]?.status === 'complete').length} / {models.length} complete
        </div>
      </div>

      <div className="model-tabs">
        {models.map((model) => {
          const stream = modelStreams[model];
          const isActive = activeTab === model;
          return (
            <button
              key={model}
              className={`model-tab ${isActive ? 'active' : ''} ${getStatusClass(stream?.status)}`}
              onClick={() => setActiveTab(model)}
            >
              <span className="tab-status">{getStatusIcon(stream?.status)}</span>
              <span className="tab-name">{getModelShortName(model)}</span>
              <span className="tab-chars">
                {stream?.char_count ? `${(stream.char_count / 1000).toFixed(1)}k` : '0'}
              </span>
            </button>
          );
        })}
      </div>

      <div className="model-content" style={{ height: `${panelHeight}px` }}>
        {activeTab && modelStreams[activeTab] && (
          <div className="stream-panel">
            <div className="stream-header">
              <span className="model-name">{activeTab}</span>
              <span className={`stream-status ${getStatusClass(modelStreams[activeTab]?.status)}`}>
                {modelStreams[activeTab]?.status === 'streaming' && (
                  <>
                    <span className="pulse-dot"></span>
                    Generating...
                  </>
                )}
                {modelStreams[activeTab]?.status === 'complete' && 'Complete'}
                {modelStreams[activeTab]?.status === 'failed' && 'Failed'}
              </span>
            </div>
            <div className="stream-content">
              {modelStreams[activeTab]?.content ? (
                <ReactMarkdown>{modelStreams[activeTab].content}</ReactMarkdown>
              ) : (
                <div className="waiting-message">
                  {modelStreams[activeTab]?.status === 'failed' 
                    ? 'Model failed to respond'
                    : 'Waiting for response...'}
                </div>
              )}
            </div>
            {modelStreams[activeTab]?.status === 'streaming' && (
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            )}
          </div>
        )}
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
