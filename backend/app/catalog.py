"""Config/catalog loader (BACKEND_CONTEXT §3, §5).

Loads YAML catalogs for API keys, consumers, OpenAI-compatible providers,
provider models and demo budgets, and exposes typed lookups used across the
pipeline.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

from .config import settings
from .constants import TIER_ORDER


@dataclass(frozen=True)
class ApiKey:
    key: str
    api_key_id: str
    consumer: str
    role: str
    can_select_model: bool

    @property
    def api_key_prefix(self) -> str:
        # Never store/return the full key. §3.1
        return "finops_key_..."


@dataclass(frozen=True)
class Provider:
    id: str
    display_name: str
    base_url: str
    auth: str | None
    supports_chat_completions: bool
    supports_streaming: bool
    api_key_env: str | None = None


@dataclass(frozen=True)
class ProviderModel:
    provider: str
    model: str
    display_name: str
    category: str
    tier: str
    input_price_per_1m_tokens: float
    output_price_per_1m_tokens: float
    capabilities: tuple[str, ...]

    @property
    def id(self) -> str:
        return f"{self.provider}/{self.model}"


@dataclass(frozen=True)
class BudgetConfig:
    consumer: str
    budget: float
    warning_threshold: float
    # Categories this consumer may never use (hard block, 403).
    blocked_categories: tuple[str, ...] = ()
    # Categories silently reclassified to a cheaper fallback category before
    # routing (soft policy), e.g. {"code_generation": "misc"}.
    category_downgrades: dict[str, str] = field(default_factory=dict)
    # Optional per-consumer token rate limit; None falls back to the global
    # default (settings.rate_limit_default_tokens_per_minute).
    rate_limit_tokens_per_minute: int | None = None


@dataclass
class Catalog:
    api_keys: dict[str, ApiKey]
    consumer_scores: dict[str, float]
    providers: dict[str, Provider]
    # Global default route: (category, tier) -> ProviderModel.
    provider_models: dict[tuple[str, str], ProviderModel]
    budgets: dict[str, BudgetConfig]
    # Manually maintained provider/model metadata: (provider, model) -> ProviderModel.
    model_catalog: dict[tuple[str, str], ProviderModel] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.model_catalog:
            self.model_catalog = {
                (model.provider, model.model): model
                for model in self.provider_models.values()
            }

    # ----- API keys / consumers -----
    def get_api_key(self, key: str | None) -> ApiKey | None:
        if not key:
            return None
        return self.api_keys.get(key)

    def consumer_score(self, consumer: str) -> float:
        return self.consumer_scores.get(consumer, 0.30)

    @property
    def known_consumers(self) -> list[str]:
        # All consumers that are actual teams (exclude admin scope name).
        return [c for c in self.consumer_scores if c != "admin"]

    # ----- Provider model routes -----
    def model_for_route(self, category: str, tier: str) -> ProviderModel | None:
        return self.provider_models.get((category, tier))

    def models_in_category(self, category: str) -> list[ProviderModel]:
        models = [m for (c, _t), m in self.provider_models.items() if c == category]
        return sorted(models, key=lambda m: TIER_ORDER[m.tier])

    def find_model_by_id(self, model_id: str) -> ProviderModel | None:
        """Return the first routed provider model matching provider/model."""
        for model in self.model_catalog.values():
            if model.id == model_id:
                return model
        return None

    def find_provider_model(self, provider: str, model_name: str) -> ProviderModel | None:
        """Return catalog metadata for an exact provider/model pair."""
        return self.model_catalog.get((provider, model_name))

    def provider_model_for_route(
        self, provider: str, model_name: str, category: str, tier: str
    ) -> ProviderModel | None:
        """Return provider/model metadata bound to a concrete routing slot."""
        metadata = self.find_provider_model(provider, model_name)
        if metadata is None:
            return None
        return ProviderModel(
            provider=metadata.provider,
            model=metadata.model,
            display_name=metadata.display_name,
            category=category,
            tier=tier,
            input_price_per_1m_tokens=metadata.input_price_per_1m_tokens,
            output_price_per_1m_tokens=metadata.output_price_per_1m_tokens,
            capabilities=metadata.capabilities,
        )

    def all_model_ids(self) -> list[str]:
        seen: list[str] = []
        for model in self.model_catalog.values():
            if model.id not in seen:
                seen.append(model.id)
        return seen

    def provider(self, provider_id: str) -> Provider | None:
        return self.providers.get(provider_id)

    # ----- Budgets -----
    def budget(self, consumer: str) -> BudgetConfig | None:
        return self.budgets.get(consumer)

    # ----- Static policy rules -----
    def blocked_categories(self, consumer: str) -> tuple[str, ...]:
        cfg = self.budgets.get(consumer)
        return cfg.blocked_categories if cfg else ()

    def category_downgrade_for(self, consumer: str, category: str) -> str | None:
        """Fallback category this consumer must use instead of `category`."""
        cfg = self.budgets.get(consumer)
        if cfg is None:
            return None
        return cfg.category_downgrades.get(category)

    def rate_limit_tokens_per_minute(self, consumer: str) -> int | None:
        cfg = self.budgets.get(consumer)
        return cfg.rate_limit_tokens_per_minute if cfg else None


def _load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def load_catalog(config_dir: Path | None = None) -> Catalog:
    config_dir = config_dir or settings.config_dir

    keys_raw = _load_yaml(config_dir / "api_keys.yaml")
    api_keys: dict[str, ApiKey] = {}
    for key, data in (keys_raw.get("api_keys") or {}).items():
        api_keys[key] = ApiKey(
            key=key,
            api_key_id=data["api_key_id"],
            consumer=data["consumer"],
            role=data["role"],
            can_select_model=bool(data.get("can_select_model", False)),
        )
    consumer_scores = dict(keys_raw.get("consumer_scores") or {})

    providers_raw = _load_yaml(config_dir / "providers.yaml")
    providers: dict[str, Provider] = {}
    for data in providers_raw.get("providers") or []:
        provider = Provider(
            id=data["id"],
            display_name=data.get("display_name") or data["id"],
            base_url=data["base_url"],
            auth=data.get("auth"),
            supports_chat_completions=bool(data.get("supports_chat_completions", True)),
            supports_streaming=bool(data.get("supports_streaming", True)),
            api_key_env=data.get("api_key_env"),
        )
        providers[provider.id] = provider

    models_raw = _load_yaml(config_dir / "provider_models.yaml")
    model_catalog: dict[tuple[str, str], ProviderModel] = {}
    for data in models_raw.get("provider_models") or []:
        model = ProviderModel(
            provider=data["provider"],
            model=data["model"],
            display_name=data.get("display_name") or data["model"],
            category="",
            tier="",
            input_price_per_1m_tokens=float(data["input_price_per_1m_tokens"]),
            output_price_per_1m_tokens=float(data["output_price_per_1m_tokens"]),
            capabilities=tuple(data.get("capabilities") or ["text"]),
        )
        model_catalog[(model.provider, model.model)] = model

    provider_models: dict[tuple[str, str], ProviderModel] = {}
    for category, tiers in (models_raw.get("routing_defaults") or {}).items():
        for tier, ref in tiers.items():
            metadata = model_catalog[(ref["provider"], ref["model"])]
            provider_models[(category, tier)] = ProviderModel(
                provider=metadata.provider,
                model=metadata.model,
                display_name=metadata.display_name,
                category=category,
                tier=tier,
                input_price_per_1m_tokens=metadata.input_price_per_1m_tokens,
                output_price_per_1m_tokens=metadata.output_price_per_1m_tokens,
                capabilities=metadata.capabilities,
            )

    # Backward-compatible shape for small synthetic tests/configs: each model row
    # can still carry category+tier and serve as a default route.
    if not provider_models:
        for data in models_raw.get("provider_models") or []:
            if "category" not in data or "tier" not in data:
                continue
            metadata = model_catalog[(data["provider"], data["model"])]
            provider_models[(data["category"], data["tier"])] = ProviderModel(
                provider=metadata.provider,
                model=metadata.model,
                display_name=metadata.display_name,
                category=data["category"],
                tier=data["tier"],
                input_price_per_1m_tokens=metadata.input_price_per_1m_tokens,
                output_price_per_1m_tokens=metadata.output_price_per_1m_tokens,
                capabilities=metadata.capabilities,
            )

    if not provider_models:
        raise ValueError("provider_models.yaml must define routing_defaults")

    missing_providers = {
        provider for provider, _model in model_catalog if provider not in providers
    }
    if missing_providers:
        raise ValueError(f"Unknown provider(s) in model catalog: {sorted(missing_providers)}")

    for route_model in provider_models.values():
        if (route_model.provider, route_model.model) not in model_catalog:
            raise ValueError(f"Unknown provider model in routing defaults: {route_model.id}")

    budgets_raw = _load_yaml(config_dir / "budgets.yaml")
    budgets: dict[str, BudgetConfig] = {}
    for consumer, data in (budgets_raw.get("budgets") or {}).items():
        rate_limit_raw = data.get("rate_limit_tokens_per_minute")
        downgrades_raw = data.get("category_downgrades") or {}
        budgets[consumer] = BudgetConfig(
            consumer=consumer,
            budget=float(data["budget"]),
            warning_threshold=float(data.get("warning_threshold", 0.8)),
            blocked_categories=tuple(data.get("blocked_categories") or ()),
            category_downgrades={
                str(category): str(fallback)
                for category, fallback in downgrades_raw.items()
            },
            rate_limit_tokens_per_minute=(
                int(rate_limit_raw) if rate_limit_raw is not None else None
            ),
        )

    return Catalog(
        api_keys=api_keys,
        consumer_scores=consumer_scores,
        providers=providers,
        provider_models=provider_models,
        budgets=budgets,
        model_catalog=model_catalog,
    )


@lru_cache(maxsize=1)
def get_catalog() -> Catalog:
    return load_catalog()
