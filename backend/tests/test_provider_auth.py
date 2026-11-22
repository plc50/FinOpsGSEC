"""R2 — provider-agnostic outbound auth (§Pilar 4).

The bearer header must be attached for any backend that declares `auth: bearer`
+ `api_key_env` (driven purely by config + env), omitted for no-auth backends,
and keys come from env/settings only.
"""
from types import SimpleNamespace

from app.catalog import Provider
from app.services import providers


def _backend(auth=None, api_key_env=None, provider="p"):
    return Provider(
        id=provider,
        display_name=provider,
        base_url="http://example/v1",
        auth=auth,
        supports_chat_completions=True,
        supports_streaming=True,
        api_key_env=api_key_env,
    )


def test_no_auth_backend_has_no_authorization_header():
    headers = providers._auth_headers(_backend(auth=None))
    assert "Authorization" not in headers
    assert headers["Content-Type"] == "application/json"


def test_bearer_backend_attaches_header_from_env(monkeypatch):
    monkeypatch.setenv("MY_PROVIDER_KEY", "sk-test-123")
    headers = providers._auth_headers(
        _backend(auth="bearer", api_key_env="MY_PROVIDER_KEY")
    )
    assert headers["Authorization"] == "Bearer sk-test-123"


def test_bearer_backend_attaches_header_from_settings_when_env_missing(monkeypatch):
    monkeypatch.delenv("MY_PROVIDER_KEY", raising=False)
    monkeypatch.setattr(
        providers,
        "settings",
        SimpleNamespace(my_provider_key="sk-from-backend-dotenv"),
    )

    headers = providers._auth_headers(
        _backend(auth="bearer", api_key_env="MY_PROVIDER_KEY")
    )

    assert headers["Authorization"] == "Bearer sk-from-backend-dotenv"


def test_bearer_backend_omits_header_when_env_missing(monkeypatch):
    monkeypatch.delenv("MISSING_KEY", raising=False)
    headers = providers._auth_headers(
        _backend(auth="bearer", api_key_env="MISSING_KEY")
    )
    assert "Authorization" not in headers
