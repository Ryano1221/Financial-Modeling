"""Add organization branding table.

Revision ID: 002
Revises: 001
Create Date: 2026-02-19 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "organization_branding",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("organization_id", sa.String(), nullable=False),
        sa.Column("logo_bytes", sa.LargeBinary(), nullable=True),
        sa.Column("logo_content_type", sa.String(), nullable=True),
        sa.Column("logo_filename", sa.String(), nullable=True),
        sa.Column("logo_sha256", sa.String(), nullable=True),
        sa.Column("logo_updated_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id"),
    )


def downgrade() -> None:
    op.drop_table("organization_branding")
