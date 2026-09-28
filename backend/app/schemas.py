"""Pydantic v2 request/response schemas."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="allow")
    role: str
    content: Any = None


class ChatCompletionRequest(BaseModel):
    # Unknown fields are forwarded to the backend but not interpreted (§2.2).
    model_config = ConfigDict(extra="allow")

    model: str = "auto"
    messages: list[ChatMessage]
    max_tokens: int | None = None
    stream: bool = False
    tools: Any | None = None
    tool_choice: Any | None = None
    response_format: Any | None = None
    temperature: float | None = None
    top_p: float | None = None
    stop: Any | None = None
    presence_penalty: float | None = None
    frequency_penalty: float | None = None
    seed: int | None = None
    user: str | None = None


class ModelObject(BaseModel):
    id: str
    object: str = "model"
    owned_by: str


class ModelList(BaseModel):
    object: str = "list"
    data: list[ModelObject]


class BudgetUpdateRequest(BaseModel):
    budget: float = Field(gt=0)
    warning_threshold: float = Field(ge=0.1, le=0.99)


class RoutingConfigUpdateRequest(BaseModel):
    provider: str
    model: str
    enabled: bool = True
