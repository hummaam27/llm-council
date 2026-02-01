import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import './DebateSetup.css';

export default function DebateSetup({ onStartDebate, isDebating }) {
  const [topic, setTopic] = useState('');
  const [maxTurns, setMaxTurns] = useState(6);
  const [selectedModels, setSelectedModels] = useState([]);
  const [modelRoles, setModelRoles] = useState({});
  const [useRoles, setUseRoles] = useState(false);
  const [allModels, setAllModels] = useState([]);
  const [availableRoles, setAvailableRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');

  useEffect(() => {
    loadData();
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
            <span className="label-icon">💬</span>
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
            <span className="label-icon">🔄</span>
            Discussion Rounds
          </label>
          <div className="turns-selector">
            <input
              type="range"
              min="2"
              max="12"
              value={maxTurns}
              onChange={(e) => setMaxTurns(parseInt(e.target.value))}
              disabled={isDebating}
              className="turns-slider"
            />
            <span className="turns-value">{maxTurns} turns</span>
          </div>
          <p className="form-hint">More turns allow deeper discussion but take longer</p>
        </div>

        <div className="form-section">
          <div className="form-label-row">
            <label className="form-label">
              <span className="label-icon">🎭</span>
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
            <span className="label-icon">🤖</span>
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

          <div className="model-browser">
            <div className="model-filters">
              <input
                type="text"
                placeholder="Search models..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="model-search"
                disabled={isDebating}
              />
              <select
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
                className="provider-select"
                disabled={isDebating}
              >
                {providers.map(provider => (
                  <option key={provider} value={provider}>
                    {provider === 'all' ? 'All Providers' : provider}
                  </option>
                ))}
              </select>
            </div>

            <div className="model-list">
              {filteredModels.slice(0, 20).map(model => (
                <div
                  key={model.id}
                  className={`model-option ${selectedModels.includes(model.id) ? 'selected' : ''}`}
                  onClick={() => !isDebating && handleToggleModel(model.id)}
                >
                  <div className="model-option-info">
                    <span className="model-option-name">{model.name}</span>
                    <span className="model-option-provider">{model.provider}</span>
                    {model.pricing && (
                      <span className="model-option-price">{formatPrice(model.pricing)}</span>
                    )}
                  </div>
                  {selectedModels.includes(model.id) && (
                    <span className="selected-check">✓</span>
                  )}
                </div>
              ))}
              {filteredModels.length > 20 && (
                <div className="more-models">
                  +{filteredModels.length - 20} more models (refine search)
                </div>
              )}
            </div>
          </div>
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
            <>
              <span className="btn-icon">⚔️</span>
              Start Debate
            </>
          )}
        </button>
      </div>
    </div>
  );
}
