# Mark

Mark is a local-first campaign builder that can:
- connect CRM data (HubSpot bridge),
- generate and edit campaign emails,
- review/approve campaigns,
- assign recipients and send.

The app now supports onboarding, local auth, session lock, demo data mode, and strict lint/type/test gates.

## Quick Start

### 1) Install dependencies
From repo root:

```bash
uv sync --all-extras
```

Install frontend and HubSpot bridge deps:

```bash
cd frontend && npm install
cd ../hubspotserver && npm install
```

### 2) Configure env
Copy and edit env:

```bash
cp .env.example .env
```

Minimum keys for real API generation:
- `GEMINI_API_KEY`

Optional for full functionality:
- `SENDGRID_API_KEY`, `EMAIL_FROM`
- `CLIENT_ID`, `CLIENT_SECRET` (HubSpot OAuth app)

### 3) Run the app (three terminals)

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

URLs:
- Frontend: `http://localhost:5173`
- API docs: `http://localhost:8000/docs`
- HubSpot bridge: `http://localhost:3000`

## Demo Mode (no API keys needed)

1. Open app and finish onboarding.
2. On the home screen click `Use demo data` (or go to `Settings` -> `Load demo data`).
3. Local-only mode is enabled and sample CRM data is loaded.
4. Continue at `Create` and run the full flow locally.

## Useful Commands

Frontend quality gate:

```bash
cd frontend && npm run check
```

Frontend e2e smoke tests:

```bash
cd frontend && npx playwright install && npm run test:e2e
```

Backend tests:

```bash
uv run pytest tests/ -q
```

## Common Issues

### `uv: command not found`
Install uv (for example with Homebrew):

```bash
brew install uv
```

### HubSpot redirect mismatch
In HubSpot app settings, add:

`http://localhost:3000/oauth/callback`

Make sure the same app's `CLIENT_ID`/`CLIENT_SECRET` are in `.env`.

### CRM connection fails
Ensure bridge is running:

```bash
cd hubspotserver && node server.cjs
```

### API generation fails
Either:
- set valid Gemini key and run backend, or
- enable local-only mode in `Settings`.

## Project Structure

Key folders:
- `app/` backend API
- `frontend/src/app` app shell and router
- `frontend/src/core` auth, errors, async/io helpers
- `frontend/src/features` feature modules
- `frontend/src/pages` route pages
- `hubspotserver/` local HubSpot OAuth/data bridge

## License

MIT
