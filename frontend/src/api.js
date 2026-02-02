/**
 * API client for the LLM Council backend.
 */

const API_BASE = 'http://localhost:8001';

// Logging helper
const log = (category, message, data = null) => {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = `[${timestamp}] [API:${category}]`;
  if (data) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
};

export const api = {
  /**
   * List all conversations.
   */
  async listConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`);
    if (!response.ok) {
      throw new Error('Failed to list conversations');
    }
    return response.json();
  },

  /**
   * Create a new conversation.
   */
  async createConversation() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
  },

  /**
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`
    );
    if (!response.ok) {
      throw new Error('Failed to get conversation');
    }
    return response.json();
  },

  /**
   * Delete a conversation.
   */
  async deleteConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`,
      {
        method: 'DELETE',
      }
    );
    if (!response.ok) {
      throw new Error('Failed to delete conversation');
    }
    return response.json();
  },

  /**
   * Send a message in a conversation.
   */
  async sendMessage(conversationId, content) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to send message');
    }
    return response.json();
  },

  /**
   * Send a message and receive streaming updates.
   * @param {string} conversationId - The conversation ID
   * @param {string} content - The message content
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @returns {Promise<void>}
   */
  async sendMessageStream(conversationId, content, onEvent) {
    log('Stream', `Starting stream request for conversation ${conversationId.slice(0, 8)}...`);
    log('Stream', `Query: "${content.slice(0, 100)}${content.length > 100 ? '...' : ''}"`);
    
    let response;
    try {
      response = await fetch(
        `${API_BASE}/api/conversations/${conversationId}/message/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content }),
        }
      );
    } catch (fetchError) {
      log('Stream', `❌ FETCH FAILED - Is the backend running?`, fetchError);
      throw new Error(`Failed to connect to backend: ${fetchError.message}`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      log('Stream', `❌ HTTP ${response.status}: ${errorText}`);
      throw new Error(`Failed to send message: ${response.status} ${errorText}`);
    }

    log('Stream', `✓ Connection established, reading stream...`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        log('Stream', `Stream ended after ${eventCount} events`);
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            const event = JSON.parse(data);
            eventCount++;
            log('Stream', `← Event #${eventCount}: ${event.type}`, event.type === 'stage1_complete' || event.type === 'stage2_complete' || event.type === 'stage3_complete' ? `(${JSON.stringify(event).length} bytes)` : '');
            onEvent(event.type, event);
          } catch (e) {
            log('Stream', `❌ Failed to parse SSE event`, { error: e.message, data: data.slice(0, 200) });
          }
        }
      }
    }
    
    // Process any remaining data in buffer
    if (buffer.startsWith('data: ')) {
      const data = buffer.slice(6);
      try {
        const event = JSON.parse(data);
        eventCount++;
        log('Stream', `← Final Event #${eventCount}: ${event.type}`);
        onEvent(event.type, event);
      } catch (e) {
        // Ignore incomplete final chunk
      }
    }
    
    log('Stream', `✓ Stream processing complete (${eventCount} total events)`);
  },

  /**
   * Get available models from OpenRouter (filtered for OpenAI, Anthropic, Google).
   */
  async getOpenRouterModels() {
    const response = await fetch(`${API_BASE}/api/openrouter/models`);
    if (!response.ok) {
      throw new Error('Failed to fetch OpenRouter models');
    }
    return response.json();
  },

  /**
   * Get current council configuration.
   */
  async getCouncilConfig() {
    const response = await fetch(`${API_BASE}/api/council/config`);
    if (!response.ok) {
      throw new Error('Failed to fetch council config');
    }
    return response.json();
  },

  /**
   * Update council configuration.
   */
  async updateCouncilConfig(councilModels, chairmanModel) {
    const response = await fetch(`${API_BASE}/api/council/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        council_models: councilModels,
        chairman_model: chairmanModel,
      }),
    });
    if (!response.ok) {
      throw new Error('Failed to update council config');
    }
    return response.json();
  },

  /**
   * Get the current job status for a conversation.
   * @param {string} conversationId - The conversation ID
   * @returns {Promise<{has_job: boolean, job?: object}>}
   */
  async getConversationJob(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/job`
    );
    if (!response.ok) {
      throw new Error('Failed to get conversation job');
    }
    return response.json();
  },

  /**
   * Get job status by job ID.
   * @param {string} jobId - The job ID
   * @returns {Promise<object>}
   */
  async getJob(jobId) {
    const response = await fetch(`${API_BASE}/api/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error('Failed to get job');
    }
    return response.json();
  },

  /**
   * Cancel a running job.
   * @param {string} jobId - The job ID to cancel
   * @returns {Promise<{success: boolean, job_id: string, message: string}>}
   */
  async cancelJob(jobId) {
    const response = await fetch(`${API_BASE}/api/jobs/${jobId}/cancel`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to cancel job');
    }
    return response.json();
  },

  /**
   * Skip a specific model during Stage 1.
   * @param {string} jobId - The job ID
   * @param {string} model - The model ID to skip
   * @returns {Promise<{success: boolean, job_id: string, model: string, message: string}>}
   */
  async skipModel(jobId, model) {
    const response = await fetch(`${API_BASE}/api/jobs/${jobId}/skip-model/${encodeURIComponent(model)}`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to skip model');
    }
    return response.json();
  },

  /**
   * Force continue to Stage 2 with available responses (minimum 2 required).
   * @param {string} jobId - The job ID
   * @returns {Promise<{success: boolean, job_id: string, message: string}>}
   */
  async forceContinue(jobId) {
    const response = await fetch(`${API_BASE}/api/jobs/${jobId}/force-continue`, {
      method: 'POST',
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to force continue');
    }
    return response.json();
  },

  /**
   * Poll a job until it completes or errors.
   * @param {string} jobId - The job ID
   * @param {function} onUpdate - Callback for status updates: (job) => void
   * @param {number} intervalMs - Polling interval in milliseconds (default 500)
   * @returns {Promise<object>} - The final job state
   */
  async pollJob(jobId, onUpdate, intervalMs = 500) {
    while (true) {
      const job = await this.getJob(jobId);
      onUpdate(job);
      
      if (job.status === 'complete' || job.status === 'error') {
        return job;
      }
      
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  },

  /**
   * Get available debate roles.
   * @returns {Promise<{roles: Array}>}
   */
  async getDebateRoles() {
    const response = await fetch(`${API_BASE}/api/debate/roles`);
    if (!response.ok) {
      throw new Error('Failed to fetch debate roles');
    }
    return response.json();
  },

  /**
   * Start a debate and stream events.
   * @param {string} topic - The debate topic
   * @param {string[]} models - Array of model IDs to participate
   * @param {number} maxTurns - Maximum discussion turns (default 6)
   * @param {string[]} roles - Optional array of role keys for each model
   * @param {function} onEvent - Callback for each event: (event) => void
   * @returns {Promise<void>}
   */
  async startDebateStream(topic, models, maxTurns, roles, onEvent) {
    const response = await fetch(`${API_BASE}/api/debate/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic,
        models,
        max_turns: maxTurns,
        roles: roles || null,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to start debate');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            const event = JSON.parse(data);
            onEvent(event);
          } catch (e) {
            console.error('Failed to parse debate SSE event:', e, 'Data:', data);
          }
        }
      }
    }
    
    // Process any remaining data in buffer
    if (buffer.startsWith('data: ')) {
      const data = buffer.slice(6);
      try {
        const event = JSON.parse(data);
        onEvent(event);
      } catch (e) {
        // Ignore incomplete final chunk
      }
    }
  },
};
