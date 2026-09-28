"""New backend features: category policies (downgrade/block), token reduction,
rate limiting and cost report exports (CSV/PDF)."""

import csv
import dataclasses
import io
from datetime import timedelta
from decimal import Decimal

import pytest

from app.catalog import get_catalog
from app.config import settings
from app.models import AuditRecord
from app.services import context_reduction, timeutil

from .conftest import HEADERS

pytestmark = pytest.mark.asyncio

CODE_PROMPT = (
    "Necesito una función:\n```python\ndef suma(a, b):\n    return a + b\n```\n"
    "Refactorízala para aceptar una lista."
)


# ------------- 1. Per-consumer category policies (soft + hard) ------------ #
async def test_marketing_code_generation_is_downgraded_to_misc(client, mock_providers):
    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={"model": "auto", "messages": [{"role": "user", "content": CODE_PROMPT}]},
    )
    # Soft policy: the request is served, not rejected.
    assert resp.status_code == 200

    listing = await client.get("/dashboard/usage/requests", headers=HEADERS["admin"])
    row = listing.json()["items"][0]
    assert row["consumer"] == "equipo-marketing"
    assert row["category"] == "misc"
    assert row["original_category"] == "code_generation"
    assert row["category_source"] == "policy_downgrade"
    assert row["status"] == "completed"
    # Routed to the misc route, i.e. cheap/simple models.
    misc_model = get_catalog().model_for_route("misc", row["complexity_tier"])
    assert row["selected_model"] == misc_model.model

    # Informative alert (deduplicated hourly).
    alerts = await client.get(
        "/dashboard/alerts?type=category_downgraded", headers=HEADERS["admin"]
    )
    assert len(alerts.json()["items"]) == 1


async def test_category_downgrade_applies_to_streaming(client, mock_providers):
    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={
            "model": "auto",
            "messages": [{"role": "user", "content": CODE_PROMPT}],
            "stream": True,
        },
    )
    assert resp.status_code == 200

    listing = await client.get("/dashboard/usage/requests", headers=HEADERS["admin"])
    row = listing.json()["items"][0]
    assert row["category"] == "misc"
    assert row["original_category"] == "code_generation"


async def test_other_consumers_keep_code_generation_untouched(client, mock_providers):
    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["producto"],
        json={"model": "auto", "messages": [{"role": "user", "content": CODE_PROMPT}]},
    )
    assert resp.status_code == 200
    listing = await client.get("/dashboard/usage/requests", headers=HEADERS["producto"])
    row = listing.json()["items"][0]
    assert row["category"] == "code_generation"
    assert row["original_category"] is None


async def test_category_policies_loaded_from_config():
    catalog = get_catalog()
    assert catalog.category_downgrade_for("equipo-marketing", "code_generation") == "misc"
    assert catalog.category_downgrade_for("equipo-producto", "code_generation") is None
    # No consumer uses the hard block in the demo config.
    assert catalog.blocked_categories("equipo-marketing") == ()


async def test_hard_blocked_category_still_returns_403(client, mock_providers):
    """The hard-block path (blocked_categories) remains available via config."""
    catalog = get_catalog()
    original = catalog.budgets["equipo-marketing"]
    catalog.budgets["equipo-marketing"] = dataclasses.replace(
        original,
        blocked_categories=("code_generation",),
        category_downgrades={},
    )
    try:
        resp = await client.post(
            "/v1/chat/completions",
            headers=HEADERS["marketing"],
            json={
                "model": "auto",
                "messages": [{"role": "user", "content": CODE_PROMPT}],
            },
        )
        assert resp.status_code == 403
        body = resp.json()
        assert body["error"]["code"] == "blocked_category"
        assert "code_generation" in body["error"]["message"]

        listing = await client.get(
            "/dashboard/usage/requests?status=blocked", headers=HEADERS["admin"]
        )
        rows = listing.json()["items"]
        assert len(rows) == 1
        assert rows[0]["error_code"] == "blocked_category"
    finally:
        catalog.budgets["equipo-marketing"] = original


# ---------------------- 2. Token reduction (context) ---------------------- #
def _long_conversation(turns: int = 12) -> list[dict]:
    base = (
        "Contexto de la reunión de producto: repasamos métricas de activación, "
        "el funnel de onboarding y los blockers del release. "
    )
    messages = [{"role": "system", "content": "Eres un asistente interno de la empresa."}]
    for i in range(turns):
        role = "user" if i % 2 == 0 else "assistant"
        messages.append({"role": role, "content": f"{base} Detalle del turno {i}. " * 4})
    messages.append({"role": "user", "content": "Resume los próximos pasos en tres frases."})
    return messages


