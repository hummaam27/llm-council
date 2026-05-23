# LLM Council

Run multiple LLMs as a panel, on your machine. Ask one question and have them answer, peer-review each other, and synthesize a single response — or convene them for a live, streaming debate you can interrupt.

## Screenshots

![Live debate](images/debate-live.png)

![Debate setup](images/debate-setup.png)

![Moderator summary](images/debate-summary.png)

## Features

- **Debate Mode** — a moderated, streaming panel discussion. Pick any models from OpenRouter, optionally assign adversarial roles to prevent echo chambers, and watch them respond to each other in real time. Raise your hand to pause the debate and contribute. An independent moderator writes the final synthesis.
- **Council Mode** — a 3-stage deliberation: each model answers independently, then anonymously ranks the others, then a chairman synthesizes a final response from the lot.
- **Live web search** — optionally let models search the web before answering. Sources are cited inline.
- **Configurable from the UI** — choose panel members, chairman, and debate moderator from any model on OpenRouter. No config edits required for day-to-day use.
- **Cost-aware** — actual per-call cost is tracked live and accumulated. Debates can be capped with a hard spend limit.

## Quick Start

Requires Python 3.10+, Node 18+, [uv](https://docs.astral.sh/uv/), and an [OpenRouter API key](https://openrouter.ai/).

```bash
git clone https://github.com/hummaam27/llm-council.git
cd llm-council
uv sync
cd frontend && npm install && cd ..
cp .env.example .env   # add your OpenRouter API key
```

Then `./start.sh` (or `.\start.bat` on Windows). The app runs at http://localhost:5173.

## Configuration

Default council members and chairman live in `backend/config.py`. Most users override these from the UI per session.

## Tech Stack

FastAPI · React + Vite · OpenRouter · SSE streaming · local JSON storage

## Project Structure

```
backend/    FastAPI app — council pipeline, debate orchestration, OpenRouter client, jobs, cost
frontend/   React UI
docs/       Design notes
data/       Conversation storage (gitignored)
```

## Attribution

Built on the original [llm-council](https://github.com/karpathy/llm-council) by [Andrej Karpathy](https://github.com/karpathy), which established the 3-stage deliberation concept. This fork extends it with Debate Mode, live streaming throughout, in-UI model configuration, live web search, and cost tracking.

## License

MIT — see [LICENSE](LICENSE).
