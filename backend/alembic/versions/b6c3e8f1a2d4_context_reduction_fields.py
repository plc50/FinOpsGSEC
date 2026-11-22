"""context reduction fields

Revision ID: b6c3e8f1a2d4
Revises: a7e4c2b9d1f0
Create Date: 2026-07-02 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b6c3e8f1a2d4"
down_revision: Union[str, None] = "a7e4c2b9d1f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "audit_records",
        sa.Column(
            "context_reduced",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "audit_records",
        sa.Column("context_tokens_saved", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("audit_records", "context_tokens_saved")
    op.drop_column("audit_records", "context_reduced")
