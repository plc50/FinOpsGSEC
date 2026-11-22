"""API key authentication and role/scope resolution (BACKEND_CONTEXT §3, §15)."""
from __future__ import annotations

from fastapi import Request

from . import errors
from .catalog import ApiKey, get_catalog


def extract_bearer(request: Request) -> str | None:
    header = request.headers.get("authorization") or request.headers.get(
        "Authorization"
    )
    if not header:
        return None
    parts = header.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return None


def authenticate(request: Request) -> ApiKey:
    """Resolve the API key or raise the proper OpenAI-compatible error (§4)."""
    token = extract_bearer(request)
    if not token:
        raise errors.missing_api_key()
    api_key = get_catalog().get_api_key(token)
    if api_key is None:
        raise errors.invalid_api_key()
    return api_key


def visible_consumers(api_key: ApiKey) -> list[str]:
    """Consumers this key may see (§15)."""
    if api_key.role == "admin":
        return get_catalog().known_consumers
    return [api_key.consumer]


def resolve_scope(api_key: ApiKey, requested_consumer: str | None) -> list[str]:
    """Return the list of consumers in scope for a dashboard query.

    Raises forbidden_scope if a consumer requests data outside its own scope.
    """
    if api_key.role == "admin":
        if requested_consumer:
            return [requested_consumer]
        return get_catalog().known_consumers
    # consumer role
    if requested_consumer and requested_consumer != api_key.consumer:
        raise errors.forbidden_scope()
    return [api_key.consumer]
