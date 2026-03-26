"""
Persistent storage for agent learning, experiments, and observability.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.config import settings

logger = logging.getLogger(__name__)


class AgentStore:
    def __init__(self, db_path: str) -> None:
        self._db_path = Path(db_path)
        if not self._db_path.is_absolute():
            self._db_path = Path.cwd() / self._db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._supabase_rest_url = (
            f"{settings.supabase_url.rstrip('/')}/rest/v1" if settings.supabase_url else ""
        )
        self._supabase_anon_key = settings.supabase_anon_key.strip()
        self._supabase_enabled = bool(self._supabase_rest_url and self._supabase_anon_key)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.executescript(
                    """
                    PRAGMA journal_mode = WAL;
                    CREATE TABLE IF NOT EXISTS outcomes (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        campaign_name TEXT NOT NULL,
                        prompt TEXT NOT NULL,
                        audience TEXT NOT NULL,
                        subject TEXT NOT NULL,
                        cta TEXT NOT NULL,
                        open_rate REAL,
                        click_rate REAL,
                        conversion_rate REAL,
                        language TEXT NOT NULL,
                        segment TEXT NOT NULL,
                        notes TEXT NOT NULL,
                        score INTEGER NOT NULL,
                        created_at TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS outcomes_user_created_idx
                        ON outcomes (user_id, created_at DESC);

                    CREATE TABLE IF NOT EXISTS experiments (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        name TEXT NOT NULL,
                        metric TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS experiments_user_created_idx
                        ON experiments (user_id, created_at DESC);

                    CREATE TABLE IF NOT EXISTS experiment_variants (
                        experiment_id TEXT NOT NULL,
                        variant TEXT NOT NULL,
                        impressions INTEGER NOT NULL DEFAULT 0,
                        clicks INTEGER NOT NULL DEFAULT 0,
                        conversions INTEGER NOT NULL DEFAULT 0,
                        PRIMARY KEY (experiment_id, variant),
                        FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS agent_metrics (
                        user_id TEXT NOT NULL,
                        agent TEXT NOT NULL,
                        calls INTEGER NOT NULL DEFAULT 0,
                        success INTEGER NOT NULL DEFAULT 0,
                        fallback INTEGER NOT NULL DEFAULT 0,
                        latency_total_ms REAL NOT NULL DEFAULT 0,
                        PRIMARY KEY (user_id, agent)
                    );
                    """
                )
                conn.commit()
            finally:
                conn.close()

    def _supabase_headers(self, access_token: str | None, include_json: bool = True) -> dict[str, str]:
        headers = {
            "apikey": self._supabase_anon_key,
        }
        if include_json:
            headers["Content-Type"] = "application/json"
        if access_token:
            headers["Authorization"] = f"Bearer {access_token}"
        return headers

    def _supabase_request(
        self,
        method: str,
        path: str,
        *,
        access_token: str | None,
        query: dict[str, str] | None = None,
        payload: Any = None,
        include_json_header: bool = True,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        if not self._supabase_enabled:
            raise RuntimeError("Supabase persistence is not configured.")
        qs = f"?{urlencode(query)}" if query else ""
        url = f"{self._supabase_rest_url}/{path}{qs}"
        body: bytes | None = None
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
        headers = self._supabase_headers(access_token, include_json=include_json_header)
        if extra_headers:
            headers.update(extra_headers)
        request = Request(
            url=url,
            method=method,
            data=body,
            headers=headers,
        )
        try:
            with urlopen(request, timeout=10) as response:
                raw = response.read().decode("utf-8")
                if not raw:
                    return None
                try:
                    return json.loads(raw)
                except json.JSONDecodeError:
                    return raw
        except HTTPError as exc:
            detail = ""
            try:
                detail = exc.read().decode("utf-8")
            except Exception:
                detail = str(exc)
            raise RuntimeError(f"Supabase request failed: {exc.code} {detail}") from exc
        except (URLError, TimeoutError) as exc:
            raise RuntimeError(f"Supabase request failed: {exc}") from exc

    def _maybe_supabase(self, access_token: str | None) -> bool:
        return self._supabase_enabled and bool(access_token)

    def reset_for_tests(self) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.executescript(
                    """
                    DELETE FROM experiment_variants;
                    DELETE FROM experiments;
                    DELETE FROM outcomes;
                    DELETE FROM agent_metrics;
                    """
                )
                conn.commit()
            finally:
                conn.close()

    def record_outcome(
        self,
        user_id: str,
        row: dict[str, Any],
        max_history: int,
        access_token: str | None = None,
    ) -> int:
        if self._maybe_supabase(access_token):
            try:
                data = {
                    "id": row.get("id") or str(uuid.uuid4()),
                    "user_id": user_id,
                    "campaign_name": row.get("campaign_name", ""),
                    "prompt": row.get("prompt", ""),
                    "audience": row.get("audience", ""),
                    "subject": row.get("subject", ""),
                    "cta": row.get("cta", ""),
                    "open_rate": row.get("open_rate"),
                    "click_rate": row.get("click_rate"),
                    "conversion_rate": row.get("conversion_rate"),
                    "language": row.get("language", ""),
                    "segment": row.get("segment", ""),
                    "notes": row.get("notes", ""),
                    "score": int(row.get("score") or 0),
                }
                self._supabase_request(
                    "POST",
                    "agent_outcomes",
                    access_token=access_token,
                    query={"select": "id"},
                    payload=data,
                )
                older_rows = self._supabase_request(
                    "GET",
                    "agent_outcomes",
                    access_token=access_token,
                    query={
                        "user_id": f"eq.{user_id}",
                        "select": "id",
                        "order": "created_at.desc",
                        "offset": str(max_history),
                    },
                    include_json_header=False,
                ) or []
                ids_to_delete = [
                    str(item.get("id", "")).strip() for item in older_rows if str(item.get("id", "")).strip()
                ]
                if ids_to_delete:
                    in_clause = ",".join(ids_to_delete)
                    self._supabase_request(
                        "DELETE",
                        "agent_outcomes",
                        access_token=access_token,
                        query={"user_id": f"eq.{user_id}", "id": f"in.({in_clause})"},
                        include_json_header=False,
                    )
                count_rows = self._supabase_request(
                    "GET",
                    "agent_outcomes",
                    access_token=access_token,
                    query={"user_id": f"eq.{user_id}", "select": "id"},
                    include_json_header=False,
                ) or []
                return len(count_rows)
            except Exception:
                logger.exception("Supabase outcomes persistence failed; falling back to local store")

        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO outcomes (
                        id, user_id, campaign_name, prompt, audience, subject, cta,
                        open_rate, click_rate, conversion_rate, language, segment, notes, score
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        row.get("id") or str(uuid.uuid4()),
                        user_id,
                        row.get("campaign_name", ""),
                        row.get("prompt", ""),
                        row.get("audience", ""),
                        row.get("subject", ""),
                        row.get("cta", ""),
                        row.get("open_rate"),
                        row.get("click_rate"),
                        row.get("conversion_rate"),
                        row.get("language", ""),
                        row.get("segment", ""),
                        row.get("notes", ""),
                        int(row.get("score") or 0),
                    ),
                )

                count_row = conn.execute(
                    "SELECT COUNT(1) AS count FROM outcomes WHERE user_id = ?",
                    (user_id,),
                ).fetchone()
                total = int(count_row["count"]) if count_row else 0
                if total > max_history:
                    prune = total - max_history
                    conn.execute(
                        """
                        DELETE FROM outcomes
                        WHERE id IN (
                            SELECT id
                            FROM outcomes
                            WHERE user_id = ?
                            ORDER BY created_at ASC
                            LIMIT ?
                        )
                        """,
                        (user_id, prune),
                    )
                    total = max_history
                conn.commit()
                return total
            finally:
                conn.close()

    def list_outcomes(self, user_id: str, access_token: str | None = None) -> list[dict[str, Any]]:
        if self._maybe_supabase(access_token):
            try:
                rows = self._supabase_request(
                    "GET",
                    "agent_outcomes",
                    access_token=access_token,
                    query={
                        "user_id": f"eq.{user_id}",
                        "select": "id,campaign_name,prompt,audience,subject,cta,open_rate,click_rate,conversion_rate,language,segment,notes,score",
                        "order": "created_at.desc",
                        "limit": "500",
                    },
                    include_json_header=False,
                ) or []
                return [dict(item) for item in rows]
            except Exception:
                logger.exception("Supabase outcomes read failed; falling back to local store")

        with self._lock:
            conn = self._connect()
            try:
                rows = conn.execute(
                    """
                    SELECT id, campaign_name, prompt, audience, subject, cta, open_rate, click_rate,
                           conversion_rate, language, segment, notes, score
                    FROM outcomes
                    WHERE user_id = ?
                    ORDER BY created_at DESC
                    """,
                    (user_id,),
                ).fetchall()
                return [dict(row) for row in rows]
            finally:
                conn.close()

    def start_experiment(
        self,
        user_id: str,
        experiment_id: str,
        name: str,
        metric: str,
        variants: list[str],
        access_token: str | None = None,
    ) -> dict[str, Any]:
        if self._maybe_supabase(access_token):
            try:
                self._supabase_request(
                    "POST",
                    "agent_experiments",
                    access_token=access_token,
                    query={"select": "id"},
                    payload={
                        "id": experiment_id,
                        "user_id": user_id,
                        "name": name,
                        "metric": metric,
                    },
                )
                variant_rows = [
                    {
                        "experiment_id": experiment_id,
                        "variant": variant,
                        "impressions": 0,
                        "clicks": 0,
                        "conversions": 0,
                    }
                    for variant in variants
                ]
                if variant_rows:
                    self._supabase_request(
                        "POST",
                        "agent_experiment_variants",
                        access_token=access_token,
                        query={"select": "variant"},
                        payload=variant_rows,
                    )
                return {"id": experiment_id, "metric": metric, "variants": variants}
            except Exception:
                logger.exception("Supabase experiment start failed; falling back to local store")

        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    "INSERT INTO experiments (id, user_id, name, metric) VALUES (?, ?, ?, ?)",
                    (experiment_id, user_id, name, metric),
                )
                for variant in variants:
                    conn.execute(
                        """
                        INSERT INTO experiment_variants (experiment_id, variant, impressions, clicks, conversions)
                        VALUES (?, ?, 0, 0, 0)
                        """,
                        (experiment_id, variant),
                    )
                conn.commit()
                return {"id": experiment_id, "metric": metric, "variants": variants}
            finally:
                conn.close()

    def record_experiment_sample(
        self,
        user_id: str,
        experiment_id: str,
        variant: str,
        impressions: int,
        clicks: int,
        conversions: int,
        access_token: str | None = None,
    ) -> dict[str, Any] | None:
        if self._maybe_supabase(access_token):
            try:
                experiment_rows = self._supabase_request(
                    "GET",
                    "agent_experiments",
                    access_token=access_token,
                    query={"id": f"eq.{experiment_id}", "user_id": f"eq.{user_id}", "select": "id,metric"},
                    include_json_header=False,
                ) or []
                if not experiment_rows:
                    return None
                experiment = experiment_rows[0]
                variant_rows = self._supabase_request(
                    "GET",
                    "agent_experiment_variants",
                    access_token=access_token,
                    query={
                        "experiment_id": f"eq.{experiment_id}",
                        "variant": f"eq.{variant}",
                        "select": "variant,impressions,clicks,conversions",
                    },
                    include_json_header=False,
                ) or []
                if not variant_rows:
                    return {"error": "variant_not_found"}
                current = variant_rows[0]
                updated = {
                    "impressions": int(current.get("impressions") or 0) + impressions,
                    "clicks": int(current.get("clicks") or 0) + clicks,
                    "conversions": int(current.get("conversions") or 0) + conversions,
                }
                self._supabase_request(
                    "PATCH",
                    "agent_experiment_variants",
                    access_token=access_token,
                    query={"experiment_id": f"eq.{experiment_id}", "variant": f"eq.{variant}", "select": "variant"},
                    payload=updated,
                )
                all_rows = self._supabase_request(
                    "GET",
                    "agent_experiment_variants",
                    access_token=access_token,
                    query={"experiment_id": f"eq.{experiment_id}", "select": "variant,impressions,clicks,conversions"},
                    include_json_header=False,
                ) or []
                return {
                    "id": experiment_id,
                    "metric": str(experiment.get("metric", "click_rate")),
                    "variants": [dict(row) for row in all_rows],
                }
            except Exception:
                logger.exception("Supabase experiment record failed; falling back to local store")

        with self._lock:
            conn = self._connect()
            try:
                experiment = conn.execute(
                    "SELECT id, metric FROM experiments WHERE id = ? AND user_id = ?",
                    (experiment_id, user_id),
                ).fetchone()
                if experiment is None:
                    return None
                found_variant = conn.execute(
                    "SELECT variant FROM experiment_variants WHERE experiment_id = ? AND variant = ?",
                    (experiment_id, variant),
                ).fetchone()
                if found_variant is None:
                    return {"error": "variant_not_found"}

                conn.execute(
                    """
                    UPDATE experiment_variants
                    SET impressions = impressions + ?,
                        clicks = clicks + ?,
                        conversions = conversions + ?
                    WHERE experiment_id = ? AND variant = ?
                    """,
                    (impressions, clicks, conversions, experiment_id, variant),
                )
                rows = conn.execute(
                    """
                    SELECT variant, impressions, clicks, conversions
                    FROM experiment_variants
                    WHERE experiment_id = ?
                    """,
                    (experiment_id,),
                ).fetchall()
                conn.commit()
                return {
                    "id": experiment_id,
                    "metric": str(experiment["metric"]),
                    "variants": [dict(row) for row in rows],
                }
            finally:
                conn.close()

    def track_agent(
        self,
        user_id: str,
        agent: str,
        status: str,
        latency_ms: float,
        access_token: str | None = None,
    ) -> None:
        if self._maybe_supabase(access_token):
            try:
                rows = self._supabase_request(
                    "GET",
                    "agent_metrics",
                    access_token=access_token,
                    query={
                        "user_id": f"eq.{user_id}",
                        "agent": f"eq.{agent}",
                        "select": "calls,success,fallback,latency_total_ms",
                    },
                    include_json_header=False,
                ) or []
                current = rows[0] if rows else {"calls": 0, "success": 0, "fallback": 0, "latency_total_ms": 0.0}
                data = {
                    "user_id": user_id,
                    "agent": agent,
                    "calls": int(current.get("calls") or 0) + 1,
                    "success": int(current.get("success") or 0) + (1 if status == "success" else 0),
                    "fallback": int(current.get("fallback") or 0) + (1 if status == "fallback" else 0),
                    "latency_total_ms": float(current.get("latency_total_ms") or 0.0) + max(0.0, latency_ms),
                }
                self._supabase_request(
                    "POST",
                    "agent_metrics",
                    access_token=access_token,
                    query={"on_conflict": "user_id,agent", "select": "agent"},
                    payload=data,
                    extra_headers={"Prefer": "resolution=merge-duplicates"},
                )
                return
            except Exception:
                logger.exception("Supabase metrics tracking failed; falling back to local store")

        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO agent_metrics (user_id, agent, calls, success, fallback, latency_total_ms)
                    VALUES (?, ?, 0, 0, 0, 0)
                    ON CONFLICT(user_id, agent) DO NOTHING
                    """,
                    (user_id, agent),
                )
                success_inc = 1 if status == "success" else 0
                fallback_inc = 1 if status == "fallback" else 0
                conn.execute(
                    """
                    UPDATE agent_metrics
                    SET calls = calls + 1,
                        success = success + ?,
                        fallback = fallback + ?,
                        latency_total_ms = latency_total_ms + ?
                    WHERE user_id = ? AND agent = ?
                    """,
                    (success_inc, fallback_inc, max(0.0, latency_ms), user_id, agent),
                )
                conn.commit()
            finally:
                conn.close()

    def get_agent_metrics(self, user_id: str, access_token: str | None = None) -> list[dict[str, Any]]:
        if self._maybe_supabase(access_token):
            try:
                rows = self._supabase_request(
                    "GET",
                    "agent_metrics",
                    access_token=access_token,
                    query={
                        "user_id": f"eq.{user_id}",
                        "select": "agent,calls,success,fallback,latency_total_ms",
                        "order": "calls.desc",
                    },
                    include_json_header=False,
                ) or []
                return [dict(row) for row in rows]
            except Exception:
                logger.exception("Supabase metrics read failed; falling back to local store")

        with self._lock:
            conn = self._connect()
            try:
                rows = conn.execute(
                    """
                    SELECT agent, calls, success, fallback, latency_total_ms
                    FROM agent_metrics
                    WHERE user_id = ?
                    ORDER BY calls DESC
                    """,
                    (user_id,),
                ).fetchall()
                return [dict(row) for row in rows]
            finally:
                conn.close()


agent_store = AgentStore(settings.agent_store_path)
