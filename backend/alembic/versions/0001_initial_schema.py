"""initial_schema

Revision ID: 0001
Revises:
Create Date: 2026-04-03

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. users ──────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("kite_user_id", sa.String(20), nullable=False),
        sa.Column("username", sa.String(100), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("kite_access_token_enc", sa.Text, nullable=False),
        sa.Column(
            "kite_token_expires_at", sa.DateTime(timezone=True), nullable=False
        ),
        sa.Column("exchange_memberships", sa.JSON, nullable=False),
        sa.Column("product_types", sa.JSON, nullable=False),
        sa.Column(
            "paper_trade_mode",
            sa.Boolean,
            server_default=sa.text("FALSE"),
            nullable=False,
        ),
        sa.Column("ui_preferences", sa.JSON, nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean,
            server_default=sa.text("TRUE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kite_user_id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_kite_user_id", "users", ["kite_user_id"], unique=True)
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index(
        "ix_users_kite_token_expires_at", "users", ["kite_token_expires_at"]
    )

    # ── 2. refresh_tokens ─────────────────────────────────────────────────────
    op.create_table(
        "refresh_tokens",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "revoked",
            sa.Boolean,
            server_default=sa.text("FALSE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column("user_agent", sa.Text, nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "ix_refresh_tokens_token_hash", "refresh_tokens", ["token_hash"], unique=True
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])

    # ── 3. audit_logs ─────────────────────────────────────────────────────────
    op.create_table(
        "audit_logs",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action_type", sa.String(50), nullable=False),
        sa.Column("tradingsymbol", sa.String(30), nullable=False),
        sa.Column("exchange", sa.String(10), nullable=False),
        sa.Column("order_params", sa.JSON, nullable=False),
        sa.Column("kite_order_id", sa.String(50), nullable=True),
        sa.Column("kite_gtt_id", sa.BigInteger, nullable=True),
        sa.Column("outcome", sa.String(20), nullable=False),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column("request_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"])
    op.create_index(
        "ix_audit_logs_tradingsymbol", "audit_logs", ["tradingsymbol"]
    )
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])
    op.create_index(
        "ix_audit_logs_user_created", "audit_logs", ["user_id", "created_at"]
    )

    # ── 4. ohlcv_cache ────────────────────────────────────────────────────────
    op.create_table(
        "ohlcv_cache",
        sa.Column("id", sa.Integer, autoincrement=True, nullable=False),
        sa.Column("instrument_token", sa.BigInteger, nullable=False),
        sa.Column("tradingsymbol", sa.String(30), nullable=False),
        sa.Column("exchange", sa.String(10), nullable=False),
        sa.Column("interval", sa.String(10), nullable=False),
        sa.Column("candle_timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("open", sa.Numeric(18, 4), nullable=False),
        sa.Column("high", sa.Numeric(18, 4), nullable=False),
        sa.Column("low", sa.Numeric(18, 4), nullable=False),
        sa.Column("close", sa.Numeric(18, 4), nullable=False),
        sa.Column("volume", sa.BigInteger, nullable=False),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "instrument_token",
            "interval",
            "candle_timestamp",
            name="uq_ohlcv_token_interval_ts",
        ),
    )
    op.create_index(
        "ix_ohlcv_token_interval_ts",
        "ohlcv_cache",
        ["instrument_token", "interval", "candle_timestamp"],
    )

    # ── 5. kpis ───────────────────────────────────────────────────────────────
    op.create_table(
        "kpis",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("formula", sa.Text, nullable=False),
        sa.Column("return_type", sa.String(20), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean,
            server_default=sa.text("TRUE"),
            nullable=False,
        ),
        sa.Column(
            "display_order",
            sa.Integer,
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_kpis_user_name"),
    )
    op.create_index("ix_kpis_user_id", "kpis", ["user_id"])

    # ── 6. chart_drawings ─────────────────────────────────────────────────────
    op.create_table(
        "chart_drawings",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("instrument_token", sa.BigInteger, nullable=False),
        sa.Column("tradingsymbol", sa.String(30), nullable=False),
        sa.Column("exchange", sa.String(10), nullable=False),
        sa.Column("interval", sa.String(10), nullable=False),
        sa.Column("drawing_type", sa.String(20), nullable=False),
        sa.Column("drawing_data", sa.JSON, nullable=False),
        sa.Column("label", sa.String(200), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_chart_drawings_token_interval",
        "chart_drawings",
        ["instrument_token", "interval"],
    )
    op.create_index("ix_chart_drawings_user_id", "chart_drawings", ["user_id"])
    op.create_index(
        "ix_chart_drawings_user_token_interval",
        "chart_drawings",
        ["user_id", "instrument_token", "interval"],
    )

    # ── 7. fundamental_cache ──────────────────────────────────────────────────
    op.create_table(
        "fundamental_cache",
        sa.Column("instrument_token", sa.BigInteger, nullable=False),
        sa.Column("tradingsymbol", sa.String(30), nullable=False),
        sa.Column("exchange", sa.String(10), nullable=False),
        sa.Column("isin", sa.String(12), nullable=True),
        sa.Column("pe_ratio", sa.Numeric(10, 4), nullable=True),
        sa.Column("eps", sa.Numeric(14, 4), nullable=True),
        sa.Column("book_value", sa.Numeric(14, 4), nullable=True),
        sa.Column("face_value", sa.Numeric(10, 4), nullable=True),
        sa.Column("week_52_high", sa.Numeric(18, 4), nullable=True),
        sa.Column("week_52_low", sa.Numeric(18, 4), nullable=True),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column("data_date", sa.Date, nullable=True),
        sa.PrimaryKeyConstraint("instrument_token"),
    )
    op.create_index(
        "ix_fundamental_cache_tradingsymbol",
        "fundamental_cache",
        ["tradingsymbol"],
    )

    # ── 8. watchlists ─────────────────────────────────────────────────────────
    op.create_table(
        "watchlists",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column(
            "display_order",
            sa.Integer,
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_watchlist_user_name"),
    )
    op.create_index("ix_watchlists_user_id", "watchlists", ["user_id"])

    # ── 9. watchlist_items ────────────────────────────────────────────────────
    op.create_table(
        "watchlist_items",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("watchlist_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("instrument_token", sa.BigInteger, nullable=False),
        sa.Column("tradingsymbol", sa.String(50), nullable=False),
        sa.Column("exchange", sa.String(10), nullable=False),
        sa.Column(
            "display_order",
            sa.Integer,
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["watchlist_id"], ["watchlists.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "watchlist_id", "instrument_token", name="uq_watchlist_item_token"
        ),
    )
    op.create_index(
        "ix_watchlist_items_watchlist_id", "watchlist_items", ["watchlist_id"]
    )
    op.create_index("ix_watchlist_items_user_id", "watchlist_items", ["user_id"])


def downgrade() -> None:
    op.drop_table("watchlist_items")
    op.drop_table("watchlists")
    op.drop_table("fundamental_cache")
    op.drop_table("chart_drawings")
    op.drop_table("kpis")
    op.drop_table("ohlcv_cache")
    op.drop_table("audit_logs")
    op.drop_table("refresh_tokens")
    op.drop_table("users")
