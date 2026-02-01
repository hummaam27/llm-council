import { useState, useEffect } from 'react';
import { api } from '../api';
import ModelPicker from './ModelPicker';
import SingleModelPicker from './SingleModelPicker';
import './CouncilConfig.css';

export default function CouncilConfig({ isOpen, onClose }) {
  const [councilModels, setCouncilModels] = useState([]);
  const [chairmanModel, setChairmanModel] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCouncilPicker, setShowCouncilPicker] = useState(false);
  const [showChairmanPicker, setShowChairmanPicker] = useState(false);
  const [allModels, setAllModels] = useState([]);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      loadModels();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const config = await api.getCouncilConfig();
      setCouncilModels(config.council_models || []);
      setChairmanModel(config.chairman_model || '');
    } catch (error) {
      console.error('Failed to load council config:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadModels = async () => {
    try {
      const data = await api.getOpenRouterModels();
      setAllModels(data.models || []);
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  };

  const handleSave = async () => {
    if (councilModels.length === 0) {
      alert('Please select at least one council model');
      return;
    }
    if (!chairmanModel) {
      alert('Please select a chairman model');
      return;
    }

    setSaving(true);
    try {
      await api.updateCouncilConfig(councilModels, chairmanModel);
      alert('Council configuration saved successfully!');
      onClose();
    } catch (error) {
      console.error('Failed to save council config:', error);
      alert('Failed to save configuration. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const getModelName = (modelId) => {
    const model = allModels.find(m => m.id === modelId);
    return model?.name || modelId;
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="council-config-overlay" onClick={onClose}>
        <div className="council-config-modal" onClick={e => e.stopPropagation()}>
          <div className="council-config-header">
            <h2>Configure Council</h2>
            <button className="close-button" onClick={onClose}>×</button>
          </div>

          {loading ? (
            <div className="loading-config">Loading configuration...</div>
          ) : (
            <div className="council-config-content">
              <div className="config-section">
                <h3>Council Members</h3>
                <p className="section-description">
                  Select the models that will participate in the council debate.
                  Each model will provide an initial response and rank other responses.
                </p>
                <div className="selected-models-display">
                  {councilModels.length === 0 ? (
                    <div className="no-models-selected">No models selected</div>
                  ) : (
                    councilModels.map(modelId => (
                      <div key={modelId} className="model-chip">
                        {getModelName(modelId)}
                      </div>
                    ))
                  )}
                </div>
                <button 
                  className="select-models-button"
                  onClick={() => setShowCouncilPicker(true)}
                >
                  {councilModels.length === 0 ? 'Select Council Models' : 'Change Council Models'}
                </button>
              </div>

              <div className="config-section">
                <h3>Chairman Model</h3>
                <p className="section-description">
                  Select the model that will synthesize the final response based on
                  all council members' inputs and rankings.
                </p>
                <div className="selected-models-display">
                  {chairmanModel ? (
                    <div className="model-chip chairman">
                      {getModelName(chairmanModel)}
                    </div>
                  ) : (
                    <div className="no-models-selected">No chairman selected</div>
                  )}
                </div>
                <button 
                  className="select-models-button"
                  onClick={() => setShowChairmanPicker(true)}
                >
                  {chairmanModel ? 'Change Chairman Model' : 'Select Chairman Model'}
                </button>
              </div>

              <div className="config-actions">
                <button className="cancel-button" onClick={onClose}>
                  Cancel
                </button>
                <button 
                  className="save-button" 
                  onClick={handleSave}
                  disabled={saving || councilModels.length === 0 || !chairmanModel}
                >
                  {saving ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ModelPicker
        isOpen={showCouncilPicker}
        onClose={() => setShowCouncilPicker(false)}
        selectedModels={councilModels}
        onModelsChange={setCouncilModels}
      />

      <SingleModelPicker
        isOpen={showChairmanPicker}
        onClose={() => setShowChairmanPicker(false)}
        selectedModel={chairmanModel}
        onModelSelect={setChairmanModel}
      />
    </>
  );
}
