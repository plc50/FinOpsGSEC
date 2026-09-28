"""Step 3 — /v1/models + error contract (§2.1, §4)."""
import pytest

from .conftest import HEADERS

pytestmark = pytest.mark.asyncio


async def test_missing_api_key(client):
    resp = await client.get("/v1/models")
    assert resp.status_code == 401
    body = resp.json()
    assert body["error"]["code"] == "missing_api_key"
    assert body["error"]["type"] == "invalid_request_error"
    assert body["error"]["param"] is None


async def test_invalid_api_key(client):
    resp = await client.get("/v1/models", headers={"Authorization": "Bearer nope"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "invalid_api_key"


async def test_models_consumer_only_auto(client):
    resp = await client.get("/v1/models", headers=HEADERS["marketing"])
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data == [{"id": "auto", "object": "model", "owned_by": "finops-proxy"}]


async def test_models_admin_includes_explicit(client):
    resp = await client.get("/v1/models", headers=HEADERS["admin"])
    assert resp.status_code == 200
    ids = [m["id"] for m in resp.json()["data"]]
    assert "auto" in ids
    assert "openrouter/anthropic/claude-sonnet-5" in ids
    owned = {m["id"]: m["owned_by"] for m in resp.json()["data"]}
    assert owned["auto"] == "finops-proxy"
    assert owned["openrouter/anthropic/claude-sonnet-5"] == "openrouter"


async def test_explicit_model_forbidden_for_consumer(client, mock_providers):
    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={
            "model": "openrouter/anthropic/claude-sonnet-5",
            "messages": [{"role": "user", "content": "hola"}],
        },
    )
    assert resp.status_code == 403
    body = resp.json()
    assert body["error"]["code"] == "model_selection_not_allowed"
    assert body["error"]["param"] == "model"


async def test_validation_error_on_bad_body(client):
    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={"model": "auto"},  # missing messages
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "validation_error"
