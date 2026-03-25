.PHONY: install dev test lint format clean help

# ── Variables ─────────────────────────────────────────────────────────────────
PORT := 8000
HOST := 0.0.0.0

# ── Help ──────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  Mark API – Available commands"
	@echo "  ─────────────────────────────────────────────────────────────────"
	@echo "  make install     Install all dependencies (uv)"
	@echo "  make dev         Run development server (auto-reload)"
	@echo "  make start       Run production server"
	@echo "  make test        Run pytest test suite"
	@echo "  make test-unit   Run only unit tests"
	@echo "  make lint        Run ruff linter"
	@echo "  make format      Format code with ruff"
	@echo "  make clean       Remove __pycache__ and .pyc files"
	@echo ""

# ── Setup ─────────────────────────────────────────────────────────────────────
install:
	uv sync --extra dev

# ── Server ────────────────────────────────────────────────────────────────────
dev:
	uv run uvicorn app.main:app \
		--host $(HOST) \
		--port $(PORT) \
		--reload \
		--log-level debug

start:
	uv run uvicorn app.main:app \
		--host $(HOST) \
		--port $(PORT) \
		--workers 2 \
		--log-level info

# ── Tests ─────────────────────────────────────────────────────────────────────
test:
	uv run pytest tests/ -v --tb=short

test-unit:
	uv run pytest tests/test_models.py tests/test_validators.py -v --tb=short

test-live:
	uv run pytest --integration tests/test_integration.py -v -s

# ── Code quality ──────────────────────────────────────────────────────────────
lint:
	uv run ruff check app/ tests/

format:
	uv run ruff format app/ tests/

# ── Cleanup ───────────────────────────────────────────────────────────────────
clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.pyc" -delete
	find . -name "*.pyo" -delete
	find . -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true

# ── Example curl commands ──────────────────────────────────────────────────────
curl-health:
	curl -s http://localhost:$(PORT)/healthz | python3 -m json.tool

curl-validate:
	curl -s -X POST http://localhost:$(PORT)/v1/campaigns/validate \
		-H "Content-Type: application/json" \
		-d @examples/christmas_campaign.json | python3 -m json.tool

curl-generate:
	curl -s -X POST http://localhost:$(PORT)/v1/campaigns/generate \
		-H "Content-Type: application/json" \
		-d @examples/christmas_campaign.json | python3 -m json.tool