async def test_context_reduction_keeps_system_and_recent(mock_providers, monkeypatch):
    monkeypatch.setattr(settings, "token_reduction_max_context_tokens", 150)
    monkeypatch.setattr(settings, "token_reduction_keep_recent_messages", 3)

    messages = _long_conversation()
    result = await context_reduction.maybe_reduce(get_catalog(), messages)

    assert result.reduced is True
    assert result.tokens_saved > 0
    # Original system message preserved, summary inserted right after it.
    assert result.messages[0] == messages[0]
    assert result.messages[1]["role"] == "system"
    assert context_reduction.SUMMARY_PREFIX in result.messages[1]["content"]
    # The 3 most recent conversation messages are intact.
    assert result.messages[-3:] == messages[-3:]
    assert len(result.messages) == 5


async def test_context_reduction_skips_short_conversations(mock_providers):
    messages = [{"role": "user", "content": "hola"}]
    result = await context_reduction.maybe_reduce(get_catalog(), messages)
    assert result.reduced is False
    assert result.messages == messages


async def test_context_reduction_recorded_in_audit(client, mock_providers, monkeypatch):
    monkeypatch.setattr(settings, "token_reduction_max_context_tokens", 150)
    monkeypatch.setattr(settings, "token_reduction_keep_recent_messages", 3)

    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["atencion"],
        json={"model": "auto", "messages": _long_conversation()},
    )
    assert resp.status_code == 200

    listing = await client.get("/dashboard/usage/requests", headers=HEADERS["atencion"])
    row = listing.json()["items"][0]
    assert row["context_reduced"] is True
    assert row["context_tokens_saved"] > 0
    assert row["status"] == "completed"


async def test_context_reduction_disabled_via_setting(client, mock_providers, monkeypatch):
    monkeypatch.setattr(settings, "token_reduction_enabled", False)
    monkeypatch.setattr(settings, "token_reduction_max_context_tokens", 150)

    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["atencion"],
        json={"model": "auto", "messages": _long_conversation()},
    )
    assert resp.status_code == 200
    listing = await client.get("/dashboard/usage/requests", headers=HEADERS["atencion"])
    row = listing.json()["items"][0]
    assert row["context_reduced"] is False
    assert row["context_tokens_saved"] is None


# ------------------- 3. Rate limiting (tokens / window) ------------------- #
async def test_rate_limit_returns_429_and_audits(client, mock_providers, monkeypatch):
    # misc default max_tokens = 300, so one request estimates ~305 tokens: the
    # first fits in a 400-token window, the second must be rejected.
    monkeypatch.setattr(settings, "rate_limit_default_tokens_per_minute", 400)

    first = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["atencion"],
        json={"model": "auto", "messages": [{"role": "user", "content": "hola equipo"}]},
    )
    assert first.status_code == 200

    second = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["atencion"],
        json={
            "model": "auto",
            "messages": [{"role": "user", "content": "otra consulta distinta"}],
        },
    )
    assert second.status_code == 429
    body = second.json()
    assert body["error"]["code"] == "rate_limited"
    assert body["error"]["type"] == "rate_limit_error"
    assert "equipo-atencion-cliente" in body["error"]["message"]

    listing = await client.get("/dashboard/usage/requests?status=blocked", headers=HEADERS["admin"])
    rows = listing.json()["items"]
    assert len(rows) == 1
    assert rows[0]["error_code"] == "rate_limited"

    alerts = await client.get("/dashboard/alerts?type=rate_limited", headers=HEADERS["admin"])
    assert len(alerts.json()["items"]) == 1


async def test_rate_limit_is_per_consumer(client, mock_providers, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_default_tokens_per_minute", 400)

    first = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["atencion"],
        json={"model": "auto", "messages": [{"role": "user", "content": "hola"}]},
    )
    assert first.status_code == 200
    blocked = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["atencion"],
        json={"model": "auto", "messages": [{"role": "user", "content": "hola otra vez"}]},
    )
    assert blocked.status_code == 429

    # A different consumer has its own window.
    other = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["producto"],
        json={"model": "auto", "messages": [{"role": "user", "content": "hola"}]},
    )
    assert other.status_code == 200


