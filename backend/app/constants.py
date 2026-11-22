"""Business-rule constants (BACKEND_CONTEXT §8, §10, §16)."""
from __future__ import annotations

# --- Budget policy constants (§10.5) ---
WARNING_THRESHOLD = 0.80
MIN_DEGRADATION_SAVINGS = 0.25
EXPENSIVE_REQUEST_THRESHOLD = 0.01  # USD budget_charge for a single request
COST_SPIKE_MULTIPLIER = 3.0  # current hourly rate vs 24h avg hourly rate

# --- Enums as plain tuples ---
CATEGORIES = ("qa_internal", "web_search", "code_generation", "misc")
TIERS = ("low", "medium", "high")
TIER_ORDER = {"low": 0, "medium": 1, "high": 2}
CAPABILITIES = (
    "text",
    "tool_calling",
    "web_search",
    "files",
    "rag",
    "vision",
    "audio",
    "structured_outputs",
)

# --- Default max tokens per category (§10.1) ---
DEFAULT_MAX_TOKENS = {
    "misc": 300,
    "qa_internal": 700,
    "web_search": 1000,
    "code_generation": 1500,
}

# --- Category score (§8.4) ---
CATEGORY_SCORE = {
    "misc": 0.10,
    "qa_internal": 0.35,
    "web_search": 0.65,
    "code_generation": 0.75,
}

# --- Complexity formula weights (§8.1) ---
WEIGHT_PROMPT_LENGTH = 0.35
WEIGHT_CATEGORY = 0.35
WEIGHT_CONTEXT = 0.20
WEIGHT_CONSUMER = 0.10

# --- Forecast weights (§14) ---
FORECAST_W_15M = 0.50
FORECAST_W_1H = 0.30
FORECAST_W_24H = 0.20
