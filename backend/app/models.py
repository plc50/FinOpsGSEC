"""SQLModel tables for audit, aggregates, budgets, alerts and routing config.

Cost fields use NUMERIC for exactness (BACKEND_CONTEXT §1.2 / §12 / §13).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Column, DateTime, Numeric
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy import String
from sqlmodel import Field, SQLModel


def _uuid() -> str:
    return str(uuid.uuid4())


def money() -> Column:
    return Column(Numeric(24, 10), nullable=True)


def money_nn(default: float = 0) -> Column:
    return Column(Numeric(24, 10), nullable=False, default=default)


class AuditRecord(SQLModel, table=True):
    __tablename__ = "audit_records"

    id: str = Field(default_factory=_uuid, primary_key=True)
    timestamp_started: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    timestamp_completed: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )

    api_key_id: str
    api_key_prefix: str
    consumer: str = Field(index=True)
    role: str

    requested_model: str
    requested_model_allowed: bool = True

    category: Optional[str] = None
    category_source: Optional[str] = None
    # Original classification when a policy downgraded the category
    # (e.g. marketing code_generation reclassified to misc).
    original_category: Optional[str] = None
    rule_confidence: Optional[float] = None
    classifier_confidence: Optional[float] = None

    complexity_score: Optional[float] = None
    complexity_tier: Optional[str] = None
    required_capabilities: list[str] = Field(
        default_factory=lambda: ["text"],
        sa_column=Column(ARRAY(String), nullable=False),
    )

    selected_provider: Optional[str] = None
    selected_model: Optional[str] = None
    routing_source: Optional[str] = None
    routing_config_id: Optional[str] = None
    backend_fallback_used: bool = False

    baseline_provider: Optional[str] = None
    baseline_model: Optional[str] = None
    baseline_model_cost: Optional[Decimal] = Field(default=None, sa_column=money())
    estimated_savings: Optional[Decimal] = Field(default=None, sa_column=money())
    estimated_savings_ratio: Optional[float] = None

    max_tokens: Optional[int] = None
    max_tokens_source: Optional[str] = None
    estimated_prompt_tokens: Optional[int] = None
    actual_prompt_tokens: Optional[int] = None
    estimated_output_tokens: Optional[int] = None
    actual_output_tokens: Optional[int] = None
    usage_source: Optional[str] = None

    estimated_model_cost: Optional[Decimal] = Field(default=None, sa_column=money())
    actual_model_cost: Optional[Decimal] = Field(default=None, sa_column=money())
    routing_overhead_cost: Decimal = Field(
        default=Decimal("0"), sa_column=money_nn()
    )
    backend_cost: Optional[Decimal] = Field(default=None, sa_column=money())
    budget_charge: Optional[Decimal] = Field(default=None, sa_column=money())
    estimated_budget_charge: Optional[Decimal] = Field(default=None, sa_column=money())

    budget_action: Optional[str] = None
    status: Optional[str] = Field(default=None, index=True)
    error_code: Optional[str] = None
    latency_ms: Optional[int] = None

    prompt_fingerprint: Optional[str] = None
    prompt_preview: Optional[str] = None
    stream: bool = False
    post_stream_budget_overrun: bool = False

    # Token reduction (context compaction) evidence.
    context_reduced: bool = False
    context_tokens_saved: Optional[int] = None


class UsageHourly(SQLModel, table=True):
    __tablename__ = "usage_hourly"

    id: str = Field(default_factory=_uuid, primary_key=True)
    bucket_start: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True)
    )
    consumer: str = Field(index=True)
    category: Optional[str] = None
    selected_provider: Optional[str] = None
    selected_model: Optional[str] = None

    request_count: int = 0
    estimated_input_tokens: int = 0
    actual_input_tokens: int = 0
    estimated_output_tokens: int = 0
    actual_output_tokens: int = 0

    model_cost: Decimal = Field(default=Decimal("0"), sa_column=money_nn())
    routing_overhead_cost: Decimal = Field(default=Decimal("0"), sa_column=money_nn())
    backend_cost: Decimal = Field(default=Decimal("0"), sa_column=money_nn())
    estimated_savings: Decimal = Field(default=Decimal("0"), sa_column=money_nn())

    degraded_requests: int = 0
    blocked_requests: int = 0
    avg_latency: Optional[float] = None
    p95_latency: Optional[float] = None


class Budget(SQLModel, table=True):
    __tablename__ = "budgets"

    consumer: str = Field(primary_key=True)
    budget: Decimal = Field(sa_column=Column(Numeric(24, 10), nullable=False))
    warning_threshold: float = 0.8
    currency: str = "USD"


class RoutingConfig(SQLModel, table=True):
    __tablename__ = "routing_config"

    id: str = Field(default_factory=_uuid, primary_key=True)
    consumer: Optional[str] = Field(default=None, index=True)
    category: str = Field(index=True)
    complexity_tier: str = Field(index=True)
    provider: str
    model: str
    enabled: bool = True
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_by_api_key_id: str


class Alert(SQLModel, table=True):
    __tablename__ = "alerts"

    id: str = Field(default_factory=_uuid, primary_key=True)
    type: str = Field(index=True)
    consumer: str = Field(index=True)
    severity: str
    title: str
    message: str
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True)
    )
    related_audit_record_id: Optional[str] = None
    # Window key used for deduplication of recurring alerts (§16.1).
    dedup_key: Optional[str] = Field(default=None, index=True)


class Recommendation(SQLModel, table=True):
    __tablename__ = "recommendations"

    id: str = Field(default_factory=_uuid, primary_key=True)
    type: str = Field(index=True)
    consumer: str = Field(index=True)
    severity: str
    message: str
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False)
    )
