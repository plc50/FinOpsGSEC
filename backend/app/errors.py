"""OpenAI-compatible error contract (BACKEND_CONTEXT §4 / API_CONTRACT §4)."""
from __future__ import annotations

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class APIError(Exception):
    """Error rendered as the OpenAI-compatible error envelope."""

    def __init__(
        self,
        *,
        http_status: int,
        message: str,
        type: str,
        code: str,
        param: str | None = None,
    ) -> None:
        self.http_status = http_status
        self.message = message
        self.type = type
        self.code = code
        self.param = param
        super().__init__(message)

    def to_dict(self) -> dict:
        return {
            "error": {
                "message": self.message,
                "type": self.type,
                "param": self.param,
                "code": self.code,
            }
        }


# --- Factories for the canonical cases in §4 ---

def missing_api_key() -> APIError:
    return APIError(
        http_status=401,
        message="Missing API key. Provide 'Authorization: Bearer <key>'.",
        type="invalid_request_error",
        code="missing_api_key",
    )


def invalid_api_key() -> APIError:
    return APIError(
        http_status=401,
        message="Invalid API key.",
        type="invalid_request_error",
        code="invalid_api_key",
    )


def model_selection_not_allowed() -> APIError:
    return APIError(
        http_status=403,
        message="Explicit model selection is not allowed for this consumer.",
        type="invalid_request_error",
        code="model_selection_not_allowed",
        param="model",
    )


def no_compatible_model() -> APIError:
    return APIError(
        http_status=400,
        message="No compatible model for the required capabilities.",
        type="invalid_request_error",
        code="no_compatible_model",
        param="model",
    )


def budget_exceeded() -> APIError:
    return APIError(
        http_status=429,
        message="Budget exceeded for this consumer.",
        type="insufficient_quota",
        code="budget_exceeded",
    )


def category_blocked(category: str, consumer: str) -> APIError:
    return APIError(
        http_status=403,
        message=(
            f"Category '{category}' is blocked by policy for consumer "
            f"'{consumer}'. Contact your FinOps admin if you need access."
        ),
        type="invalid_request_error",
        code="blocked_category",
        param="messages",
    )


def rate_limited(consumer: str, *, used: int, limit: int, window_seconds: float) -> APIError:
    return APIError(
        http_status=429,
        message=(
            f"Rate limit exceeded for consumer '{consumer}': {used} tokens used "
            f"in the last {int(window_seconds)}s (limit {limit}). Retry later."
        ),
        type="rate_limit_error",
        code="rate_limited",
    )


def provider_error(
    message: str = "Upstream provider error.",
    *,
    http_status: int = 502,
    type: str = "server_error",
    code: str = "provider_error",
    param: str | None = None,
) -> APIError:
    return APIError(
        http_status=http_status,
        message=message,
        type=type,
        code=code,
        param=param,
    )


def forbidden_scope() -> APIError:
    return APIError(
        http_status=403,
        message="You are not allowed to access this consumer scope.",
        type="invalid_request_error",
        code="forbidden_scope",
        param="consumer",
    )


def validation_error(message: str, param: str | None = None) -> APIError:
    return APIError(
        http_status=400,
        message=message,
        type="invalid_request_error",
        code="validation_error",
        param=param,
    )


# --- Exception handlers ---

async def api_error_handler(_: Request, exc: APIError) -> JSONResponse:
    return JSONResponse(status_code=exc.http_status, content=exc.to_dict())


async def validation_exception_handler(
    _: Request, exc: RequestValidationError
) -> JSONResponse:
    errors = exc.errors()
    param = None
    if errors:
        loc = errors[0].get("loc") or []
        param = str(loc[-1]) if loc else None
    err = validation_error(message="Request validation failed.", param=param)
    return JSONResponse(status_code=err.http_status, content=err.to_dict())
