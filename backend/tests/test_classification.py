"""Step 5 — category + complexity + capability filters (§6, §7, §8)."""
import json

import httpx
import pytest
import respx
from sqlmodel import select

from app.catalog import get_catalog
from app.models import AuditRecord
from app.services import capabilities, category as category_svc, complexity, routing
from app.services.category import classify_rules, decide_category

from .conftest import HEADERS

FIREWORKS_URL = "https://api.fireworks.ai/inference/v1/chat/completions"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
TABBY_URL = "http://127.0.0.1:5000/v1/chat/completions"


def _completion(model: str, content: str = "ok") -> dict:
    return {
        "id": "chatcmpl_test",
        "object": "chat.completion",
        "created": 1,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 12,
            "completion_tokens": 4,
            "total_tokens": 16,
        },
    }


# ------------------------- category (§6) ------------------------- #
def test_code_fence_is_code_generation():
    r = classify_rules("Fix this:\n```python\nprint(1)\n```")
    assert r.category == "code_generation"
    assert r.confidence >= 0.95


def test_sql_is_code_generation():
    r = classify_rules("SELECT id FROM users WHERE active = true")
    assert r.category == "code_generation"


def test_web_search_terms():
    r = classify_rules("Dame las últimas noticias de hoy")
    assert r.category == "web_search"
    assert r.confidence >= 0.95


def test_qa_internal_terms():
    r = classify_rules("Consulta la documentación interna sobre el CRM")
    assert r.category == "qa_internal"


def test_misc_fallback_when_weak():
    r = classify_rules("Hola, cómo estás")
    decided = decide_category(r, None)
    assert decided.category == "misc"
    assert decided.source == "fallback"


def test_decision_prefers_high_confidence_rule():
    r = classify_rules("```js\nconsole.log(1)\n```")
    decided = decide_category(r, None)
    assert decided.category == "code_generation"
    assert decided.source == "rules"


def test_decision_uses_classifier_when_rule_uncertain():
    from app.services.category import CategoryResult

    rule = CategoryResult("misc", 0.30, "rules")
    clf = CategoryResult("qa_internal", 0.86, "classifier")
    decided = decide_category(rule, clf)
    assert decided.category == "qa_internal"
    assert decided.source == "classifier"


@pytest.mark.asyncio
@respx.mock
async def test_high_confidence_rule_does_not_call_classifier(
    client, session, monkeypatch
):
    async def fail_classifier(*args, **kwargs):
        raise AssertionError("classifier should not run for strong rules")

    monkeypatch.setattr(category_svc, "classify_with_model", fail_classifier)
    respx.post(OPENROUTER_URL).mock(
        return_value=httpx.Response(
            200, json=_completion("perplexity/sonar", "news answer")
        )
    )

    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={
            "model": "auto",
            "messages": [{"role": "user", "content": "Dame las últimas noticias"}],
        },
    )

    assert resp.status_code == 200
    audit = (await session.execute(select(AuditRecord))).scalar_one()
    assert audit.category == "web_search"
    assert audit.category_source == "rules"
    assert audit.classifier_confidence is None


@pytest.mark.asyncio
@respx.mock
async def test_uncertain_category_uses_small_classifier_and_routes_with_result(
    client, session
):
    classifier = respx.post(FIREWORKS_URL).mock(
        return_value=httpx.Response(
            200,
            json=_completion(
                "accounts/fireworks/models/deepseek-v4-flash",
                json.dumps({"category": "web_search", "confidence": 0.91}),
            ),
        )
    )
    provider = respx.post(OPENROUTER_URL).mock(
        return_value=httpx.Response(
            200, json=_completion("perplexity/sonar", "fresh sourced answer")
        )
    )

    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={
            "model": "auto",
            "messages": [
                {
                    "role": "user",
                    "content": "Contrasta esta afirmación con referencias recientes",
                }
            ],
        },
    )

    assert resp.status_code == 200
    assert classifier.called
    classifier_payload = json.loads(classifier.calls.last.request.content)
    assert classifier_payload["model"] == "accounts/fireworks/models/deepseek-v4-flash"
    assert classifier_payload["max_tokens"] == 300
    assert classifier_payload["response_format"] == {"type": "json_object"}
    assert "allowed_categories" in classifier_payload["messages"][1]["content"]
    assert provider.called

    listing = await client.get(
        "/dashboard/usage/requests", headers=HEADERS["marketing"]
    )
    row = listing.json()["items"][0]
    assert row["category"] == "web_search"
    assert row["required_capabilities"] == ["text", "web_search"]
    assert row["selected_provider"] == "openrouter"
    assert row["selected_model"] == "perplexity/sonar"

    audit = (await session.execute(select(AuditRecord))).scalar_one()
    assert audit.category_source == "classifier"
    assert audit.classifier_confidence == pytest.approx(0.91)


