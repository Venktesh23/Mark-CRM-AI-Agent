"""
app/main.py – FastAPI entry point for Mark API.
"""
from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.routes.campaigns import router as campaigns_router
from app.routes.email import router as email_router
from app.routes.health import router as health_router

logging.basicConfig(
    level=logging.DEBUG,
    format="%(levelname)s %(name)s – %(message)s",
)
logger = logging.getLogger(__name__)


# ── Minimal request-ID middleware (echoes X-Request-ID for tracing) ───────────


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request.state.request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.add_middleware(RequestIDMiddleware)

app.include_router(health_router)
app.include_router(campaigns_router)
app.include_router(email_router)
