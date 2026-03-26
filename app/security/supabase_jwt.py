"""
app/security/supabase_jwt.py – Supabase JWT verification dependency.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwk, jwt

from app.config import settings

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)
_jwks_lock = threading.Lock()
_jwks_cache: dict[str, Any] = {"expires_at": 0.0, "jwks": None}
_ALLOWED_JWT_ALGORITHMS = {"ES256", "RS256"}


@dataclass(frozen=True)
class AuthenticatedUser:
    user_id: str
    email: str | None
    role: str | None
    claims: dict[str, Any]
    access_token: str | None = None


def _jwt_issuer() -> str:
    return f"{settings.supabase_url.rstrip('/')}/auth/v1"


def _jwks_url() -> str:
    return f"{_jwt_issuer()}/.well-known/jwks.json"


def _fetch_jwks() -> dict[str, Any]:
    try:
        with urlopen(_jwks_url(), timeout=5) as response:
            payload = response.read().decode("utf-8")
            data = json.loads(payload)
            if not isinstance(data, dict) or not isinstance(data.get("keys"), list):
                raise ValueError("Invalid JWKS payload format")
            return data
    except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not load JWT verification keys from Supabase.",
        ) from exc


def _get_jwks_cached() -> dict[str, Any]:
    now = time.time()
    cached = _jwks_cache.get("jwks")
    expires_at = float(_jwks_cache.get("expires_at", 0.0))
    if cached and now < expires_at:
        return cached

    with _jwks_lock:
        now = time.time()
        cached = _jwks_cache.get("jwks")
        expires_at = float(_jwks_cache.get("expires_at", 0.0))
        if cached and now < expires_at:
            return cached
        jwks_payload = _fetch_jwks()
        _jwks_cache["jwks"] = jwks_payload
        _jwks_cache["expires_at"] = now + max(settings.auth_jwks_cache_seconds, 30)
        return jwks_payload


def _get_matching_jwk(kid: str) -> dict[str, Any]:
    keys = _get_jwks_cached().get("keys", [])
    for candidate in keys:
        if isinstance(candidate, dict) and candidate.get("kid") == kid:
            return candidate
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication token.",
    )


def _decode_access_token(token: str) -> dict[str, Any]:
    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        ) from exc

    alg = str(header.get("alg", "")).strip()
    if alg not in _ALLOWED_JWT_ALGORITHMS:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        )

    kid = str(header.get("kid", "")).strip()
    if not kid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        )

    jwk_payload = _get_matching_jwk(kid)
    public_key = jwk.construct(jwk_payload)

    try:
        claims = jwt.decode(
            token,
            public_key,
            algorithms=[alg],
            issuer=_jwt_issuer(),
            options={"verify_aud": False},
        )
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication expired or invalid.",
        ) from exc

    if claims.get("role") != "authenticated" or not claims.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authenticated user token required.",
        )
    return claims


def _require_supabase_config() -> None:
    if settings.auth_required and not settings.supabase_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Auth is enabled but SUPABASE_URL is not configured.",
        )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AuthenticatedUser:
    if not settings.auth_required:
        return AuthenticatedUser(user_id="dev-user", email=None, role="dev", claims={}, access_token=None)

    _require_supabase_config()
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
        )

    claims = _decode_access_token(credentials.credentials)
    return AuthenticatedUser(
        user_id=str(claims["sub"]),
        email=claims.get("email"),
        role=claims.get("role"),
        claims=claims,
        access_token=credentials.credentials,
    )


def require_authenticated_user(
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
) -> AuthenticatedUser:
    request.state.user_id = user.user_id
    request.state.user_email = user.email
    request.state.access_token = user.access_token
    return user