@pytest.mark.asyncio
@respx.mock
async def test_classifier_failure_keeps_request_on_misc_fallback(client, session):
    respx.post(FIREWORKS_URL).mock(
        return_value=httpx.Response(
            500,
            json={
                "error": {
                    "message": "classifier unavailable",
                    "type": "server_error",
                    "code": "provider_error",
                }
            },
        )
    )
    tabby = respx.post(TABBY_URL).mock(
        return_value=httpx.Response(
            200, json=_completion("gemma-4-12B-it-exl3", "fallback answer")
        )
    )

    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={
            "model": "auto",
            "messages": [{"role": "user", "content": "Ayúdame con esto"}],
        },
    )

    assert resp.status_code == 200
    assert tabby.called
    audit = (await session.execute(select(AuditRecord))).scalar_one()
    assert audit.category == "misc"
    assert audit.category_source == "fallback"
    assert audit.classifier_confidence is None


# ------------------------- capabilities (§7) ------------------------- #
def test_default_capability_is_text():
    caps = capabilities.required_capabilities(
        messages=[{"role": "user", "content": "hi"}], category="misc"
    )
    assert caps == ["text"]


def test_tools_add_tool_calling():
    caps = capabilities.required_capabilities(
        messages=[{"role": "user", "content": "hi"}],
        category="misc",
        tools=[{"type": "function"}],
    )
    assert "tool_calling" in caps


def test_tool_choice_without_tools_does_not_add_tool_calling():
    caps = capabilities.required_capabilities(
        messages=[{"role": "user", "content": "hi"}],
        category="misc",
        tool_choice="auto",
    )
    assert caps == ["text"]


def test_response_format_json_schema_adds_structured():
    caps = capabilities.required_capabilities(
        messages=[{"role": "user", "content": "hi"}],
        category="misc",
        response_format={"type": "json_schema"},
    )
    assert "structured_outputs" in caps


def test_web_search_category_adds_capability():
    caps = capabilities.required_capabilities(
        messages=[{"role": "user", "content": "hi"}], category="web_search"
    )
    assert "web_search" in caps


def test_vision_modality_detected():
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "what is this"},
                {"type": "image_url", "image_url": {"url": "http://x/y.png"}},
            ],
        }
    ]
    caps = capabilities.required_capabilities(messages=messages, category="misc")
    assert "vision" in caps


# ------------------------- complexity (§8) ------------------------- #
def test_prompt_length_score_buckets():
    assert complexity.prompt_length_score(100) == 0.10
    assert complexity.prompt_length_score(500) == 0.35
    assert complexity.prompt_length_score(2000) == 0.65
    assert complexity.prompt_length_score(8000) == 0.85
    assert complexity.prompt_length_score(20000) == 1.00


def test_context_score_counts_prior_messages():
    messages = [
        {"role": "user", "content": "a"},
        {"role": "assistant", "content": "b"},
        {"role": "user", "content": "c"},
    ]
    assert complexity.context_score(messages) == 0.25


def test_tier_for_score():
    assert complexity.tier_for_score(0.2) == "low"
    assert complexity.tier_for_score(0.5) == "medium"
    assert complexity.tier_for_score(0.8) == "high"


def test_estimate_prompt_tokens_positive():
    tokens = complexity.estimate_prompt_tokens(
        [{"role": "user", "content": "Hello world this is a test"}]
    )
    assert tokens > 0


def test_complexity_score_uses_documented_weights():
    messages = [
        {"role": "user", "content": "a"},
        {"role": "assistant", "content": "b"},
        {"role": "user", "content": "c"},
    ]

    score = complexity.complexity_score(
        estimated_prompt_tokens=500,
        category="web_search",
        messages=messages,
        consumer_score=0.80,
    )

    assert score == pytest.approx(0.48)


def test_complexity_weights_produce_coherent_tiers():
    low = complexity.complexity_score(
        estimated_prompt_tokens=100,
        category="misc",
        messages=[{"role": "user", "content": "short"}],
        consumer_score=0.10,
    )
    medium = complexity.complexity_score(
        estimated_prompt_tokens=2_000,
        category="web_search",
        messages=[
            {"role": "user", "content": "a"},
            {"role": "assistant", "content": "b"},
            {"role": "user", "content": "c"},
        ],
        consumer_score=0.50,
    )
    high = complexity.complexity_score(
        estimated_prompt_tokens=13_000,
        category="code_generation",
        messages=[
            *[
                {"role": "assistant" if i % 2 else "user", "content": str(i)}
                for i in range(14)
            ],
            {"role": "user", "content": "current"},
        ],
        consumer_score=1.00,
    )

    assert low < medium < high
    assert complexity.tier_for_score(low) == "low"
    assert complexity.tier_for_score(medium) == "medium"
    assert complexity.tier_for_score(high) == "high"


# ------------------------- capability filter / no_compatible_model (§7) --- #
def test_no_compatible_model_raises():
    import pytest

    from app import errors

    cat = get_catalog()
    with pytest.raises(errors.APIError) as exc:
        routing.select_baseline(
            cat,
            category="misc",
            tier="low",
            required_capabilities=["text", "audio"],  # no misc model has audio
        )
    assert exc.value.code == "no_compatible_model"


def test_capability_filter_skips_incompatible_tier():
    cat = get_catalog()
    # code_generation low (qwen3-coder-flash) lacks structured_outputs; requiring
    # it should bump selection to a higher compatible tier.
    baseline = routing.select_baseline(
        cat,
        category="code_generation",
        tier="low",
        required_capabilities=["text", "structured_outputs"],
    )
    assert "structured_outputs" in baseline.capabilities
