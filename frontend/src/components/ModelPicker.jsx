import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import './ModelPicker.css';

export default function ModelPicker({ 
  isOpen, 
  onClose, 
  selectedModels, 
  onModelsChange 
}) {
  const [allModels, setAllModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');

  useEffect(() => {
    if (isOpen && allModels.length === 0) {
      loadModels();
    }
  }, [isOpen]);

  const loadModels = async () => {
    setLoading(true);
    try {
      const data = await api.getOpenRouterModels();
      setAllModels(data.models || []);
    } catch (error) {
      console.error('Failed to load OpenRouter models:', error);
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
        model.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (model.description && model.description.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesProvider = providerFilter === 'all' || model.provider === providerFilter;
      
      return matchesSearch && matchesProvider;
    });
  }, [allModels, searchQuery, providerFilter]);

  const handleToggleModel = (modelId) => {
    if (selectedModels.includes(modelId)) {
      if (selectedModels.length > 1) {
        onModelsChange(selectedModels.filter(id => id !== modelId));
      }
    } else {
      onModelsChange([...selectedModels, modelId]);
    }
  };

  const handleAddModel = (model) => {
    if (!selectedModels.includes(model.id)) {
      onModelsChange([...selectedModels, model.id]);
    }
  };

  const handleRemoveModel = (modelId) => {
    if (selectedModels.length > 1) {
      onModelsChange(selectedModels.filter(id => id !== modelId));
    }
  };

  const formatPrice = (pricing) => {
    if (!pricing) return 'N/A';
    const promptPrice = parseFloat(pricing.prompt || 0) * 1000000;
    return `$${promptPrice.toFixed(2)}/M tokens`;
  };

  if (!isOpen) return null;

  return (
    <div className="model-picker-overlay" onClick={onClose}>
      <div className="model-picker-modal" onClick={e => e.stopPropagation()}>
        <div className="model-picker-header">
          <h2>Select Council Models</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="model-picker-selected">
          <h3>Selected Models ({selectedModels.length})</h3>
          <div className="selected-models-list">
            {selectedModels.map(modelId => {
              const model = allModels.find(m => m.id === modelId);
              return (
                <div key={modelId} className="selected-model-chip">
                  <span>{model?.name || modelId}</span>
                  <button 
                    onClick={() => handleRemoveModel(modelId)}
                    disabled={selectedModels.length === 1}
                    title={selectedModels.length === 1 ? "At least one model required" : "Remove"}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="model-picker-filters">
          <input
            type="text"
            placeholder="Search models..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="model-search-input"
          />
          <select 
            value={providerFilter} 
            onChange={(e) => setProviderFilter(e.target.value)}
            className="provider-filter"
          >
            {providers.map(provider => (
              <option key={provider} value={provider}>
                {provider === 'all' ? 'All Providers' : provider}
              </option>
            ))}
          </select>
        </div>

        <div className="model-picker-list">
          {loading ? (
            <div className="loading-models">Loading models from OpenRouter...</div>
          ) : filteredModels.length === 0 ? (
            <div className="no-models">No models found</div>
          ) : (
            filteredModels.map(model => (
              <div 
                key={model.id} 
                className={`model-item ${selectedModels.includes(model.id) ? 'selected' : ''}`}
                onClick={() => handleToggleModel(model.id)}
              >
                <div className="model-item-header">
                  <span className="model-name">{model.name}</span>
                  <span className="model-provider">{model.provider}</span>
                </div>
                <div className="model-item-details">
                  <span className="model-id">{model.id}</span>
                  <span className="model-context">{(model.context_length / 1000).toFixed(0)}K ctx</span>
                  <span className="model-price">{formatPrice(model.pricing)}</span>
                </div>
                {model.description && (
                  <div className="model-description">{model.description.slice(0, 150)}...</div>
                )}
                <div className="model-item-action">
                  {selectedModels.includes(model.id) ? (
                    <span className="selected-badge">✓ Selected</span>
                  ) : (
                    <button 
                      className="add-model-btn"
                      onClick={(e) => { e.stopPropagation(); handleAddModel(model); }}
                    >
                      + Add to Council
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="model-picker-footer">
          <span className="model-count">{filteredModels.length} models available</span>
          <button className="done-button" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
