"""Category classification (BACKEND_CONTEXT §6).

Deterministic rules first (§6.2). A small classifier (§6.3) is optional and
best-effort; the pipeline degrades gracefully to `misc` (§6.4) when it is not
available. This module implements the deterministic rules and the §6.4 decision.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from ..catalog import Catalog
from ..config import settings
from ..constants import CATEGORIES
from . import providers

logger = logging.getLogger(__name__)

CODE_FENCE_RE = re.compile(r"```")
SQL_RE = re.compile(
    r"\b(select|insert|update|delete)\b.*\bfrom\b|\bcreate\s+table\b",
    re.IGNORECASE | re.DOTALL,
)
STACKTRACE_RE = re.compile(
    r"traceback \(most recent call last\)|exception in thread|"
    r"\bat [\w.$]+\([\w.]+:\d+\)|error:.*\bline\s+\d+",
    re.IGNORECASE,
)
BUILD_ERROR_RE = re.compile(
    r"\b(build failed|compilation error|npm err!|cannot find module|"
    r"segmentation fault|syntaxerror|typeerror|nullpointerexception)\b",
    re.IGNORECASE,
)

WEB_SEARCH_TERMS = [
    "últimas noticias",
    "ultimas noticias",
    "fuentes actuales",
    "busca en internet",
    "búscalo en internet",
    "precio actual",
    "latest news",
    "current price",
    "search the web",
    "search online",
]

QA_INTERNAL_TERMS = [
    "documentación interna",
    "documentacion interna",
    "política interna",
    "politica interna",
    "política",
    "politica",
    "crm",
    "ticket",
    "procedimiento interno",
    "internal documentation",
    "internal policy",
]

MISC_TERMS = [
    "traduce",
    "translate",
    "resume",
    "summarize",
    "reformula",
    "rephrase",
    "dame ideas",
    "give me ideas",
    "brainstorm",
]

CLASSIFIER_SYSTEM_PROMPT = (
    "You are a strict JSON API for request classification. The first character "
    "of your response must be { and the last character must be }. Do not "
    "explain. Do not think step by step. Return exactly one JSON object with "
    "keys category and confidence. category must be one of: qa_internal, "
    "web_search, code_generation, misc. confidence must be a number from 0 to 1."
)


@dataclass(frozen=True)
class CategoryResult:
    category: str
    confidence: float
    source: str  # rules | classifier | fallback


def classify_rules(text: str) -> CategoryResult:
    """Deterministic rule classifier (§6.2)."""
    t = text or ""
    lower = t.lower()

    # Strongest signal: code.
    if CODE_FENCE_RE.search(t):
        return CategoryResult("code_generation", 0.98, "rules")
    if SQL_RE.search(t):
        return CategoryResult("code_generation", 0.97, "rules")
    if STACKTRACE_RE.search(t) or BUILD_ERROR_RE.search(lower):
        return CategoryResult("code_generation", 0.96, "rules")

    if any(term in lower for term in WEB_SEARCH_TERMS):
        return CategoryResult("web_search", 0.95, "rules")

    if any(term in lower for term in QA_INTERNAL_TERMS):
        return CategoryResult("qa_internal", 0.88, "rules")

    if any(term in lower for term in MISC_TERMS):
        return CategoryResult("misc", 0.78, "rules")

    # No strong signal.
    return CategoryResult("misc", 0.30, "rules")


def decide_category(
    rule_result: CategoryResult,
    classifier_result: CategoryResult | None = None,
) -> CategoryResult:
    """Combine rule + optional classifier per the §6.4 algorithm."""
    if rule_result.confidence >= 0.95:
        return rule_result
    if classifier_result is not None and classifier_result.confidence >= 0.70:
        return CategoryResult(
            classifier_result.category, classifier_result.confidence, "classifier"
        )
    if rule_result.confidence >= 0.70:
        return rule_result
    return CategoryResult("misc", rule_result.confidence, "fallback")


async def classify_with_model(catalog: Catalog, text: str) -> CategoryResult | None:
    """Best-effort small-model classifier (§6.3)."""
    if not settings.classifier_enabled:
        return None

    provider = catalog.provider(settings.classifier_provider)
    if provider is None:
        logger.warning(
            "Category classifier disabled: unknown provider %s.",
            settings.classifier_provider,
        )
        return None

    payload = {
        "model": settings.classifier_model,
        "messages": [
            {"role": "system", "content": CLASSIFIER_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "messages_text": (text or "")[:2000],
                        "allowed_categories": list(CATEGORIES),
                    },
                    ensure_ascii=False,
                ),
            },
        ],
        "temperature": 0,
        "max_tokens": settings.classifier_max_tokens,
        "response_format": {"type": "json_object"},
    }

    try:
        completion = await providers.call_backend(
            provider,
            payload,
            f"{settings.classifier_provider}/{settings.classifier_model}",
        )
    except providers.ProviderError as exc:
        logger.info("Category classifier failed: %s", exc.message)
        return None

    return _parse_classifier_completion(completion)


def _parse_classifier_completion(completion: dict[str, Any]) -> CategoryResult | None:
    choices = completion.get("choices") or []
    if not choices:
        return None
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, dict):
        payload = content
    elif isinstance(content, str):
        payload = _load_json_object(content)
    else:
        payload = None
    if not isinstance(payload, dict):
        return None

    category = payload.get("category")
    confidence = payload.get("confidence")
    if category not in CATEGORIES:
        return None
    if not isinstance(confidence, int | float):
        return None
    confidence_value = max(0.0, min(1.0, float(confidence)))
    return CategoryResult(category, confidence_value, "classifier")


def _load_json_object(content: str) -> dict[str, Any] | None:
    raw = content.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"\s*```$", "", raw).strip()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None
