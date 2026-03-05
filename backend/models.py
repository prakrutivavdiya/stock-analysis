"""
SQLAlchemy 2.0 ORM models — StockPilot backend

Matches DATA_MODEL v7.0 exactly:
  7 tables — users, refresh_tokens, audit_logs, ohlcv_cache,
              kpis, chart_drawings, fundamental_cache

PostgreSQL column types are used throughout; SQLite equivalents are handled
transparently by SQLAlchemy's dialect layer (UUID → CHAR(32), JSONB → TEXT,
INET → VARCHAR, NUMERIC → REAL, etc.).
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database import Base

# ---------------------------------------------------------------------------
# 1. users
# DATA_MODEL §1 — one row per registered Zerodha Kite user
# ---------------------------------------------------------------------------

class User(Base):
    __tablename__ = "users"

    # Primary key
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # Zerodha Kite identity
    kite_user_id: Mapped[str] = mapped_column(
        String(20), nullable=False, unique=True,
        comment="Zerodha user ID (e.g. BBQ846)",
    )
    username: Mapped[str] = mapped_column(
        String(100), nullable=False,
        comment="Full name from Kite profile",
    )
    email: Mapped[str] = mapped_column(
        String(255), nullable=False, unique=True,
        comment="Email from Kite profile",
    )

    # Encrypted Kite access token (AES-256-GCM, AU-06)
    kite_access_token_enc: Mapped[str] = mapped_column(
        Text, nullable=False,
        comment="Kite access token encrypted at rest (AES-256-GCM)",
    )
    kite_token_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        comment="When the Kite session expires (~midnight IST daily)",
    )

    # Account metadata from Kite profile (stored at first login — ST-02)
    exchange_memberships: Mapped[list[str]] = mapped_column(
        JSON, nullable=False,
        comment='Exchanges enabled for this account e.g. ["NSE","BSE"]',
    )
    product_types: Mapped[list[str]] = mapped_column(
        JSON, nullable=False,
        comment='Products enabled e.g. ["CNC","MIS","NRML"]',
    )

    # Paper trade mode (TR-17) — enforced server-side before forwarding to Kite
    paper_trade_mode: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("FALSE"),
        comment="When TRUE, orders are simulated locally and never sent to Kite",
    )

    # Account status
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("TRUE"),
        comment="FALSE = user banned; blocked at get_current_user dependency",
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=text("NOW()"),
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Timestamp of the last successful OAuth login",
    )

    # Relationships
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        "RefreshToken", back_populates="user", cascade="all, delete-orphan"
    )
    audit_logs: Mapped[list["AuditLog"]] = relationship(
        "AuditLog", back_populates="user", cascade="all, delete-orphan"
    )
    kpis: Mapped[list["KPI"]] = relationship(
        "KPI", back_populates="user", cascade="all, delete-orphan"
    )
    chart_drawings: Mapped[list["ChartDrawing"]] = relationship(
        "ChartDrawing", back_populates="user", cascade="all, delete-orphan"
    )

    # Indexes per DATA_MODEL spec
    __table_args__ = (
        Index("ix_users_kite_user_id", "kite_user_id", unique=True),
        Index("ix_users_email", "email", unique=True),
        Index("ix_users_kite_token_expires_at", "kite_token_expires_at"),
    )

    def __repr__(self) -> str:
        return f"<User kite_user_id={self.kite_user_id!r}>"


# ---------------------------------------------------------------------------
# 2. refresh_tokens
# DATA_MODEL §2 — server-side JWT refresh token records (AU-04)
# ---------------------------------------------------------------------------

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # SHA-256 hash of the raw refresh token (never store the raw token)
    token_hash: Mapped[str] = mapped_column(
        String(128), nullable=False, unique=True,
        comment="SHA-256 hash of the raw refresh token",
    )

    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        comment="30 days from creation",
    )

    # Revoked on use (rotation) or explicit logout (AU-05)
    revoked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("FALSE"),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=text("NOW()"),
    )

    # Optional browser fingerprint for display in Sessions UI
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(
        String(45), nullable=True,
        comment="Client IP address at token creation time (IPv4 or IPv6)",
    )

    # Relationship
    user: Mapped["User"] = relationship("User", back_populates="refresh_tokens")

    __table_args__ = (
        Index("ix_refresh_tokens_token_hash", "token_hash", unique=True),
        Index("ix_refresh_tokens_user_id", "user_id"),
    )

    def __repr__(self) -> str:
        return f"<RefreshToken user_id={self.user_id} revoked={self.revoked}>"


# ---------------------------------------------------------------------------
# 3. audit_logs
# DATA_MODEL §3 — immutable trade action log (AU-10, TR-08, TR-17)
# No UPDATE or DELETE permitted — enforced at application layer
# ---------------------------------------------------------------------------

# Valid action_type values (DATA_MODEL §3)
AUDIT_ACTION_TYPES = (
    "PLACE_ORDER",
    "MODIFY_ORDER",
    "CANCEL_ORDER",
    "PLACE_GTT",
    "MODIFY_GTT",
    "DELETE_GTT",
    "PAPER_TRADE",   # TR-17: paper trade mode — simulated locally
)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Action type — one of AUDIT_ACTION_TYPES
    action_type: Mapped[str] = mapped_column(
        String(50), nullable=False,
        comment="PLACE_ORDER | MODIFY_ORDER | CANCEL_ORDER | PLACE_GTT | MODIFY_GTT | DELETE_GTT | PAPER_TRADE",
    )

    tradingsymbol: Mapped[str] = mapped_column(String(30), nullable=False)
    exchange: Mapped[str] = mapped_column(String(10), nullable=False)

    # Full payload sent to (or simulated for) Kite
    order_params: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False,
        comment="Full request payload sent to Kite (or simulated in paper trade mode)",
    )

    # Kite response IDs — NULL on failure or paper trade
    kite_order_id: Mapped[str | None] = mapped_column(
        String(50), nullable=True,
        comment="Kite order ID returned on success",
    )
    kite_gtt_id: Mapped[int | None] = mapped_column(
        BigInteger, nullable=True,
        comment="Kite GTT trigger ID returned on success",
    )

    # Outcome
    outcome: Mapped[str] = mapped_column(
        String(20), nullable=False,
        comment="SUCCESS | FAILURE",
    )
    error_message: Mapped[str | None] = mapped_column(
        Text, nullable=True,
        comment="Kite error description if outcome = FAILURE",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=text("NOW()"),
    )

    # Correlation ID for distributed tracing
    request_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True,
        comment="Request correlation ID for log tracing",
    )

    # Relationship
    user: Mapped["User"] = relationship("User", back_populates="audit_logs")

    __table_args__ = (
        Index("ix_audit_logs_user_id", "user_id"),
        Index("ix_audit_logs_tradingsymbol", "tradingsymbol"),
        Index("ix_audit_logs_created_at", "created_at"),
        # Composite index for the audit log page query: filter by user + date range (US-080)
        Index("ix_audit_logs_user_created", "user_id", "created_at"),
    )

    def __repr__(self) -> str:
        return (
            f"<AuditLog action={self.action_type!r} "
            f"symbol={self.tradingsymbol!r} outcome={self.outcome!r}>"
        )


# ---------------------------------------------------------------------------
# 4. ohlcv_cache
# DATA_MODEL §4 — global historical OHLCV cache (HD-04, HD-05)
# Not user-scoped — shared across all users
# ---------------------------------------------------------------------------

# Valid interval values matching Kite API and DATA_MODEL spec
OHLCV_INTERVALS = ("5minute", "15minute", "30minute", "60minute", "day")


class OHLCVCache(Base):
    __tablename__ = "ohlcv_cache"

    # Surrogate auto-increment PK for efficient pagination
    # Integer (not BigInteger) is used so SQLite autoincrement works in tests
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Instrument identity
    instrument_token: Mapped[int] = mapped_column(
        BigInteger, nullable=False,
        comment="Kite instrument token",
    )
    tradingsymbol: Mapped[str] = mapped_column(
        String(30), nullable=False,
        comment="For human readability — NOT the lookup key",
    )
    exchange: Mapped[str] = mapped_column(String(10), nullable=False)

    # Candle interval — one of OHLCV_INTERVALS
    interval: Mapped[str] = mapped_column(
        String(10), nullable=False,
        comment="5minute | 15minute | 30minute | 60minute | day",
    )

    # Candle open time (IST stored as UTC in TIMESTAMPTZ)
    candle_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        comment="Candle open time — IST stored as UTC",
    )

    # OHLCV values — NUMERIC(18,4) for price precision
    open: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    high: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    low: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    close: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    volume: Mapped[int] = mapped_column(BigInteger, nullable=False)

    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=text("NOW()"),
        comment="When this row was inserted into the cache",
    )

    __table_args__ = (
        # Unique constraint: one candle per (instrument, interval, timestamp)
        UniqueConstraint(
            "instrument_token", "interval", "candle_timestamp",
            name="uq_ohlcv_token_interval_ts",
        ),
        # Primary covering index for all typical chart queries
        Index(
            "ix_ohlcv_token_interval_ts",
            "instrument_token", "interval", "candle_timestamp",
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<OHLCVCache token={self.instrument_token} "
            f"interval={self.interval!r} ts={self.candle_timestamp}>"
        )


# ---------------------------------------------------------------------------
# 5. kpis
# DATA_MODEL §5 — user-defined KPI formula definitions (KP-01, KP-06)
# Computed values are NOT stored here — they live in the frontend Zustand store
# ---------------------------------------------------------------------------

# Valid return_type values (KP-07)
KPI_RETURN_TYPES = ("SCALAR", "BOOLEAN", "CATEGORICAL")


class KPI(Base):
    __tablename__ = "kpis"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(
        String(100), nullable=False,
        comment='e.g. "RSI Overbought"',
    )
    formula: Mapped[str] = mapped_column(
        Text, nullable=False,
        comment='e.g. "RSI(14) > 70" — validated on save (KP-09)',
    )

    # Return type: SCALAR | BOOLEAN | CATEGORICAL  (KP-07)
    return_type: Mapped[str] = mapped_column(
        String(20), nullable=False,
        comment="SCALAR (numeric) | BOOLEAN (true/false) | CATEGORICAL (descriptive label)",
    )

    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Column display controls
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("TRUE"),
        comment="Whether shown in portfolio table (KP-08)",
    )
    display_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0"),
        comment="Column order in portfolio view (KP-08)",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=text("NOW()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=text("NOW()"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationship
    user: Mapped["User"] = relationship("User", back_populates="kpis")

    __table_args__ = (
        Index("ix_kpis_user_id", "user_id"),
        # Prevent duplicate KPI names per user (KP-01)
        UniqueConstraint("user_id", "name", name="uq_kpis_user_name"),
    )

    def __repr__(self) -> str:
        return f"<KPI name={self.name!r} return_type={self.return_type!r}>"


# ---------------------------------------------------------------------------
# 6. chart_drawings
# DATA_MODEL §6 — user chart annotations per instrument + interval (CH-04)
# ---------------------------------------------------------------------------

# Valid drawing types per DATA_MODEL §6
DRAWING_TYPES = ("hline", "trendline", "rectangle", "text")


class ChartDrawing(Base):
    __tablename__ = "chart_drawings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    instrument_token: Mapped[int] = mapped_column(BigInteger, nullable=False)
    tradingsymbol: Mapped[str] = mapped_column(String(30), nullable=False)
    exchange: Mapped[str] = mapped_column(String(10), nullable=False)

    # Interval this drawing belongs to
    interval: Mapped[str] = mapped_column(
        String(10), nullable=False,
        comment="5minute | 15minute | 30minute | 60minute | day",
    )

    # Drawing type: hline | trendline | rectangle | text  (CH-04)
    drawing_type: Mapped[str] = mapped_column(
        String(20), nullable=False,
        comment="hline | trendline | rectangle | text",
    )

    # Drawing coordinates and style — JSON schema per type in DATA_MODEL §6
    drawing_data: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False,
        comment=(
            "Coordinates and style. "
            "hline: {price, color, width, style}; "
            "trendline: {p1:{time,price}, p2:{time,price}, color, width}; "
            "rectangle: {topLeft:{time,price}, bottomRight:{time,price}, fillColor, borderColor}; "
            "text: {time, price, text, color, fontSize}"
        ),
    )

    label: Mapped[str | None] = mapped_column(
        String(200), nullable=True,
        comment="Optional user-facing label for the drawing",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=text("NOW()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=text("NOW()"),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationship
    user: Mapped["User"] = relationship("User", back_populates="chart_drawings")

    __table_args__ = (
        # Covers all chart load queries: load all drawings for a given instrument+interval
        Index("ix_chart_drawings_token_interval", "instrument_token", "interval"),
        Index("ix_chart_drawings_user_id", "user_id"),
        # Composite index for the actual API query: user + instrument + interval
        Index(
            "ix_chart_drawings_user_token_interval",
            "user_id", "instrument_token", "interval",
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<ChartDrawing type={self.drawing_type!r} "
            f"symbol={self.tradingsymbol!r} interval={self.interval!r}>"
        )


# ---------------------------------------------------------------------------
# 7. fundamental_cache
# DATA_MODEL §7 — P/E, EPS, 52W data from NSE India (KP-03, §5.10)
# Refreshed weekly on Sunday at 08:00 IST via APScheduler job
# NOT user-scoped — global market data shared across all users
# ---------------------------------------------------------------------------

class FundamentalCache(Base):
    __tablename__ = "fundamental_cache"

    # PK is instrument_token — one row per instrument (no surrogate id)
    instrument_token: Mapped[int] = mapped_column(
        BigInteger, primary_key=True,
        comment="Kite instrument token — one row per instrument",
    )

    tradingsymbol: Mapped[str] = mapped_column(String(30), nullable=False)
    exchange: Mapped[str] = mapped_column(String(10), nullable=False)

    # ISIN — used to match with NSE India data
    isin: Mapped[str | None] = mapped_column(
        String(12), nullable=True,
        comment="ISIN code — used to match with NSE data endpoints",
    )

    # Fundamental values from NSE India (soft dependency — KP-12)
    pe_ratio: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 4), nullable=True,
        comment="Price-to-Earnings ratio (pre-computed by NSE — not derived locally)",
    )
    eps: Mapped[Decimal | None] = mapped_column(
        Numeric(14, 4), nullable=True,
        comment="Earnings Per Share TTM",
    )
    book_value: Mapped[Decimal | None] = mapped_column(
        Numeric(14, 4), nullable=True,
        comment="Book value per share",
    )
    face_value: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 4), nullable=True,
        comment="Face value per share",
    )

    # 52-week range (from NSE; backend also computes independently from ohlcv_cache)
    week_52_high: Mapped[Decimal | None] = mapped_column(
        Numeric(18, 4), nullable=True,
        comment="52-week high price from NSE — reference; backend also computes from ohlcv_cache",
    )
    week_52_low: Mapped[Decimal | None] = mapped_column(
        Numeric(18, 4), nullable=True,
        comment="52-week low price from NSE",
    )

    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        server_default=text("NOW()"),
        comment="When this row was last refreshed by the weekly job",
    )
    data_date: Mapped[date | None] = mapped_column(
        Date, nullable=True,
        comment="The date the fundamental data is as of",
    )

    __table_args__ = (
        Index("ix_fundamental_cache_tradingsymbol", "tradingsymbol"),
    )

    def __repr__(self) -> str:
        return (
            f"<FundamentalCache symbol={self.tradingsymbol!r} "
            f"pe={self.pe_ratio} eps={self.eps}>"
        )
