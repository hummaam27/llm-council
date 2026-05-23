import { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../api';
import CostBadge from './CostBadge';
import './DebateSetup.css';

// Rough token assumptions for the pre-run cost estimate
const EST_PROMPT_TOKENS = 1500;
const EST_COMPLETION_TOKENS = 600;

export default function DebateSetup({ onStartDebate, isDebating }) {
  const [topic, setTopic] = useState('');
  const [maxTurns, setMaxTurns] = useState(6);
  const [costLimit, setCostLimit] = useState(10);
  const [selectedModels, setSelectedModels] = useState([]);
  const [modelRoles, setModelRoles] = useState({});
  const [useRoles, setUseRoles] = useState(false);
  const [enableWeb, setEnableWeb] = useState(false);
  const [moderatorModel, setModeratorModel] = useState('');
  const [allModels, setAllModels] = useState([]);
  const [availableRoles, setAvailableRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowModelDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [modelsData, rolesData] = await Promise.all([
        api.getOpenRouterModels(),
        api.getDebateRoles(),
      ]);
      setAllModels(modelsData.models || []);
      setAvailableRoles(rolesData.roles || []);
      
      if (modelsData.models && modelsData.models.length >= 2) {
        const defaultModels = modelsData.models.slice(0, 3).map(m => m.id);
        setSelectedModels(defaultModels);
      }

      // Default the moderator to the configured chairman if available
      try {
        const councilConfig = await api.getCouncilConfig();
        if (councilConfig?.chairman_model) {
          setModeratorModel(councilConfig.chairman_model);
        }
      } catch (e) {
        // Non-fatal — backend will fall back to the chairman default
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const providers = useMemo(() => {
    const providerSet = new Set(allModels.map(m => m.provider));
    return ['all', ...Array.from(providerSet).sort()];
  }, [allModels]);

  const filteredModels = useMemo(() => {
    return allModels.filter(model => {
      const matchesSearch = 
        model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        model.id.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesProvider = providerFilter === 'all' || model.provider === providerFilter;
      return matchesSearch && matchesProvider;
    });
  }, [allModels, searchQuery, providerFilter]);

  const handleToggleModel = (modelId) => {
    if (selectedModels.includes(modelId)) {
      if (selectedModels.length > 2) {
        setSelectedModels(selectedModels.filter(id => id !== modelId));
        const newRoles = { ...modelRoles };
        delete newRoles[modelId];
        setModelRoles(newRoles);
      }
    } else {
      setSelectedModels([...selectedModels, modelId]);
    }
  };

  const handleRoleChange = (modelId, roleKey) => {
    setModelRoles({
      ...modelRoles,
      [modelId]: roleKey || null,
    });
  };

  // Rough pre-run estimate: one call per opening + 2 per discussion turn
  // (speaker + moderator) + 1 summary.
  const estimatedCost = useMemo(() => {
    if (allModels.length === 0 || selectedModels.length === 0) return 0;
    const perCall = (modelId) => {
      const pricing = allModels.find((m) => m.id === modelId)?.pricing;
      if (!pricing) return 0;
      return (
        EST_PROMPT_TOKENS * parseFloat(pricing.prompt || 0) +
        EST_COMPLETION_TOKENS * parseFloat(pricing.completion || 0)
      );
    };
    const avgPerCall =
      selectedModels.reduce((sum, id) => sum + perCall(id), 0) /
      selectedModels.length;
    const callCount = selectedModels.length + 2 * maxTurns + 1;
    return avgPerCall * callCount;
  }, [allModels, selectedModels, maxTurns]);

  const handleStartDebate = () => {
    if (!topic.trim() || selectedModels.length < 2 || isDebating) return;
    
    let roles = null;
    if (useRoles) {
      roles = selectedModels.map(modelId => modelRoles[modelId] || null);
      if (roles.every(r => r === null)) {
        roles = null;
      }
    }
    
    onStartDebate({
      topic: topic.trim(),
      models: selectedModels,
      maxTurns,
      roles,
      costLimit,
      enableWeb,
      moderatorModel: moderatorModel || null,
    });
  };

  const getModelName = (modelId) => {
    const model = allModels.find(m => m.id === modelId);
    return model?.name || modelId.split('/').pop();
  };

  const formatPrice = (pricing) => {
    if (!pricing) return null;
    const promptPrice = parseFloat(pricing.prompt || 0) * 1000000;
    const completionPrice = parseFloat(pricing.completion || 0) * 1000000;
    if (promptPrice === 0 && completionPrice === 0) return 'Free';
    return `$${promptPrice.toFixed(2)}/$${completionPrice.toFixed(2)} per 1M tokens`;
  };

  if (loading) {
    return (
      <div className="debate-setup">
        <div className="debate-setup-loading">
          <div className="spinner"></div>
          <span>Loading models...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="debate-setup">
      <div className="debate-setup-header">
        <h2>Start a Debate</h2>
        <p>Configure your multi-model debate session</p>
      </div>

      <div className="debate-setup-form">
        <div className="form-section">
          <label className="form-label">
            Debate Topic
          </label>
          <textarea
            className="topic-input"
            placeholder="Enter a topic for the models to debate... (e.g., 'Is AI consciousness possible?')"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            disabled={isDebating}
            rows={3}
          />
        </div>

        <div className="form-section">
          <label className="form-label">
            Discussion Rounds
          </label>
          <div className="turns-selector">
            <input
              type="range"
              min="2"
              max="50"
              value={maxTurns}
              onChange={(e) => setMaxTurns(parseInt(e.target.value))}
              disabled={isDebating}
              className="turns-slider"
            />
            <span className="turns-value">{maxTurns} rounds</span>
          </div>
          <p className="form-hint">
            The debate stops at whichever comes first — this round cap or the cost limit below.
          </p>
        </div>

        <div className="form-section">
          <label className="form-label">
            Cost Limit
          </label>
          <div className="cost-limit-selector">
            <span className="cost-limit-prefix">$</span>
            <input
              type="number"
              className="cost-limit-input"
              min="0.5"
              max="50"
              step="0.5"
              value={costLimit}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setCostLimit(isNaN(v) ? 0.5 : Math.min(50, Math.max(0.5, v)));
              }}
              disabled={isDebating}
            />
          </div>
          <p className="form-hint">
            The debate halts once total API spend reaches this amount. Hard ceiling: $50.
          </p>
        </div>

        <div className="form-section">
          <div className="form-label-row">
            <label className="form-label">
              Assign Debate Roles
            </label>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={useRoles}
                onChange={(e) => setUseRoles(e.target.checked)}
                disabled={isDebating}
              />
              <span className="toggle-text">{useRoles ? 'Enabled' : 'Disabled'}</span>
            </label>
          </div>
          {useRoles && (
            <p className="form-hint">Roles create adversarial positions to prevent echo chambers</p>
          )}
        </div>

        <div className="form-section">
          <label className="form-label">
            Select Debaters ({selectedModels.length} selected)
          </label>
          
          <div className="selected-debaters">
            {selectedModels.map((modelId, index) => (
              <div key={modelId} className="selected-debater">
                <div className="debater-info">
                  <span className="debater-number">#{index + 1}</span>
                  <span className="debater-name">{getModelName(modelId)}</span>
                  {selectedModels.length > 2 && (
                    <button
                      className="remove-debater"
                      onClick={() => handleToggleModel(modelId)}
                      disabled={isDebating}
                    >
                      ×
                    </button>
                  )}
                </div>
                {useRoles && (
                  <select
                    className="role-select"
                    value={modelRoles[modelId] || ''}
                    onChange={(e) => handleRoleChange(modelId, e.target.value)}
                    disabled={isDebating}
                  >
                    <option value="">No specific role</option>
                    {availableRoles.map(role => (
                      <option key={role.key} value={role.key}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>

          <div className="model-selection-dropdown-container" ref={dropdownRef}>
            <button
              className="add-models-btn"
              onClick={() => setShowModelDropdown(!showModelDropdown)}
              disabled={isDebating}
              type="button"
            >
              <span>+</span>
              Add Models
            </button>

            {showModelDropdown && (
              <div className="model-dropdown-modal">
                <div className="model-dropdown-header">
                  <h3>Select Models</h3>
                  <button 
                    className="close-dropdown"
                    onClick={() => setShowModelDropdown(false)}
                  >
                    ×
                  </button>
                </div>

                <div className="model-dropdown-filters">
                  <input
                    type="text"
                    placeholder="Search models..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="model-search"
                  />
                  <select
                    value={providerFilter}
                    onChange={(e) => setProviderFilter(e.target.value)}
                    className="provider-select"
                  >
                    {providers.map(provider => (
                      <option key={provider} value={provider}>
                        {provider === 'all' ? 'All Providers' : provider}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="model-dropdown-list">
                  {filteredModels.length === 0 ? (
                    <div className="no-models">No models found</div>
                  ) : (
                    filteredModels.map(model => (
                      <div
                        key={model.id}
                        className={`model-dropdown-option ${selectedModels.includes(model.id) ? 'selected' : ''}`}
                        onClick={() => handleToggleModel(model.id)}
                      >
                        <div className="model-option-checkbox">
                          <input
                            type="checkbox"
                            checked={selectedModels.includes(model.id)}
                            onChange={() => {}}
                            readOnly
                          />
                        </div>
                        <div className="model-option-info">
                          <span className="model-option-name">{model.name}</span>
                          <div className="model-option-meta">
                            <span className="model-option-provider">{model.provider}</span>
                            {model.pricing && (
                              <span className="model-option-price">{formatPrice(model.pricing)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="model-dropdown-footer">
                  <span className="selected-count">{selectedModels.length} selected</span>
                  <button
                    className="done-btn"
                    onClick={() => setShowModelDropdown(false)}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="debate-tools">
          <div className="moderator-picker">
            <label htmlFor="moderator-select">Moderator (writes the final summary):</label>
            <select
              id="moderator-select"
              className="moderator-select"
              value={moderatorModel}
              onChange={(e) => setModeratorModel(e.target.value)}
              disabled={isDebating}
            >
              <option value="">— use council chairman —</option>
              {allModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name || m.id}</option>
              ))}
            </select>
          </div>
          <label className="web-toggle" title="Each panelist may search the web when speaking. Adds ~$0.02 per turn that searches.">
            <input
              type="checkbox"
              checked={enableWeb}
              onChange={(e) => setEnableWeb(e.target.checked)}
              disabled={isDebating}
            />
            <span>🌐 Allow web search for panelists</span>
          </label>
        </div>

        <div className="debate-estimate">
          <CostBadge total={estimatedCost} estimated label="Est. cost" />
          <span className="estimate-hint">rough estimate — web search adds ~$0.02 per searching call</span>
        </div>

        <button
          className="start-debate-btn"
          onClick={handleStartDebate}
          disabled={!topic.trim() || selectedModels.length < 2 || isDebating}
        >
          {isDebating ? (
            <>
              <span className="btn-spinner"></span>
              Debate in Progress...
            </>
          ) : (
            <>Start Debate</>
          )}
        </button>
      </div>
    </div>
  );
}
