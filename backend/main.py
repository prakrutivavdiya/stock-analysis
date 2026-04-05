"""
StockPilot FastAPI application entry point.

Run locally:
    uvicorn backend.main:app --reload --port 8000

Run in Docker:
    uvicorn backend.main:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from backend.config import settings

from backend.limiter import limiter
from backend.routers import (
    audit,
    auth,
    charts,
    fundamentals,
    gtt,
    historical,
    instruments,
    kpis,
    orders,
    portfolio,
    preferences,
    system,
    watchlist,
    ws,
)
from backend.scheduler import shutdown_scheduler, start_scheduler

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Rate limiter  (instance lives in backend/limiter.py; imported above)
# ─────────────────────────────────────────────────────────────────────────────

def _rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={
            "error": {
                "code": "RATE_LIMITED",
                "message": f"Rate limit exceeded: {exc.detail}",
                "request_id": request.headers.get("x-request-id", ""),
            }
        },
    )


# ─────────────────────────────────────────────────────────────────────────────
# Lifespan (startup / shutdown)
# ─────────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("StockPilot backend starting up…")

    # Pre-load Kite instruments into memory
    from backend.routers.instruments import _load_instruments
    await _load_instruments()

    # Start APScheduler
    await start_scheduler()

    # Load NSE holiday calendar from Kite (falls back to static 2026 list on failure)
    from backend.holidays import load_holidays_from_kite as _load_holidays
    try:
        from kiteconnect import KiteConnect as _KiteConnect2
        from backend.models import User as _User2
        from backend.crypto import decrypt_token as _decrypt2
        from datetime import datetime as _dt2
        async with __import__("backend.database", fromlist=["AsyncSessionLocal"]).AsyncSessionLocal() as _db2:
            _now2 = _dt2.utcnow()
            _huser = (await _db2.execute(
                __import__("sqlalchemy", fromlist=["select"]).select(_User2).where(
                    _User2.is_active == True,  # noqa: E712
                    _User2.kite_token_expires_at > _now2,
                ).limit(1)
            )).scalar_one_or_none()
            if _huser:
                _htoken = _decrypt2(_huser.kite_access_token_enc, settings.KITE_ENCRYPTION_KEY)
                _hkc = _KiteConnect2(api_key=settings.KITE_API_KEY)
                _hkc.set_access_token(_htoken)
                import asyncio as _asyncio2
                await _asyncio2.to_thread(_load_holidays, _hkc)
            else:
                log.info("Holidays: no active Kite session — using static 2026 holiday list")
    except Exception as _hexc:
        log.warning("Holidays: startup load failed (%s) — using static 2026 list", _hexc)

    # Start KiteTicker for live market data
    try:
        import asyncio as _asyncio
        from sqlalchemy import select as _select
        from kiteconnect import KiteConnect as _KiteConnect
        from backend.models import User as _User
        from backend.ticker import start_ticker
        from backend.crypto import decrypt_token as _decrypt

        async with __import__("backend.database", fromlist=["AsyncSessionLocal"]).AsyncSessionLocal() as _db:
            from datetime import datetime as _dt
            _now = _dt.utcnow()  # naive UTC matches stored format
            _user = (await _db.execute(
                _select(_User).where(
                    _User.is_active == True,           # noqa: E712
                    _User.kite_token_expires_at > _now,
                ).limit(1)
            )).scalar_one_or_none()
            if _user:
                _token = _decrypt(_user.kite_access_token_enc, settings.KITE_ENCRYPTION_KEY)
                _kc = _KiteConnect(api_key=settings.KITE_API_KEY)
                _kc.set_access_token(_token)
                _holdings = await _asyncio.to_thread(_kc.holdings)
                _tokens = list({h["instrument_token"] for h in _holdings if h.get("instrument_token")})
                # Also subscribe watchlist tokens
                from backend.models import WatchlistItem as _WLItem
                _wl_tokens = (await _db.execute(
                    _select(_WLItem.instrument_token).where(_WLItem.user_id == _user.id)
                )).scalars().all()
                _tokens = list(set(_tokens) | set(_wl_tokens))
                await start_ticker(_tokens, settings.KITE_API_KEY, _token)
            else:
                log.info("No active Kite session found — KiteTicker not started")
    except Exception as _exc:
        log.warning("KiteTicker startup skipped: %s", _exc)

    yield

    # Shutdown
    await shutdown_scheduler()
    from backend.ticker import stop_ticker
    await stop_ticker()
    log.info("StockPilot backend shut down")


# ─────────────────────────────────────────────────────────────────────────────
# Application
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="StockPilot API",
    description=(
        "Multi-user trading cockpit backed by Zerodha Kite Connect. "
        "Provides portfolio analytics, KPI computation, chart drawings, "
        "order execution, and audit logging."
    ),
    version=settings.VERSION,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# ── Rate limiting ─────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)
app.add_middleware(SlowAPIMiddleware)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,   # needed for httpOnly cookie auth
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
)

# ── Security headers middleware ───────────────────────────────────────────────
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if not settings.DEBUG:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://tradingview.com https://*.tradingview.com; "
        "connect-src 'self' https://kite.zerodha.com https://api.kite.trade "
        "https://tradingview.com https://*.tradingview.com; "
        "img-src 'self' data: https://*.tradingview.com; "
        "style-src 'self' 'unsafe-inline' https://*.tradingview.com;"
    )
    return response


# ── Request ID propagation ────────────────────────────────────────────────────
@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    import uuid as _uuid
    request_id = request.headers.get("x-request-id") or str(_uuid.uuid4())
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


# ─────────────────────────────────────────────────────────────────────────────
# Router registration
# ─────────────────────────────────────────────────────────────────────────────

_V1 = "/api/v1"

app.include_router(system.router,       prefix=_V1,                    tags=["system"])
app.include_router(auth.router,         prefix=f"{_V1}/auth",          tags=["auth"])
app.include_router(portfolio.router,    prefix=f"{_V1}/portfolio",     tags=["portfolio"])
app.include_router(historical.router,   prefix=f"{_V1}/historical",    tags=["historical"])
app.include_router(instruments.router,  prefix=f"{_V1}/instruments",   tags=["instruments"])
app.include_router(fundamentals.router, prefix=f"{_V1}/fundamentals",  tags=["fundamentals"])
app.include_router(kpis.router,         prefix=f"{_V1}/kpis",          tags=["kpis"])
app.include_router(charts.router,       prefix=f"{_V1}/charts",        tags=["charts"])
app.include_router(orders.router,       prefix=f"{_V1}/orders",        tags=["orders"])
app.include_router(gtt.router,          prefix=f"{_V1}/gtt",           tags=["gtt"])
app.include_router(audit.router,        prefix=f"{_V1}/audit",         tags=["audit"])
app.include_router(preferences.columns_router, prefix=f"{_V1}/user/columns",      tags=["preferences"])
app.include_router(preferences.router,         prefix=f"{_V1}/user/preferences",  tags=["preferences"])
app.include_router(watchlist.router,    prefix=f"{_V1}/watchlist",         tags=["watchlist"])
app.include_router(ws.router,           tags=["ws"])  # /ws/quotes — no /api/v1 prefix
