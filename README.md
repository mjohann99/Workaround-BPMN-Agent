# Workaround Check

Workaround Check is a minimal research prototype for eliciting how employees *actually* execute business processes. The app chats with the employee, incrementally builds a structured ProcessModel, detects potential workarounds, and visualizes the current process as BPMN in real time.

## Research Concept

Core flow:

Employee chat -> OpenAI Responses API -> structured process changes -> server validation + deterministic apply -> ProcessModel (source of truth) -> BPMN XML generation -> bpmn-js live visualization.

The LLM proposes changes, but the backend always validates and applies updates deterministically.

## Architecture

- `frontend` (React + TypeScript + Vite + bpmn-js)
- `backend` (Express + TypeScript + OpenAI SDK + Zod)
- In-memory session store for v0.1 (no database)

Separation of concerns:

- UI and rendering: `frontend/src`
- API and orchestration: `backend/src/app.ts`
- OpenAI integration and structured output handling: `backend/src/openai.ts`
- Process validation and deterministic mutation logic: `backend/src/process.ts`
- BPMN XML generation: `backend/src/bpmn.ts`
- In-memory storage: `backend/src/store.ts`
- Optional research logging: `backend/src/logging.ts`

## Setup

Prerequisites:

- Node.js 20+ (includes npm)

Install dependencies from repository root:

```bash
npm install
```

## Environment

Copy `.env.example` to `.env` and configure:

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
PORT=3001
ENABLE_RESEARCH_LOG=true
```

Important:

- `OPENAI_API_KEY` is used only by backend code.
- Never expose `OPENAI_API_KEY` to frontend/browser code.

## Run Locally

From repository root:

```bash
npm run dev
```

Default URLs:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

## API

### `POST /api/sessions`
Creates a new interview session with initial assistant prompt.

### `GET /api/sessions/:id`
Returns current session state and generated BPMN XML.

### `POST /api/sessions/:id/message`
Input:

```json
{ "message": "..." }
```

Flow:

1. Stores employee message.
2. Sends prompt + recent conversation + current ProcessModel to OpenAI Responses API.
3. Validates structured output with Zod.
4. Deterministically applies validated changes.
5. Stores updated ProcessModel.
6. Returns assistant message, process, applied process changes, and BPMN XML.

## Exports

The UI supports:

- Export BPMN (`.bpmn` XML)
- Export ProcessModel JSON (`.json`)

## Research Logging

When `ENABLE_RESEARCH_LOG=true`, backend appends a JSONL line per interaction to:

- `backend/research-log.jsonl`

Each record includes timestamp, sessionId, user message, assistant message, process before, proposed changes, and process after.

## Testing

Run tests:

```bash
npm test
```

Current test coverage includes:

- session creation
- add/update/remove task
- flows and invalid references
- exclusive gateway support
- workaround confirmation guardrail
- BPMN generation
- XML escaping

## Privacy Note

This prototype is for research and process-elicitation experiments. Employee input may contain operational details. Use controlled environments and avoid sending sensitive personal or regulated data during tests.

## Limitations

- BPMN subset only (start, task, exclusive gateway, end, sequence flow)
- In-memory storage only (session state resets on restart)
- Workaround identification is LLM-assisted and heuristic
- Human confirmation is required before marking workaround as confirmed
- No reference-model comparison or conformance checking yet
- No authentication, authorization, or production security hardening
