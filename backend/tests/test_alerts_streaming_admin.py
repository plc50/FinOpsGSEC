"""Steps 11/12/13 — alerts triggers (§16), streaming (§11), admin explicit (§9.2)."""
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models import Alert, AuditRecord
from app.services import aggregation

from .conftest import HEADERS

pytestmark = pytest.mark.asyncio


# ------------------------- alerts (§16.1) ------------------------- #
async def test_blocked_request_emits_alerts(client, mock_providers):
    await client.post(
        "/dashboard/budgets/equipo-marketing",
        headers=HEADERS["admin"],
        json={"budget": 0.00001, "warning_threshold": 0.8},
    )
    await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={"model": "auto", "messages": [{"role": "user", "content": "hola"}]},
    )
    resp = await client.get("/dashboard/alerts", headers=HEADERS["marketing"])
    types = {a["type"] for a in resp.json()["items"]}
    assert "budget_exceeded" in types
    assert "request_blocked" in types


async def test_model_degraded_alert(client, mock_providers, session):
    from app.models import Budget

    session.add(Budget(consumer="equipo-producto", budget=Decimal("1.0")))
    session.add(
        AuditRecord(
            timestamp_started=datetime.now(tz=timezone.utc),
            api_key_id="key_producto",
            api_key_prefix="finops_key_...",
            consumer="equipo-producto",
            role="consumer",
            requested_model="auto",
            budget_charge=Decimal("0.85"),
            status="completed",
            budget_action="allow",
        )
    )
    await session.commit()

    prior = [
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i}"}
        for i in range(14)
    ]
    code = "```python\n" + "\n".join(f"a{i}={i}" for i in range(60)) + "\n```"
    messages = prior + [{"role": "user", "content": f"Refactor:\n{code}"}]
    await client.post(
        "/v1/chat/completions",
        headers=HEADERS["producto"],
        json={"model": "auto", "messages": messages},
    )
    resp = await client.get(
        "/dashboard/alerts?consumer=equipo-producto", headers=HEADERS["admin"]
    )
    types = {a["type"] for a in resp.json()["items"]}
    assert "model_degraded" in types


async def test_cost_spike_alert(session):
    now = datetime.now(tz=timezone.utc).replace(minute=0, second=0, microsecond=0)

    def rec(hours_ago, charge):
        return AuditRecord(
            timestamp_started=now - timedelta(hours=hours_ago, minutes=-1),
            timestamp_completed=now - timedelta(hours=hours_ago),
            api_key_id="k",
            api_key_prefix="finops_key_...",
            consumer="equipo-marketing",
            role="consumer",
            requested_model="auto",
            category="misc",
            selected_provider="tabbyapi",
            selected_model="gemma-4-12B-it-exl3",
            actual_model_cost=Decimal(str(charge)),
            backend_cost=Decimal("0"),
            routing_overhead_cost=Decimal("0"),
            budget_charge=Decimal(str(charge)),
            budget_action="allow",
            status="completed",
            latency_ms=100,
        )

    # Low baseline for several hours, big spike in the current hour.
    session.add_all([rec(3, 0.001), rec(2, 0.001), rec(0, 0.5)])
    await session.commit()
    await aggregation.rebuild_usage_hourly(session)

    rows = (
        await session.execute(select(Alert).where(Alert.type == "cost_spike"))
    ).scalars().all()
    assert len(rows) >= 1


# ------------------------- streaming (§11) ------------------------- #
async def test_streaming_completion(client, mock_providers):
    async with client.stream(
        "POST",
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={
            "model": "auto",
            "messages": [{"role": "user", "content": "cuéntame algo"}],
            "stream": True,
        },
    ) as resp:
        assert resp.status_code == 200
        chunks = []
        async for line in resp.aiter_lines():
            if line.startswith("data:"):
                payload = line[len("data:"):].strip()
                if payload and payload != "[DONE]":
                    chunks.append(json.loads(payload))
    assert chunks
    assert chunks[0]["object"] == "chat.completion.chunk"

    listing = await client.get(
        "/dashboard/usage/requests", headers=HEADERS["marketing"]
    )
    row = listing.json()["items"][0]
    assert row["stream"] is True
    assert row["status"] == "completed"


async def test_streaming_blocked_returns_429(client, mock_providers):
    await client.post(
        "/dashboard/budgets/equipo-marketing",
        headers=HEADERS["admin"],
        json={"budget": 0.00001, "warning_threshold": 0.8},
    )
    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={
            "model": "auto",
            "messages": [{"role": "user", "content": "hola"}],
            "stream": True,
        },
    )
    assert resp.status_code == 429
    assert resp.json()["error"]["code"] == "budget_exceeded"


# ------------------------- admin explicit model (§9.2) ------------------------- #
async def test_admin_explicit_model(client, mock_providers):
    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["admin"],
        json={
            "model": "openrouter/anthropic/claude-sonnet-5",
            "messages": [{"role": "user", "content": "hola"}],
        },
    )
    assert resp.status_code == 200
    assert resp.json()["model"] == "openrouter/anthropic/claude-sonnet-5"


async def test_admin_explicit_unknown_model(client, mock_providers):
    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["admin"],
        json={
            "model": "nonexistent/model-x",
            "messages": [{"role": "user", "content": "hola"}],
        },
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "no_compatible_model"
