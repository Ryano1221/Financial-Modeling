"""Add pricing tier and subscription fields to organizations

Revision ID: 003_pricing_tiers
Revises: 002_organization_branding
Create Date: 2026-04-14
"""
from alembic import op
import sqlalchemy as sa

revision = "003_pricing_tiers"
down_revision = "002_organization_branding"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("stripe_subscription_id", sa.String(), nullable=True),
    )
    op.add_column(
        "organizations",
        sa.Column("plan_tier", sa.String(), nullable=False, server_default="starter"),
    )
    op.add_column(
        "organizations",
        sa.Column("subscription_status", sa.String(), nullable=False, server_default="none"),
    )
    op.add_column(
        "organizations",
        sa.Column("trial_ends_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "organizations",
        sa.Column("monthly_pdf_exports", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "organizations",
        sa.Column("monthly_ai_extractions", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "organizations",
        sa.Column("usage_reset_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("organizations", "usage_reset_at")
    op.drop_column("organizations", "monthly_ai_extractions")
    op.drop_column("organizations", "monthly_pdf_exports")
    op.drop_column("organizations", "trial_ends_at")
    op.drop_column("organizations", "subscription_status")
    op.drop_column("organizations", "plan_tier")
    op.drop_column("organizations", "stripe_subscription_id")
