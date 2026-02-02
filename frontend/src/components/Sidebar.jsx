import { useState, useEffect } from 'react';
import './Sidebar.css';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  activeMode,
  onModeChange,
}) {
  const handleDelete = (e, convId) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this conversation?')) {
      onDeleteConversation(convId);
    }
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>LLM Council</h1>
        <button className="new-conversation-btn" onClick={onNewConversation}>
          + New
        </button>
      </div>

      <div className="mode-switcher">
        <button
          className={`mode-btn ${activeMode === 'council' ? 'active' : ''}`}
          onClick={() => onModeChange('council')}
        >
          🏛️ Council
        </button>
        <button
          className={`mode-btn ${activeMode === 'debate' ? 'active' : ''}`}
          onClick={() => onModeChange('debate')}
        >
          ⚔️ Debate
        </button>
      </div>

      <div className="conversation-list">
        {conversations.length === 0 ? (
          <div className="no-conversations">No conversations yet</div>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item ${
                conv.id === currentConversationId ? 'active' : ''
              }`}
              onClick={() => onSelectConversation(conv.id)}
            >
              <div className="conversation-content">
                <div className="conversation-title">
                  {conv.title || 'New Conversation'}
                </div>
                <div className="conversation-meta">
                  {conv.message_count} messages
                </div>
              </div>
              <button
                className="delete-conversation-btn"
                onClick={(e) => handleDelete(e, conv.id)}
                title="Delete conversation"
              >
                🗑️
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
