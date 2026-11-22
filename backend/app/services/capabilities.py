"""Required capabilities extraction (BACKEND_CONTEXT §7)."""
from __future__ import annotations

from typing import Any

from . import messages as msg


def required_capabilities(
    *,
    messages: list[dict],
    category: str,
    tools: Any = None,
    tool_choice: Any = None,
    response_format: Any = None,
) -> list[str]:
    caps: list[str] = ["text"]

    def add(cap: str) -> None:
        if cap not in caps:
            caps.append(cap)

    has_tools = bool(tools)
    if has_tools:
        add("tool_calling")
    if has_tools and tool_choice not in (None, "none"):
        add("tool_calling")

    if isinstance(response_format, dict):
        rf_type = response_format.get("type")
        if rf_type in ("json_schema", "json_object"):
            add("structured_outputs")

    modalities = msg.detect_modalities(messages)
    for mod in ("vision", "audio", "files"):
        if mod in modalities:
            add(mod)

    if category == "web_search":
        add("web_search")

    return caps
