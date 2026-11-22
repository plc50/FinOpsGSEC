"""semantic cache pgvector

Revision ID: a7e4c2b9d1f0
Revises: f2a8b0c1d9e3
Create Date: 2026-07-02 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = "a7e4c2b9d1f0"
down_revision: Union[str, None] = "f2a8b0c1d9e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute(
        """
        CREATE TABLE semantic_cache_entries (
            id TEXT PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL,
            last_hit_at TIMESTAMPTZ,
            hit_count INTEGER NOT NULL DEFAULT 0,
            consumer TEXT NOT NULL,
            selected_provider TEXT NOT NULL,
            selected_model TEXT NOT NULL,
            model_id TEXT NOT NULL,
            generation_fingerprint TEXT NOT NULL,
            prompt_fingerprint TEXT NOT NULL,
            prompt_text TEXT NOT NULL,
            embedding vector(384) NOT NULL,
            response JSONB NOT NULL,
            prompt_tokens INTEGER NOT NULL,
            completion_tokens INTEGER NOT NULL,
            total_tokens INTEGER NOT NULL,
            cost NUMERIC(24, 10) NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE INDEX ix_semantic_cache_lookup
        ON semantic_cache_entries (
            consumer,
            selected_provider,
            selected_model,
            generation_fingerprint,
            created_at
        )
        """
    )
    op.execute(
        """
        CREATE INDEX ix_semantic_cache_embedding
        ON semantic_cache_entries
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS semantic_cache_entries")
