import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import CostBadge from './CostBadge';
import './SandboxSetup.css';

const MIN_AGENTS = 2;
const AGENT_CAP = 6;
const MAX_TICKS = 30;
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

// Rough token assumptions for the pre-run cost estimate
const EST_PROMPT_TOKENS = 1500;
const EST_COMPLETION_TOKENS = 600;

const SAMPLE_AGENTS = [
  {
    name: 'Mara',
    backstory: 'A curious traveler new to the town, always looking for stories.',
    personality: 'Friendly, talkative, optimistic.',
    goal: 'Earn enough coins to open your own little shop in town.',
    model: DEFAULT_MODEL,
  },
  {
    name: 'Tomas',
    backstory: 'The quiet town baker who has lived here his whole life.',
    personality: 'Shy, observant, kind-hearted.',
    goal: 'Save coins for hard times — though you hate to see a friend go without.',
    model: DEFAULT_MODEL,
  },
];

function blankAgent() {
  return { name: '', backstory: '', personality: '', goal: '', model: DEFAULT_MODEL };
}

export default function SandboxSetup({ onStartSandbox, isSimulating }) {
  const [agents, setAgents] = useState(SAMPLE_AGENTS.map((a) => ({ ...a })));
  const [maxTicks, setMaxTicks] = useState(10);
  const [allModels, setAllModels] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    setLoading(true);
    try {
      const modelsData = await api.getOpenRouterModels();
      setAllModels(modelsData.models || []);
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateAgent = (index, field, value) => {
    setAgents((prev) =>
      prev.map((a, i) => (i === index ? { ...a, [field]: value } : a))
    );
  };

  const addAgent = () => {
    if (agents.length >= AGENT_CAP) return;
    setAgents((prev) => [...prev, blankAgent()]);
  };

  const removeAgent = (index) => {
    if (agents.length <= MIN_AGENTS) return;
    setAgents((prev) => prev.filter((_, i) => i !== index));
  };

  const allNamed = agents.every((a) => a.name.trim().length > 0);
  const canStart = !isSimulating && allNamed && agents.length >= MIN_AGENTS;

  // Rough pre-run cost estimate: one call per agent per tick.
  const estimatedCost = useMemo(() => {
    if (allModels.length === 0) return 0;
    let perTick = 0;
    for (const agent of agents) {
      const model = allModels.find((m) => m.id === agent.model);
      const pricing = model?.pricing;
      if (!pricing) continue;
      perTick +=
        EST_PROMPT_TOKENS * parseFloat(pricing.prompt || 0) +
        EST_COMPLETION_TOKENS * parseFloat(pricing.completion || 0);
    }
    return perTick * maxTicks;
  }, [agents, allModels, maxTicks]);

  const handleStart = () => {
    if (!canStart) return;
    onStartSandbox({
      agents: agents.map((a) => ({
        name: a.name.trim(),
        backstory: a.backstory.trim(),
        personality: a.personality.trim(),
        goal: a.goal.trim(),
        model: a.model || DEFAULT_MODEL,
      })),
      maxTicks,
    });
  };

  if (loading) {
    return (
      <div className="sandbox-setup">
        <div className="sandbox-setup-loading">
          <div className="spinner"></div>
          <span>Loading models...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="sandbox-setup">
      <div className="sandbox-setup-header">
        <h2>Build Your Sim Universe</h2>
        <p>Define characters and watch them live, walk, and talk in a tiny town</p>
      </div>

      <div className="sandbox-setup-form">
        <div className="form-section">
          <label className="form-label">
            Simulation Length
          </label>
          <div className="ticks-selector">
            <input
              type="range"
              min="1"
              max={MAX_TICKS}
              value={maxTicks}
              onChange={(e) => setMaxTicks(parseInt(e.target.value))}
              disabled={isSimulating}
              className="ticks-slider"
            />
            <span className="ticks-value">{maxTicks} ticks</span>
          </div>
          <p className="form-hint">
            Each tick, every agent takes one action. More ticks = longer (and pricier) run.
          </p>
        </div>

        <div className="form-section">
          <label className="form-label">
            Characters ({agents.length}/{AGENT_CAP})
          </label>

          <div className="agent-list">
            {agents.map((agent, index) => (
              <div key={index} className="agent-card">
                <div className="agent-card-header">
                  <span className="agent-number">#{index + 1}</span>
                  <input
                    className="agent-name-input"
                    type="text"
                    placeholder="Character name"
                    value={agent.name}
                    onChange={(e) => updateAgent(index, 'name', e.target.value)}
                    disabled={isSimulating}
                  />
                  {agents.length > MIN_AGENTS && (
                    <button
                      className="remove-agent"
                      onClick={() => removeAgent(index)}
                      disabled={isSimulating}
                      type="button"
                    >
                      ×
                    </button>
                  )}
                </div>

                <textarea
                  className="agent-field"
                  placeholder="Backstory — who are they?"
                  value={agent.backstory}
                  onChange={(e) => updateAgent(index, 'backstory', e.target.value)}
                  disabled={isSimulating}
                  rows={2}
                />
                <input
                  className="agent-field"
                  type="text"
                  placeholder="Personality — e.g. shy, curious, blunt"
                  value={agent.personality}
                  onChange={(e) => updateAgent(index, 'personality', e.target.value)}
                  disabled={isSimulating}
                />
                <input
                  className="agent-field"
                  type="text"
                  placeholder="Goal — what do they want today?"
                  value={agent.goal}
                  onChange={(e) => updateAgent(index, 'goal', e.target.value)}
                  disabled={isSimulating}
                />
                <select
                  className="agent-model-select"
                  value={agent.model}
                  onChange={(e) => updateAgent(index, 'model', e.target.value)}
                  disabled={isSimulating}
                >
                  {allModels.length === 0 && (
                    <option value={DEFAULT_MODEL}>{DEFAULT_MODEL}</option>
                  )}
                  {allModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <button
            className="add-agent-btn"
            onClick={addAgent}
            disabled={isSimulating || agents.length >= AGENT_CAP}
            type="button"
          >
            <span>+</span> Add Character
          </button>
        </div>

        <div className="sandbox-estimate">
          <CostBadge total={estimatedCost} estimated label="Est. cost" />
          <span className="estimate-hint">rough estimate — actual cost is tracked live</span>
        </div>

        <button
          className="start-sandbox-btn"
          onClick={handleStart}
          disabled={!canStart}
        >
          {isSimulating ? (
            <>
              <span className="btn-spinner"></span>
              Simulation Running...
            </>
          ) : (
            <>Start Simulation</>
          )}
        </button>
        {!allNamed && (
          <p className="form-hint warning">Every character needs a name to start.</p>
        )}
      </div>
    </div>
  );
}
