# LLM Council

![llmcouncil](header.jpg)

A local web application that queries multiple LLMs simultaneously, has them anonymously review and rank each other's responses, and synthesizes a final answer through a designated "Chairman" model.

**Based on [karpathy/llm-council](https://github.com/karpathy/llm-council)** — this fork adds dynamic model configuration, improved conversation management, and other enhancements.

---

## How It Works

Instead of asking a question to a single LLM, you can assemble your own "LLM Council". The app uses [OpenRouter](https://openrouter.ai/) to send your query to multiple LLMs in a 3-stage deliberation process:

1. **Stage 1: First Opinions** — Your query is sent to all council members in parallel. Individual responses are displayed in a tab view for inspection.

2. **Stage 2: Peer Review** — Each LLM reviews and ranks the other responses. Identities are anonymized (Response A, B, C...) to prevent bias. Aggregate rankings are calculated.

3. **Stage 3: Final Synthesis** — The Chairman model compiles all responses and rankings into a single, comprehensive final answer.

---

## Features

### Core Features (from original)
- **Multi-Model Deliberation** — Query multiple LLMs simultaneously
- **Anonymized Peer Review** — Models can't play favorites when evaluating each other
- **Transparent Evaluation** — View raw evaluations and parsed rankings for validation
- **Conversation History** — All conversations are saved locally
- **Markdown Rendering** — Full markdown support for code, tables, and formatting

### New Features (this fork)
- **⚙️ Dynamic Model Configuration** — Configure council members and chairman via the settings pane. Select from any OpenRouter model (OpenAI, Anthropic, Google, and more).
- **🔄 Persistent Conversations** — Navigate away from active conversations and return without losing progress or cancelling ongoing requests.
- **📊 Model Metadata** — View context length, pricing, and descriptions when selecting models.

---

## Quick Start

### Prerequisites

- [Python 3.10+](https://www.python.org/)
- [Node.js 18+](https://nodejs.org/)
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- [OpenRouter API key](https://openrouter.ai/)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/hummaam27/LLM-Council-.git
   cd LLM-Council-
   ```

2. **Install dependencies**
   ```bash
   # Backend
   uv sync

   # Frontend
   cd frontend
   npm install
   cd ..
   ```

3. **Configure API key**
   ```bash
   cp .env.example .env
   # Edit .env and add your OpenRouter API key
   ```

### Running

**Option 1: Use the start script**
```bash
# Linux/macOS
./start.sh

# Windows
.\start.bat
# or
.\start.ps1
```

**Option 2: Run manually**

Terminal 1 (Backend):
```bash
uv run python -m backend.main
```

Terminal 2 (Frontend):
```bash
cd frontend
npm run dev
```

Open http://localhost:5173 in your browser.

---

## Configuration

### Dynamic Model Selection

Click the ⚙️ (settings) button in the sidebar to:
- **Select Council Members** — Choose multiple models from OpenRouter to participate in deliberation
- **Select Chairman** — Choose one model to synthesize the final answer
- **View Model Info** — See pricing, context length, and descriptions for each model

Models are fetched live from OpenRouter's API. Filter by provider (OpenAI, Anthropic, Google, etc.).

### Default Models (config file)

Edit `backend/config.py` to change the default council:

```python
COUNCIL_MODELS = [
    "openai/gpt-5.1",
    "google/gemini-3-pro-preview",
    "anthropic/claude-sonnet-4.5",
    "x-ai/grok-4",
]

CHAIRMAN_MODEL = "google/gemini-3-pro-preview"
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Backend** | FastAPI, Python 3.10+, async httpx |
| **Frontend** | React + Vite, react-markdown |
| **API** | OpenRouter (unified LLM gateway) |
| **Storage** | Local JSON files |
| **Package Management** | uv (Python), npm (JavaScript) |

---

## Project Structure

```
LLM-Council-/
├── backend/
│   ├── config.py           # Model configuration
│   ├── council.py          # 3-stage deliberation logic
│   ├── main.py             # FastAPI endpoints
│   ├── openrouter.py       # OpenRouter API client
│   ├── storage.py          # Conversation persistence
│   └── file_processing.py  # File upload handling
├── frontend/
│   └── src/
│       ├── components/     # React components
│       ├── api.js          # Backend API client
│       └── utils/          # Utility functions
├── data/                   # Conversation storage (gitignored)
├── .env.example            # Environment template
└── start.sh                # Launch script
```

---

## Attribution

This project is based on [llm-council](https://github.com/karpathy/llm-council) by [Andrej Karpathy](https://github.com/karpathy). The original is a "vibe-coded" Saturday hack for exploring multiple LLMs side by side.

**Modifications in this fork:**
- Dynamic model selection via UI (previously required editing config files)
- Improved conversation persistence and navigation
- Enhanced model metadata display (pricing, context length)

---

## License

MIT License — see [LICENSE](LICENSE) for details.

Original work © Andrej Karpathy. Modifications © 2025.
