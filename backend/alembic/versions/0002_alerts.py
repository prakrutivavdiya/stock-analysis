"""alerts and alert_notifications tables

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-06
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── alerts ────────────────────────────────────────────────────────────────
    op.create_table(
        "alerts",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"), nullable=False,
        ),
        sa.Column(
            "user_id", postgresql.UUID(as_uuid=True), nullable=False,
        ),
        sa.Column("tradingsymbol", sa.String(50), nullable=False),
        sa.Column("exchange", sa.String(10), nullable=False),
        sa.Column("instrument_token", sa.BigInteger, nullable=False),
        sa.Column("condition_type", sa.String(30), nullable=False),
        sa.Column("threshold", sa.Numeric(18, 4), nullable=False),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column(
            "status", sa.String(20),
            server_default=sa.text("'ACTIVE'"), nullable=False,
        ),
        sa.Column("triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"), nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_alerts_user_id", "alerts", ["user_id"])
    op.create_index("ix_alerts_instrument_token", "alerts", ["instrument_token"])
    op.create_index("ix_alerts_user_status", "alerts", ["user_id", "status"])
    op.create_index("ix_alerts_token_status", "alerts", ["instrument_token", "status"])

    # ── alert_notifications ───────────────────────────────────────────────────
    op.create_table(
        "alert_notifications",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"), nullable=False,
        ),
        sa.Column(
            "alert_id", postgresql.UUID(as_uuid=True), nullable=False,
        ),
        sa.Column(
            "user_id", postgresql.UUID(as_uuid=True), nullable=False,
        ),
        sa.Column("tradingsymbol", sa.String(50), nullable=False),
        sa.Column("exchange", sa.String(10), nullable=False),
        sa.Column(
            "triggered_at", sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"), nullable=False,
        ),
        sa.Column("trigger_price", sa.Numeric(18, 4), nullable=True),
        sa.Column("message", sa.String(300), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["alert_id"], ["alerts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_alert_notifs_user_id", "alert_notifications", ["user_id"])
    op.create_index("ix_alert_notifs_alert_id", "alert_notifications", ["alert_id"])
    op.create_index(
        "ix_alert_notifs_user_triggered",
        "alert_notifications", ["user_id", "triggered_at"],
    )


def downgrade() -> None:
    op.drop_table("alert_notifications")
    op.drop_table("alerts")
