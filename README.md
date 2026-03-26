# Mark

AI-powered campaign workspace with multi-agent generation, review, experimentation, and closed-loop learning.

## What You Get

- Generate campaigns from a prompt (multi-stage AI orchestration).
- Review and edit copy, run compliance checks, and localize content.
- Connect HubSpot contacts, map recipients, and prepare send flow.
- Run subject/CTA experiments, record outcomes, and improve future generations.
- Persist campaigns and auth in Supabase cloud mode.

## Feature Overview

### Core Product Flow

1. Authenticate (cloud mode via Supabase or local/demo mode).
2. Create campaign from prompt.
3. Review/edit emails + risk checks.
4. Assign recipients and send.
5. Record outcomes for learning and observability.

### Agent Capabilities (MVP+)

- Compliance Assistant (risk flags + safer rewrites).
- A/B Subject + CTA support with experiment tracking.
- Performance Copilot and growth-loop orchestration.
- Structured memory retrieval from prior outcomes.
- Brand Voice training and reuse.
- Localization agent (language + region adaptation).
- Content repurposing agent (multi-channel outputs).
- Agent observability (success/fallback/latency metrics).

## Architecture

- `frontend/`: React + Vite + Zustand + React Query + Playwright.
- `app/`: FastAPI backend with Gemini-powered agent endpoints.
- `hubspotserver/`: local HubSpot OAuth/data bridge.
- Supabase:
  - Auth + profile/campaign persistence.
  - Agent persistence (outcomes, experiments, variants, metrics) in cloud mode.

## Prerequisites

- Python `3.11+`
- Node `18+` (Node `20+` recommended)
- `uv` installed (`brew install uv`)

## Quick Start

### 1) Install dependencies

From repo root:

```bash
uv sync --all-extras
```

Install frontend and HubSpot bridge dependencies:

```bash
cd frontend && npm install
cd ../hubspotserver && npm install
```

### 2) Configure environment

Copy sample env:

```bash
cp .env.example .env
```

Set values based on the mode you want:

- Required for AI generation:
  - `GEMINI_API_KEY`
- Required for cloud auth + cloud persistence:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
- Optional but recommended:
  - `SENDGRID_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`
  - `CLIENT_ID`, `CLIENT_SECRET` (HubSpot OAuth app)

### 3) Run the app (3 terminals)

Backend API:

```bash
make dev
```

Frontend:

```bash
cd frontend && npm run dev
```

HubSpot bridge:

```bash
cd hubspotserver && node server.cjs
```

### 4) Open URLs

- Frontend: `http://localhost:5173`
- FastAPI docs: `http://localhost:8000/docs`
- HubSpot bridge: `http://localhost:3000`

## Mode Behavior

### Demo / Local Mode

- No external keys required for basic walkthrough.
- Use `Use demo data` on home screen (or `Settings -> Load demo data`).
- Best for quick UX validation.

### Cloud Mode (Recommended)

- Supabase auth + user-scoped data persistence.
- Agent learning/experiment/metrics persisted for authenticated users.
- Best for real usage and deployment.

## Validation Checklist (Before Push/Deploy)

Run all quality gates:

```bash
uv run pytest -q
cd frontend && npm run lint && npm run test && npm run build
cd frontend && npx playwright install chromium && npm run test:e2e
```

## Runbook Commands

Backend:

```bash
make dev
make test
make lint
```

Frontend:

```bash
cd frontend && npm run dev
cd frontend && npm run check
cd frontend && npm run test:e2e
```

## Common Issues

### `uv: command not found`

Install uv:

```bash
brew install uv
```

### HubSpot OAuth redirect mismatch

In HubSpot app settings, add:

`http://localhost:3000/oauth/callback`

Then ensure same app `CLIENT_ID`/`CLIENT_SECRET` are in `.env`.

### API says session/credentials issue

- Confirm frontend and backend Supabase envs are both set.
- Sign out/in again to refresh token.
- Restart backend after env changes.

### AI generation too weak or no score

- Improve prompt specificity (audience, offer, objective, tone).
- Ensure Gemini key is valid and backend can reach API.
- Check Review/Send page inputs are complete before evaluation.

## Project Structure

- `app/`: backend API, auth/security, services, campaign routes.
- `frontend/src/app`: providers, router, app bootstrap.
- `frontend/src/core`: api/error/auth/shared client logic.
- `frontend/src/pages`: route pages (create/review/send/settings/etc.).
- `frontend/e2e`: Playwright end-to-end scenarios.
- `hubspotserver/`: local OAuth + CRM bridge server.

## Security Notes

- Never commit real `.env` values.
- Use Supabase RLS with user-scoped access for cloud data.
- Keep anon keys in env only; rotate keys if leaked.

## License

MIT
