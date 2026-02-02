import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import './CouncilModelSelector.css';

export default function CouncilModelSelector() {
  const [councilModels, setCouncilModels] = useState([]);
  const [chairmanModel, setChairmanModel] = useState('');
  const [allModels, setAllModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [dropdownMode, setDropdownMode] = useState('council'); // 'council' or 'chairman'
  const dropdownRef = useRef(null);

  useEffect(() => {
    loadConfig();
    loadModels();
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadConfig = async () => {
    try {
      const config = await api.getCouncilConfig();
      setCouncilModels(config.council_models || []);
      setChairmanModel(config.chairman_model || '');
      setError(null);
    } catch (err) {
      console.error('Failed to load council config:', err);
      setError('Failed to load council configuration');
    } finally {
      setLoading(false);
    }
  };

  const loadModels = async () => {
    try {
      const data = await api.getOpenRouterModels();
      setAllModels(data.models || []);
    } catch (err) {
      console.error('Failed to load models:', err);
      setError('Failed to load available models');
    }
  };

  const handleSave = async (newCouncilModels, newChairmanModel) => {
    if (newCouncilModels.length === 0) {
      alert('Please select at least one council model');
      return;
    }
    if (!newChairmanModel) {
      alert('Please select a chairman model');
      return;
    }

    setSaving(true);
    try {
      await api.updateCouncilConfig(newCouncilModels, newChairmanModel);
      // State already updated by caller - no need to set again
    } catch (err) {
      console.error('Failed to save council config:', err);
      alert('Failed to save configuration. Please try again.');
      // Reload to restore previous state on error
      loadConfig();
    } finally {
      setSaving(false);
    }
  };

  const getModelName = (modelId) => {
    const model = allModels.find(m => m.id === modelId);
    return model?.name || modelId;
  };

  const getModelProvider = (modelId) => {
    const model = allModels.find(m => m.id === modelId);
    return model?.provider || 'unknown';
  };

  const formatApiCost = (pricing) => {
    if (!pricing) return 'API cost: N/A';

    const prompt = Number.parseFloat(pricing.prompt);
    const completion = Number.parseFloat(pricing.completion);

    const hasPrompt = Number.isFinite(prompt) && prompt > 0;
    const hasCompletion = Number.isFinite(completion) && completion > 0;

    if (!hasPrompt && !hasCompletion) return 'API cost: N/A';

    const parts = [];
    if (hasPrompt) parts.push(`in $${(prompt * 1000000).toFixed(2)}/M`);
    if (hasCompletion) parts.push(`out $${(completion * 1000000).toFixed(2)}/M`);
    return `API cost: ${parts.join(' · ')}`;
  };

  const providers = ['all', ...Array.from(new Set(allModels.map(m => m.provider))).sort()];

  const filteredModels = allModels.filter(model => {
    const matchesSearch = 
      (model.name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      (model.id?.toLowerCase() || '').includes(searchQuery.toLowerCase());
    const matchesProvider = providerFilter === 'all' || model.provider === providerFilter;
    return matchesSearch && matchesProvider;
  });

  const toggleCouncilModel = (modelId) => {
    const isRemoving = councilModels.includes(modelId);
    const newModels = isRemoving
      ? councilModels.filter(id => id !== modelId)
      : [...councilModels, modelId];
    
    // If removing the chairman model, clear the chairman
    let newChairman = chairmanModel;
    if (isRemoving && modelId === chairmanModel) {
      newChairman = '';
      setChairmanModel('');
    }
    
    setCouncilModels(newModels);
    handleSave(newModels, newChairman);
  };

  const selectChairman = (modelId) => {
    setChairmanModel(modelId);
    handleSave(councilModels, modelId);
    setShowDropdown(false);
  };

  const openDropdown = (mode) => {
    setDropdownMode(mode);
    setShowDropdown(true);
    setSearchQuery('');
    setProviderFilter('all');
  };

  if (loading) {
    return (
      <div className="council-model-selector loading">
        <div className="spinner"></div>
        <span>Loading...</span>
      </div>
    );
  }

  if (error && allModels.length === 0) {
    return (
      <div className="council-model-selector">
        <div className="selector-header">
          <span className="selector-title">🏛️ Council Configuration</span>
        </div>
        <div className="error-message">
          <span>⚠️ {error}</span>
          <button className="retry-btn" onClick={() => { setLoading(true); setError(null); loadConfig(); loadModels(); }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="council-model-selector">
      <div className="selector-header">
        <span className="selector-title">🏛️ Council Configuration</span>
        {saving && <span className="saving-indicator">Saving...</span>}
      </div>

      <div className="selector-content">
        {/* Council Members */}
        <div className="model-section">
          <div className="section-label">Council Members ({councilModels.length})</div>
          <div className="selected-models">
            {councilModels.length === 0 ? (
              <span className="no-selection">No models selected</span>
            ) : (
              councilModels.map(modelId => (
                <span key={modelId} className="model-chip">
                  {getModelName(modelId)}
                  <button 
                    className="remove-chip"
                    onClick={() => toggleCouncilModel(modelId)}
                    title="Remove"
                  >
                    ×
                  </button>
                </span>
              ))
            )}
            <button 
              className="add-btn"
              onClick={() => openDropdown('council')}
            >
              + Add
            </button>
          </div>
        </div>

        {/* Chairman */}
        <div className="model-section">
          <div className="section-label">Chairman</div>
          <div className="selected-models">
            {chairmanModel ? (
              <span className="model-chip chairman">
                {getModelName(chairmanModel)}
              </span>
            ) : (
              <span className="no-selection">No chairman selected</span>
            )}
            <button 
              className="add-btn"
              onClick={() => openDropdown('chairman')}
            >
              {chairmanModel ? 'Change' : 'Select'}
            </button>
          </div>
        </div>
      </div>

      {/* Dropdown Modal */}
      {showDropdown && (
        <div className="model-dropdown-overlay">
          <div className="model-dropdown" ref={dropdownRef}>
            <div className="dropdown-header">
              <h3>{dropdownMode === 'council' ? 'Select Council Members' : 'Select Chairman'}</h3>
              <button className="close-btn" onClick={() => setShowDropdown(false)}>×</button>
            </div>

            <div className="dropdown-filters">
              <input
                type="text"
                placeholder="Search models..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
                autoFocus
              />
              <select
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
                className="provider-filter"
              >
                {providers.map(p => (
                  <option key={p} value={p}>{p === 'all' ? 'All Providers' : p}</option>
                ))}
              </select>
            </div>

            <div className="dropdown-list">
              {filteredModels.length === 0 ? (
                <div className="no-results">No models found</div>
              ) : (
                filteredModels.map(model => (
                  <div
                    key={model.id}
                    className={`dropdown-item ${
                      dropdownMode === 'council' 
                        ? (councilModels.includes(model.id) ? 'selected' : '')
                        : (chairmanModel === model.id ? 'selected' : '')
                    }`}
                    onClick={() => {
                      if (dropdownMode === 'council') {
                        toggleCouncilModel(model.id);
                      } else {
                        selectChairman(model.id);
                      }
                    }}
                  >
                    {dropdownMode === 'council' && (
                      <input
                        type="checkbox"
                        checked={councilModels.includes(model.id)}
                        onChange={() => {}}
                        readOnly
                      />
                    )}
                    {dropdownMode === 'chairman' && (
                      <input
                        type="radio"
                        checked={chairmanModel === model.id}
                        onChange={() => {}}
                        readOnly
                      />
                    )}
                    <div className="item-info">
                      <span className="item-name">{model.name}</span>
                      <div className="item-meta">
                        <span className="item-provider">{model.provider}</span>
                        <span className="item-cost">{formatApiCost(model.pricing)}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {dropdownMode === 'council' && (
              <div className="dropdown-footer">
                <span>{councilModels.length} models selected</span>
                <button className="done-btn" onClick={() => setShowDropdown(false)}>
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