async def test_rate_limit_disabled_via_setting(client, mock_providers, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    monkeypatch.setattr(settings, "rate_limit_default_tokens_per_minute", 1)

    for _ in range(3):
        resp = await client.post(
            "/v1/chat/completions",
            headers=HEADERS["atencion"],
            json={"model": "auto", "messages": [{"role": "user", "content": "hola"}]},
        )
        assert resp.status_code == 200


# ----------------------- 4. Cost report exports --------------------------- #
def _audit_row(
    consumer: str,
    *,
    hours_ago: float,
    cost: str,
    category: str = "misc",
    status: str = "completed",
    action: str = "allow",
) -> AuditRecord:
    started = timeutil.now_utc() - timedelta(hours=hours_ago)
    return AuditRecord(
        timestamp_started=started,
        timestamp_completed=started,
        api_key_id=f"key_{consumer}",
        api_key_prefix="finops_key_...",
        consumer=consumer,
        role="consumer",
        requested_model="auto",
        category=category,
        selected_provider="tabbyapi",
        selected_model="gemma-4-12B-it-exl3",
        actual_prompt_tokens=100,
        actual_output_tokens=50,
        budget_charge=Decimal(cost),
        budget_action=action,
        status=status,
        latency_ms=800,
    )


async def _seed_report_rows(session):
    session.add(_audit_row("equipo-marketing", hours_ago=1, cost="0.02"))
    session.add(
        _audit_row(
            "equipo-marketing",
            hours_ago=2,
            cost="0",
            status="semantic_cache_hit",
            action="allow",
        )
    )
    session.add(
        _audit_row(
            "equipo-producto",
            hours_ago=3,
            cost="0.05",
            category="code_generation",
            status="degraded",
            action="degraded",
        )
    )
    session.add(_audit_row("equipo-producto", hours_ago=100, cost="0.90"))
    await session.commit()


async def test_csv_report_admin_all_consumers(client, session):
    await _seed_report_rows(session)
    resp = await client.get("/dashboard/reports/costs.csv", headers=HEADERS["admin"])
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    assert "attachment" in resp.headers["content-disposition"]
    assert ".csv" in resp.headers["content-disposition"]

    rows = list(csv.DictReader(io.StringIO(resp.text)))
    assert len(rows) == 4  # default range is the last 30 days
    consumers = {r["consumer"] for r in rows}
    assert consumers == {"equipo-marketing", "equipo-producto"}
    cached = [r for r in rows if r["action"] == "cached"]
    assert len(cached) == 1
    degraded = [r for r in rows if r["action"] == "degraded"]
    assert degraded[0]["category"] == "code_generation"
    assert degraded[0]["total_tokens"] == "150"
    assert float(degraded[0]["cost_usd"]) == pytest.approx(0.05)


async def test_csv_report_filters_consumer_and_dates(client, session):
    await _seed_report_rows(session)
    start = (timeutil.now_utc() - timedelta(hours=6)).strftime("%Y-%m-%d")
    resp = await client.get(
        f"/dashboard/reports/costs.csv?consumer=equipo-producto&start_date={start}",
        headers=HEADERS["admin"],
    )
    rows = list(csv.DictReader(io.StringIO(resp.text)))
    # The 100h-old producto row is out of range.
    assert len(rows) == 1
    assert rows[0]["consumer"] == "equipo-producto"


async def test_csv_report_consumer_scope_is_enforced(client, session):
    await _seed_report_rows(session)
    own = await client.get("/dashboard/reports/costs.csv", headers=HEADERS["marketing"])
    rows = list(csv.DictReader(io.StringIO(own.text)))
    assert {r["consumer"] for r in rows} == {"equipo-marketing"}

    other = await client.get(
        "/dashboard/reports/costs.csv?consumer=equipo-producto",
        headers=HEADERS["marketing"],
    )
    assert other.status_code == 403
    assert other.json()["error"]["code"] == "forbidden_scope"


async def test_csv_report_invalid_date_is_rejected(client):
    resp = await client.get(
        "/dashboard/reports/costs.csv?start_date=not-a-date",
        headers=HEADERS["admin"],
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "validation_error"


async def test_pdf_report_download(client, session):
    await _seed_report_rows(session)
    resp = await client.get("/dashboard/reports/costs.pdf", headers=HEADERS["admin"])
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert "attachment" in resp.headers["content-disposition"]
    assert resp.content.startswith(b"%PDF")
    assert len(resp.content) > 1000
