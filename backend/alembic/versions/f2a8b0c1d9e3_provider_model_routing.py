"""provider model routing

Revision ID: f2a8b0c1d9e3
Revises: c1d400194cca
Create Date: 2026-07-02 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel

revision: str = "f2a8b0c1d9e3"
down_revision: Union[str, None] = "c1d400194cca"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "audit_records",
        sa.Column("selected_provider", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.alter_column("audit_records", "logical_model", new_column_name="selected_model")
    op.add_column(
        "audit_records",
        sa.Column("routing_source", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.add_column(
        "audit_records",
        sa.Column("routing_config_id", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.add_column(
        "audit_records",
        sa.Column("baseline_provider", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.alter_column(
        "audit_records",
        "baseline_logical_model",
        new_column_name="baseline_model",
    )
    op.alter_column(
        "audit_records",
        "baseline_logical_cost",
        new_column_name="baseline_model_cost",
    )
    op.alter_column(
        "audit_records",
        "estimated_logical_cost",
        new_column_name="estimated_model_cost",
    )
    op.alter_column(
        "audit_records",
        "actual_logical_cost",
        new_column_name="actual_model_cost",
    )
    op.drop_column("audit_records", "demo_backend")

    op.add_column(
        "usage_hourly",
        sa.Column("selected_provider", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.alter_column("usage_hourly", "logical_model", new_column_name="selected_model")
    op.alter_column("usage_hourly", "logical_cost", new_column_name="model_cost")

    op.create_table(
        "routing_config",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("consumer", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("category", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("complexity_tier", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("provider", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("model", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by_api_key_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_routing_config_consumer"), "routing_config", ["consumer"])
    op.create_index(op.f("ix_routing_config_category"), "routing_config", ["category"])
    op.create_index(
        op.f("ix_routing_config_complexity_tier"),
        "routing_config",
        ["complexity_tier"],
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_routing_config_complexity_tier"), table_name="routing_config")
    op.drop_index(op.f("ix_routing_config_category"), table_name="routing_config")
    op.drop_index(op.f("ix_routing_config_consumer"), table_name="routing_config")
    op.drop_table("routing_config")

    op.alter_column("usage_hourly", "model_cost", new_column_name="logical_cost")
    op.alter_column("usage_hourly", "selected_model", new_column_name="logical_model")
    op.drop_column("usage_hourly", "selected_provider")

    op.add_column(
        "audit_records",
        sa.Column("demo_backend", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.alter_column(
        "audit_records",
        "actual_model_cost",
        new_column_name="actual_logical_cost",
    )
    op.alter_column(
        "audit_records",
        "estimated_model_cost",
        new_column_name="estimated_logical_cost",
    )
    op.alter_column(
        "audit_records",
        "baseline_model_cost",
        new_column_name="baseline_logical_cost",
    )
    op.alter_column(
        "audit_records",
        "baseline_model",
        new_column_name="baseline_logical_model",
    )
    op.drop_column("audit_records", "baseline_provider")
    op.drop_column("audit_records", "routing_config_id")
    op.drop_column("audit_records", "routing_source")
    op.alter_column("audit_records", "selected_model", new_column_name="logical_model")
    op.drop_column("audit_records", "selected_provider")
