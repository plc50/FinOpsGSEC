"""Application settings via pydantic-settings."""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = BASE_DIR / "config"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://finops:finops@localhost:5432/finops"
    test_database_url: str = (
        "postgresql+asyncpg://finops:finops@localhost:5432/finops_test"
    )

    # Demo resilience: return realistic mock completions instead of hitting real
    # providers. Real httpx pass-through is the default (MOCK_PROVIDERS=false).
    mock_providers: bool = False

    # Outbound provider timeout (seconds). `provider_timeout` is kept as a
    # single-value fallback/ceiling for backwards compatibility. For real
    # (streaming) backends we split it into a short connect timeout — so a dead
    # backend fails fast and the technical fallback kicks in — and a generous
    # read timeout that lets a warm local model finish a longer generation.
    provider_timeout: float = 60.0
    provider_connect_timeout: float = 5.0
    provider_read_timeout: float = 120.0

    # Optional small-model category classifier. Deterministic rules still run
    # first; this is only used when rule confidence is below the strong threshold.
    classifier_enabled: bool = True
    classifier_provider: str = "fireworks"
    classifier_model: str = "accounts/fireworks/models/deepseek-v4-flash"
    classifier_max_tokens: int = 300

    # Semantic cache (pgvector). If Postgres does not provide the vector
    # extension, the app keeps running and the cache becomes a no-op.
    semantic_cache_enabled: bool = True
    semantic_cache_similarity_threshold: float = 0.95
    semantic_cache_max_age_seconds: int = 604800

    # Token reduction (smart context compaction). When a conversation exceeds
    # `token_reduction_max_context_tokens`, the proxy keeps system messages and
    # the most recent `token_reduction_keep_recent_messages` turns, and replaces
    # the older middle of the conversation with a short summary produced by the
    # cheapest catalog model (naive truncation under MOCK_PROVIDERS).
    token_reduction_enabled: bool = True
    token_reduction_max_context_tokens: int = 6000
    token_reduction_keep_recent_messages: int = 4
    token_reduction_summary_max_chars: int = 800
    token_reduction_summary_max_tokens: int = 250

    # Rate limiting: tokens consumed per consumer in a sliding window.
    # Per-consumer overrides live in config/budgets.yaml
    # (`rate_limit_tokens_per_minute`); this is the global default.
    rate_limit_enabled: bool = True
    rate_limit_window_seconds: float = 60.0
    rate_limit_default_tokens_per_minute: int = 60000

    # Optional outbound provider credentials. Exported environment variables
    # still take precedence; these fields make backend/.env work for local demos.
    openrouter_api_key: str | None = None
    fireworks_api_key: str | None = None
    tabby_api_key: str | None = None

    # Forecast period.
    forecast_period: str = "monthly"

    config_dir: Path = CONFIG_DIR


settings = Settings()
