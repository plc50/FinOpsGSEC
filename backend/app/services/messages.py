"""Helpers to extract text and modalities from OpenAI-style messages."""
from __future__ import annotations

import hashlib
import json
from typing import Any


def _content_parts(content: Any) -> list[dict]:
    if isinstance(content, list):
        return [p for p in content if isinstance(p, dict)]
    return []


def message_text(content: Any) -> str:
    """Concatenate textual parts of a single message content."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    texts: list[str] = []
    for part in _content_parts(content):
        ptype = part.get("type")
        if ptype in (None, "text") and isinstance(part.get("text"), str):
            texts.append(part["text"])
    return " ".join(texts)


def all_text(messages: list[dict]) -> str:
    return "\n".join(message_text(m.get("content")) for m in messages)


def last_user_text(messages: list[dict]) -> str:
    for m in reversed(messages):
        if m.get("role") == "user":
            return message_text(m.get("content"))
    return all_text(messages)


def total_text_chars(messages: list[dict]) -> int:
    return len(all_text(messages))


def prior_message_count(messages: list[dict]) -> int:
    """Number of prior messages excluding the current last user message (§8.5)."""
    if not messages:
        return 0
    # Find index of the last user message; everything before it counts as prior.
    last_user_idx = None
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "user":
            last_user_idx = i
            break
    if last_user_idx is None:
        return len(messages)
    return last_user_idx


def detect_modalities(messages: list[dict]) -> set[str]:
    """Detect image/audio/file modalities present in messages (§7)."""
    found: set[str] = set()
    for m in messages:
        for part in _content_parts(m.get("content")):
            ptype = part.get("type", "")
            if ptype in ("image_url", "image"):
                found.add("vision")
            elif ptype in ("input_audio", "audio"):
                found.add("audio")
            elif ptype in ("file", "input_file"):
                found.add("files")
    return found


def prompt_fingerprint(messages: list[dict]) -> str:
    normalized = json.dumps(
        [{"role": m.get("role"), "content": message_text(m.get("content"))} for m in messages],
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def prompt_preview(messages: list[dict], limit: int = 200) -> str:
    return last_user_text(messages)[:limit]
