"""original category field (category policy downgrade)

Revision ID: d8e5a3c7f9b2
Revises: b6c3e8f1a2d4
Create Date: 2026-07-02 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d8e5a3c7f9b2"
down_revision: Union[str, None] = "b6c3e8f1a2d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "audit_records",
        sa.Column("original_category", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("audit_records", "original_category")
