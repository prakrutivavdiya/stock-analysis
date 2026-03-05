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
from backend.database import create_all_tables
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
    system,
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

    # Create tables (dev only; use Alembic in production)
    await create_all_tables()
    log.info("Database tables verified")

    # Pre-load Kite instruments into memory
    from backend.routers.instruments import _load_instruments
    await _load_instruments()

    # Start APScheduler
    await start_scheduler()

    yield

    # Shutdown
    await shutdown_scheduler()
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
