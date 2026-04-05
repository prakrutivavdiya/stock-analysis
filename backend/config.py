"""
Application settings — loaded from environment variables via pydantic-settings.
All values can be overridden via a .env file (see .env.example).
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Always resolve .env.local relative to this file (backend/), regardless of CWD
_ENV_FILE = Path(__file__).parent / ".env.local"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Database ──────────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://stockpilot:stockpilot@localhost:5432/stockpilot_dev"

    # ── Zerodha Kite Connect ──────────────────────────────────────────────────
    KITE_API_KEY: str = ""
    KITE_API_SECRET: str = ""
    KITE_REDIRECT_URL: str = "http://localhost:5174/api/v1/auth/callback"

    # ── JWT (RS256) ───────────────────────────────────────────────────────────
    JWT_PRIVATE_KEY: str = ""          # PEM-encoded RSA private key
    JWT_PUBLIC_KEY: str = ""           # PEM-encoded RSA public key
    JWT_ALGORITHM: str = "RS256"
    JWT_EXPIRY_SECONDS: int = 28800    # 8 hours
    REFRESH_TOKEN_EXPIRY_DAYS: int = 30

    # ── Kite Token Encryption (AES-256-GCM) ───────────────────────────────────
    # 32 bytes, base64-encoded
    KITE_ENCRYPTION_KEY: str = ""

    # ── CORS ──────────────────────────────────────────────────────────────────
    FRONTEND_URL: str = "http://localhost:5174"

    # ── App ───────────────────────────────────────────────────────────────────
    VERSION: str = "1.0.0"
    DEBUG: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
