import { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import DebateSetup from './components/DebateSetup';
import DebateView from './components/DebateView';
import { api } from './api';
import './App.css';

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeJobId, setActiveJobId] = useState(null);
  const pollingRef = useRef(null);
  
  const [activeMode, setActiveMode] = useState('council');
  const [isDebating, setIsDebating] = useState(false);
  const [debateState, setDebateState] = useState(null);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
    }
    
    // Cleanup polling when switching conversations
    return () => {
      if (pollingRef.current) {
        pollingRef.current = false;
      }
    };
  }, [currentConversationId]);

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  // Helper to create an assistant message from job state
  const createAssistantMessageFromJob = useCallback((job) => {
    const statusToLoading = {
      'pending': { stage1: false, stage2: false, stage3: false },
      'stage1_running': { stage1: true, stage2: false, stage3: false },
      'stage1_complete': { stage1: false, stage2: false, stage3: false },
      'stage2_running': { stage1: false, stage2: true, stage3: false },
      'stage2_complete': { stage1: false, stage2: false, stage3: false },
      'stage3_running': { stage1: false, stage2: false, stage3: true },
      'complete': { stage1: false, stage2: false, stage3: false },
      'error': { stage1: false, stage2: false, stage3: false },
    };

    return {
      role: 'assistant',
      stage1: job.stage1,
      stage2: job.stage2,
      stage3: job.stage3,
      metadata: job.metadata,
      loading: statusToLoading[job.status] || { stage1: false, stage2: false, stage3: false },
      progress: job.progress,  // Include progress info (which models responded)
    };
  }, []);

  // Poll for job updates
  const pollJobUpdates = useCallback(async (jobId, conversationId) => {
    pollingRef.current = true;
    setActiveJobId(jobId);
    
    while (pollingRef.current) {
      try {
        const job = await api.getJob(jobId);
        
        // Update the assistant message with current job state
        setCurrentConversation((prev) => {
          if (!prev || prev.id !== conversationId) return prev;
          
          const messages = [...prev.messages];
          const lastMsg = messages[messages.length - 1];
          
          // Only update if the last message is an assistant message (in-progress)
          if (lastMsg && lastMsg.role === 'assistant') {
            messages[messages.length - 1] = createAssistantMessageFromJob(job);
          }
          
          return { ...prev, messages };
        });
        
        // Check if job is complete or errored
        if (job.status === 'complete' || job.status === 'error') {
          pollingRef.current = false;
          setActiveJobId(null);
          setIsLoading(false);
          loadConversations(); // Refresh to get updated title
          
          // Reload conversation to get the saved message from storage
          if (job.status === 'complete') {
            const conv = await api.getConversation(conversationId);
            setCurrentConversation(conv);
          }
          break;
        }
        
        // Poll every 300ms
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        console.error('Error polling job:', error);
        pollingRef.current = false;
        setActiveJobId(null);
        setIsLoading(false);
        break;
      }
    }
  }, [createAssistantMessageFromJob]);

  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);
      
      // Check if there's a pending job for this conversation
      if (conv.pending_job) {
        const job = conv.pending_job;
        
        // Add the in-progress assistant message to the UI
        const assistantMessage = createAssistantMessageFromJob(job);
        conv.messages = [...conv.messages, assistantMessage];
        
        setCurrentConversation(conv);
        setIsLoading(true);
        
        // Start polling for updates
        pollJobUpdates(job.id, id);
      } else {
        setCurrentConversation(conv);
      }
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const handleNewConversation = async () => {
    try {
      const newConv = await api.createConversation();
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, message_count: 0 },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleSelectConversation = (id) => {
    setCurrentConversationId(id);
  };

  const handleModeChange = (mode) => {
    setActiveMode(mode);
    if (mode === 'debate') {
      setDebateState(null);
      setIsDebating(false);
    }
  };

  const handleStartDebate = async ({ topic, models, maxTurns, roles }) => {
    setIsDebating(true);
    setDebateState({
      topic,
      participants: [],
      phase: null,
      turns: [],
      currentSpeaker: null,
      summary: null,
      moderatorDecision: null,
    });

    try {
      await api.startDebateStream(topic, models, maxTurns, roles, (event) => {
        switch (event.type) {
          case 'debate_start':
            setDebateState((prev) => ({
              ...prev,
              topic: event.topic,
              participants: event.participants,
            }));
            break;

          case 'phase':
            setDebateState((prev) => ({
              ...prev,
              phase: event.phase,
            }));
            break;

          case 'speaker_start':
            setDebateState((prev) => ({
              ...prev,
              currentSpeaker: event.model,
            }));
            break;

          case 'speaker_complete':
            setDebateState((prev) => ({
              ...prev,
              currentSpeaker: null,
              turns: [
                ...prev.turns,
                {
                  model: event.model,
                  name: event.name,
                  content: event.content,
                  turn_type: event.turn_type,
                },
              ],
            }));
            break;

          case 'moderator_decision':
            setDebateState((prev) => ({
              ...prev,
              moderatorDecision: event.decision,
            }));
            break;

          case 'summary_start':
            setDebateState((prev) => ({
              ...prev,
              currentSpeaker: 'moderator',
            }));
            break;

          case 'summary_complete':
            setDebateState((prev) => ({
              ...prev,
              currentSpeaker: null,
              summary: event.summary,
            }));
            break;

          case 'debate_complete':
            setIsDebating(false);
            break;

          case 'error':
            console.error('Debate error:', event.message);
            setIsDebating(false);
            alert('Debate error: ' + event.message);
            break;

          default:
            console.log('Unknown debate event:', event);
        }
      });
    } catch (error) {
      console.error('Failed to start debate:', error);
      setIsDebating(false);
      alert('Failed to start debate: ' + error.message);
    }
  };

  const handleDeleteConversation = async (conversationId) => {
    try {
      await api.deleteConversation(conversationId);
      
      // If the deleted conversation was the current one, clear it
      if (conversationId === currentConversationId) {
        setCurrentConversationId(null);
        setCurrentConversation(null);
      }
      
      // Reload conversations list
      loadConversations();
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      alert('Failed to delete conversation. Please try again.');
    }
  };

  const handleSendMessage = async (content) => {
    if (!currentConversationId) {
      console.error('[App] No conversation selected!');
      return;
    }

    console.log('[App] ========================================');
    console.log('[App] Sending message:', content.slice(0, 100));
    console.log('[App] Conversation ID:', currentConversationId);
    
    setIsLoading(true);
    try {
      // Optimistically add user message to UI
      const userMessage = { role: 'user', content };
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
      }));

      // Create a partial assistant message that will be updated progressively
      const assistantMessage = {
        role: 'assistant',
        stage1: null,
        stage2: null,
        stage3: null,
        metadata: null,
        loading: {
          stage1: false,
          stage2: false,
          stage3: false,
        },
      };

      // Add the partial assistant message
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
      }));

      // Send message with streaming - the backend now runs the job independently
      let jobId = null;
      
      console.log('[App] Calling sendMessageStream...');
      await api.sendMessageStream(currentConversationId, content, (eventType, event) => {
        console.log(`[App] Received event: ${eventType}`);
        switch (eventType) {
          case 'job_started':
            // Store the job ID so we can resume polling if needed
            jobId = event.job_id;
            console.log(`[App] Job started with ID: ${jobId}`);
            setActiveJobId(jobId);
            break;
            
          case 'stage1_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage1 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage1_progress':
            // Update progress with streaming model content
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.progress = event.progress;
              lastMsg.loading.stage1 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage1_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage1 = event.data;
              lastMsg.loading.stage1 = false;
              return { ...prev, messages };
            });
            break;

          case 'stage2_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage2 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage2_progress':
            // Update progress with streaming model content for stage 2
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.progress = event.progress;
              lastMsg.loading.stage2 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage2_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage2 = event.data;
              lastMsg.metadata = event.metadata;
              lastMsg.loading.stage2 = false;
              return { ...prev, messages };
            });
            break;

          case 'stage3_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage3 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage3_progress':
            // Update progress with streaming content for stage 3
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.progress = event.progress;
              lastMsg.loading.stage3 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage3_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage3 = event.data;
              lastMsg.loading.stage3 = false;
              return { ...prev, messages };
            });
            break;

          case 'title_complete':
            // Reload conversations to get updated title
            loadConversations();
            break;

          case 'complete':
            // Stream complete, reload conversations list
            console.log('[App] ✓ Council process complete!');
            loadConversations();
            setActiveJobId(null);
            setIsLoading(false);
            break;

          case 'error':
            console.error('[App] ✗ Stream error:', event.message);
            setActiveJobId(null);
            setIsLoading(false);
            break;

          default:
            console.log('[App] Unknown event type:', eventType);
        }
      });
      console.log('[App] sendMessageStream completed');
    } catch (error) {
      console.error('[App] ✗ Failed to send message:', error);
      // Remove optimistic messages on error
      setCurrentConversation((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -2),
      }));
      setActiveJobId(null);
      setIsLoading(false);
    }
  };

  const handleCancelJob = async (jobId) => {
    console.log('[App] Cancelling job:', jobId);
    try {
      await api.cancelJob(jobId);
      console.log('[App] Job cancelled successfully');
      // Remove the pending assistant message
      setCurrentConversation((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -1),
      }));
      setActiveJobId(null);
      setIsLoading(false);
    } catch (error) {
      console.error('[App] Failed to cancel job:', error);
    }
  };

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        activeMode={activeMode}
        onModeChange={handleModeChange}
      />
      {activeMode === 'council' ? (
        <ChatInterface
          conversation={currentConversation}
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
          activeJobId={activeJobId}
          onCancelJob={handleCancelJob}
        />
      ) : (
        <div className="debate-container">
          {!debateState || (!isDebating && debateState.turns.length === 0) ? (
            <DebateSetup
              onStartDebate={handleStartDebate}
              isDebating={isDebating}
            />
          ) : (
            <DebateView
              debateState={debateState}
              isDebating={isDebating}
            />
          )}
          {debateState && debateState.turns.length > 0 && !isDebating && (
            <button
              className="new-debate-btn"
              onClick={() => {
                setDebateState(null);
                setIsDebating(false);
              }}
            >
              Start New Debate
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
