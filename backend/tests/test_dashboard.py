"""Step 8 — dashboard permissions, summary, budgets (§15, API_CONTRACT §6)."""
import pytest

from .conftest import HEADERS

pytestmark = pytest.mark.asyncio


async def test_me_consumer(client):
    resp = await client.get("/dashboard/me", headers=HEADERS["marketing"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["consumer"] == "equipo-marketing"
    assert body["role"] == "consumer"
    assert body["visible_consumers"] == ["equipo-marketing"]
    assert body["api_key_prefix"] == "finops_key_..."


async def test_me_admin_sees_all(client):
    resp = await client.get("/dashboard/me", headers=HEADERS["admin"])
    body = resp.json()
    assert body["role"] == "admin"
    assert set(body["visible_consumers"]) >= {
        "equipo-marketing",
        "equipo-producto",
        "equipo-atencion-cliente",
    }


async def test_summary_consumer_scope(client):
    resp = await client.get("/dashboard/summary", headers=HEADERS["marketing"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["scope"] == "consumer"
    assert body["consumer"] == "equipo-marketing"
    assert body["budget"] == 10.0
    assert body["currency"] == "USD"


async def test_summary_admin_global(client):
    resp = await client.get("/dashboard/summary", headers=HEADERS["admin"])
    body = resp.json()
    assert body["scope"] == "admin"
    assert body["consumer"] is None


async def test_summary_forbidden_scope_for_consumer(client):
    resp = await client.get(
        "/dashboard/summary?consumer=equipo-producto", headers=HEADERS["marketing"]
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden_scope"


async def test_admin_can_query_other_consumer(client):
    resp = await client.get(
        "/dashboard/summary?consumer=equipo-producto", headers=HEADERS["admin"]
    )
    assert resp.status_code == 200
    assert resp.json()["consumer"] == "equipo-producto"


async def test_budgets_consumer_sees_own_only(client):
    resp = await client.get("/dashboard/budgets", headers=HEADERS["marketing"])
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["consumer"] == "equipo-marketing"


async def test_budgets_admin_sees_all(client):
    resp = await client.get("/dashboard/budgets", headers=HEADERS["admin"])
    consumers = {i["consumer"] for i in resp.json()["items"]}
    assert consumers >= {"equipo-marketing", "equipo-producto"}


async def test_post_budget_admin_ok(client):
    resp = await client.post(
        "/dashboard/budgets/equipo-marketing",
        headers=HEADERS["admin"],
        json={"budget": 15.0, "warning_threshold": 0.8},
    )
    assert resp.status_code == 200
    assert resp.json()["budget"] == 15.0


async def test_post_budget_consumer_forbidden(client):
    resp = await client.post(
        "/dashboard/budgets/equipo-marketing",
        headers=HEADERS["marketing"],
        json={"budget": 15.0, "warning_threshold": 0.8},
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden_scope"


async def test_post_budget_validation(client):
    resp = await client.post(
        "/dashboard/budgets/equipo-marketing",
        headers=HEADERS["admin"],
        json={"budget": -1, "warning_threshold": 0.8},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "validation_error"


async def test_forecast_forbidden_scope(client):
    resp = await client.get(
        "/dashboard/forecast/equipo-producto", headers=HEADERS["marketing"]
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden_scope"


async def test_routing_catalog_admin_shape(client):
    resp = await client.get("/dashboard/routing-catalog", headers=HEADERS["admin"])
    assert resp.status_code == 200

    body = resp.json()
    assert body["categories"] == [
        "qa_internal",
        "web_search",
        "code_generation",
        "misc",
    ]
    assert body["complexity_tiers"] == ["low", "medium", "high"]

    provider = body["providers"][0]
    assert set(provider) >= {
        "id",
        "display_name",
        "base_url",
        "supports_chat_completions",
        "supports_streaming",
    }

    model = body["models"][0]
    assert set(model) >= {
        "provider",
        "model",
        "display_name",
        "capabilities",
        "input_price_per_1m_tokens",
        "output_price_per_1m_tokens",
    }
    assert "quality_score" not in model

    providers = {p["id"] for p in body["providers"]}
    assert providers == {"openrouter", "fireworks", "tabbyapi"}
    assert {m["provider"] for m in body["models"]}.issubset(providers)


async def test_admin_can_configure_global_routing_route(client):
    resp = await client.put(
        "/dashboard/routing-config/global/misc/medium",
        headers=HEADERS["admin"],
        json={
            "provider": "tabbyapi",
            "model": "gemma-4-12B-it-exl3",
            "enabled": True,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["consumer"] == "global"
    assert body["category"] == "misc"
    assert body["complexity_tier"] == "medium"
    assert body["default_provider"] == "fireworks"
    assert body["configured_provider"] == "tabbyapi"
    assert body["configured_model"] == "gemma-4-12B-it-exl3"
    assert body["routing_source"] == "admin_config"
    assert body["updated_by_api_key_id"] == "key_admin"

    listing = await client.get("/dashboard/routing-config", headers=HEADERS["admin"])
    items = listing.json()["items"]
    route = next(
        i
        for i in items
        if i["consumer"] == "global"
        and i["category"] == "misc"
        and i["complexity_tier"] == "medium"
    )
    assert route["configured_provider"] == "tabbyapi"
    assert route["configured_model"] == "gemma-4-12B-it-exl3"


async def test_admin_can_delete_routing_route(client):
    await client.put(
        "/dashboard/routing-config/global/misc/medium",
        headers=HEADERS["admin"],
        json={
            "provider": "tabbyapi",
            "model": "gemma-4-12B-it-exl3",
            "enabled": True,
        },
    )

    resp = await client.delete(
        "/dashboard/routing-config/global/misc/medium",
        headers=HEADERS["admin"],
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["consumer"] == "global"
    assert body["category"] == "misc"
    assert body["complexity_tier"] == "medium"
    assert body["routing_source"] == "catalog"
    assert body["default_provider"] == "fireworks"
    assert body["default_model"] == "accounts/fireworks/models/glm-5p1"
    assert body["configured_provider"] is None
    assert body["configured_model"] is None

    listing = await client.get("/dashboard/routing-config", headers=HEADERS["admin"])
    route = next(
        i
        for i in listing.json()["items"]
        if i["consumer"] == "global"
        and i["category"] == "misc"
        and i["complexity_tier"] == "medium"
    )
    assert route["routing_source"] == "catalog"
    assert route["configured_provider"] is None
