"""
app/routes/health.py – liveness and readiness endpoints.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter

from app.config import settings
from app.models import HealthResponse, ReadinessResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Health"])


@router.get(
    "/healthz",
    response_model=HealthResponse,
    summary="Liveness probe",
    description="Returns 200 as long as the application process is running.",
)
async def healthz() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=settings.app_version,
        model=settings.gemini_model,
        gemini_key_configured=bool(settings.gemini_api_key),
    )


@router.get(
    "/readyz",
    response_model=ReadinessResponse,
    summary="Readiness probe",
    description=(
        "Returns 200 when the service is ready to handle requests. "
        "Checks that the Gemini API key is configured."
    ),
)
async def readyz() -> ReadinessResponse:
    checks: dict = {}

    # Check Gemini API key
    key_ok = bool(settings.gemini_api_key)
    checks["gemini_api_key_configured"] = key_ok

    # Check model config
    checks["gemini_model"] = settings.gemini_model or "NOT SET"

    ready = key_ok

    return ReadinessResponse(ready=ready, checks=checks)
