"""Step 1 — config/catalogs (BACKEND_CONTEXT §17.1)."""
from app.catalog import get_catalog


def test_api_keys_loaded():
    cat = get_catalog()
    key = cat.get_api_key("finops_key_marketing")
    assert key is not None
    assert key.api_key_id == "key_marketing"
    assert key.consumer == "equipo-marketing"
    assert key.role == "consumer"
    assert key.can_select_model is False


def test_admin_key():
    cat = get_catalog()
    admin = cat.get_api_key("finops_key_admin")
    assert admin.role == "admin"
    assert admin.can_select_model is True


def test_invalid_key_returns_none():
    assert get_catalog().get_api_key("nope") is None


def test_provider_models_cover_all_category_tiers():
    cat = get_catalog()
    for category in ("qa_internal", "web_search", "code_generation", "misc"):
        for tier in ("low", "medium", "high"):
            assert cat.model_for_route(category, tier) is not None, (category, tier)


def test_provider_model_prices_align_with_tier():
    cat = get_catalog()
    low = cat.model_for_route("qa_internal", "low")
    high = cat.model_for_route("qa_internal", "high")
    assert high.input_price_per_1m_tokens > low.input_price_per_1m_tokens


def test_providers_and_models_loaded():
    cat = get_catalog()
    assert set(cat.providers) == {"openrouter", "fireworks", "tabbyapi"}
    assert cat.providers["tabbyapi"].auth == "bearer"
    assert cat.providers["tabbyapi"].api_key_env == "TABBY_API_KEY"
    tabby_low = cat.model_for_route("misc", "low")
    assert tabby_low.provider == "tabbyapi"
    assert tabby_low.model == "gemma-4-12B-it-exl3"
    assert tabby_low.input_price_per_1m_tokens == 0.06


def test_model_catalog_is_independent_from_default_routes():
    cat = get_catalog()
    metadata = cat.find_provider_model("tabbyapi", "gemma-4-12B-it-exl3")
    assert metadata is not None
    assert metadata.category == ""
    assert metadata.tier == ""

    routed = cat.provider_model_for_route(
        "tabbyapi", "gemma-4-12B-it-exl3", "web_search", "high"
    )
    assert routed.category == "web_search"
    assert routed.tier == "high"
    assert routed.input_price_per_1m_tokens == metadata.input_price_per_1m_tokens


def test_budgets_loaded():
    cat = get_catalog()
    assert cat.budget("equipo-marketing").budget == 10.0
    assert cat.budget("equipo-atencion-cliente").budget == 5.0
