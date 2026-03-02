# Auth Implementation Guide
## StockPilot — Multi-User Kite OAuth Design

**Version:** 1.0
**Date:** 2026-03-01
**Covers:** Gaps left by SECURITY.md and API_SPEC.md for implementation

---

## 1. The Complete Kite OAuth Flow (Step by Step)

```
Browser                    StockPilot Backend              Zerodha / Kite
  │                               │                               │
  │── GET /auth/login ────────────▶│                               │
  │                               │ KiteConnect(api_key)          │
  │                               │   .login_url()                │
  │◀── { login_url: "https://..." }│                               │
  │                               │                               │
  │── redirect to login_url ──────────────────────────────────────▶│
  │                               │                               │ User enters
  │                               │                               │ Zerodha creds
  │◀── redirect to /auth/callback?request_token=<one_time_token> ──│
  │                               │                               │
  │── GET /auth/callback ─────────▶│                               │
  │   ?request_token=<token>      │                               │
  │                               │── generate_session() ─────────▶│
  │                               │   (request_token + api_secret) │
  │                               │◀── { access_token, user_id,    │
  │                               │      user_name, email, ... }   │
  │                               │                               │
  │                               │ [Upsert user row — see §3]    │
  │                               │ [Issue StockPilot JWT]        │
  │                               │ [Issue refresh token]         │
  │                               │                               │
  │◀── Set-Cookie: access_token   │                               │
  │    Set-Cookie: refresh_token  │                               │
  │    { user: {...}, expires_in }│                               │
```

### Key facts about `request_token`
- Single-use, short-lived (~5 minutes)
- Zerodha generates a fresh one each login
- It is NOT the Kite `access_token` — it is only valid for the `generate_session()` exchange

### Key facts about Kite `access_token`
- Expires at the **end of the calendar day** (approximately midnight IST / 18:30 UTC)
- Not revocable via API — it simply stops working after expiry
- Valid for the duration of the trading day
- New token issued every time the user logs in via OAuth

---

## 2. Backend Implementation: `/auth/login`

```python
# routers/auth.py
@router.get("/auth/login")
def login():
    kite = KiteConnect(api_key=settings.KITE_API_KEY)
    return {"login_url": kite.login_url()}
```

No DB access needed. Stateless — just generates the OAuth redirect URL.

---

## 3. Backend Implementation: `/auth/callback`

```python
# routers/auth.py
@router.get("/auth/callback")
async def callback(
    request_token: str,
    db: Session = Depends(get_db),
    response: Response = ...,
):
    # Step 1: Exchange request_token for Kite access_token
    kite = KiteConnect(api_key=settings.KITE_API_KEY)
    try:
        session_data = kite.generate_session(
            request_token,
            api_secret=settings.KITE_API_SECRET,
        )
    except KiteException as e:
        raise HTTPException(403, detail=f"Kite auth failed: {e}")

    # session_data keys: access_token, user_id, user_name, email,
    #                    user_type, broker, exchanges, products, order_types

    # Step 2: Upsert user row
    user = await auth_service.upsert_user(db, session_data)

    # Step 3: Issue StockPilot JWT
    jwt_token = security.create_access_token(
        subject=str(user.id),
        kite_user_id=user.kite_user_id,
    )

    # Step 4: Issue refresh token
    raw_refresh, refresh_hash = security.create_refresh_token()
    await auth_service.store_refresh_token(
        db,
        user_id=user.id,
        token_hash=refresh_hash,
        user_agent=request.headers.get("User-Agent"),
        ip_address=request.client.host,
    )

    # Step 5: Set httpOnly cookies
    response.set_cookie("access_token", jwt_token, httponly=True, secure=True, samesite="strict", max_age=28800)
    response.set_cookie("refresh_token", raw_refresh, httponly=True, secure=True, samesite="strict", path="/api/v1/auth/refresh", max_age=2592000)

    return {
        "user": {"user_id": user.kite_user_id, "name": user.username, "email": user.email},
        "expires_in": 28800,
    }
```

### `auth_service.upsert_user` logic

```python
async def upsert_user(db: Session, session_data: dict) -> User:
    kite_user_id = session_data["user_id"]

    # Compute Kite token expiry (end of calendar day IST = 23:59:59 IST)
    ist = pytz.timezone("Asia/Kolkata")
    today_ist = datetime.now(ist).date()
    kite_expires_at = ist.localize(
        datetime.combine(today_ist, time(23, 59, 59))
    ).astimezone(pytz.utc)

    # Encrypt Kite access_token for storage
    encrypted_token = security.encrypt_kite_token(session_data["access_token"])

    user = db.query(User).filter_by(kite_user_id=kite_user_id).first()

    if user is None:
        # First login — create new user
        user = User(
            kite_user_id=kite_user_id,
            username=session_data["user_name"],
            email=session_data.get("email", ""),
            kite_access_token_enc=encrypted_token,
            kite_token_expires_at=kite_expires_at,
        )
        db.add(user)
    else:
        # Returning user — refresh token and login timestamp
        user.kite_access_token_enc = encrypted_token
        user.kite_token_expires_at = kite_expires_at
        user.last_login_at = datetime.utcnow()
        user.username = session_data["user_name"]      # name can change
        user.email = session_data.get("email", user.email)

    db.commit()
    db.refresh(user)
    return user
```

**Access control policy:** Any Zerodha account holder can create a user row on first login.
To restrict access to specific users, set `ALLOWED_KITE_USER_IDS` in `.env`
as a comma-separated list. Empty (default) = open to all Kite account holders.

```python
# In upsert_user, before INSERT:
allowed = settings.ALLOWED_KITE_USER_IDS  # e.g. "BBQ846,XYZ123" or ""
if allowed and kite_user_id not in allowed.split(","):
    raise HTTPException(403, detail="Account not permitted")
```

---

## 4. Multi-User KiteConnect Instance Management

**Rule:** Create a new `KiteConnect` instance per request. Do NOT cache decrypted tokens in memory.

**Why not cache:** A decrypted Kite token in memory is a high-value target if the process is compromised. The AES-256-GCM decrypt is ~10µs — negligible compared to a Kite network call (~200ms).

```python
# core/kite_client.py

class KiteClient:
    """Singleton. Holds shared rate limiter. Creates per-user KiteConnect instances."""

    def __init__(self):
        self._api_key = settings.KITE_API_KEY
        self._historical_limiter = HistoricalRateLimiter()  # see §7

    def for_user(self, user: User) -> KiteConnect:
        """Decrypt token and return a ready KiteConnect instance for this user."""
        access_token = security.decrypt_kite_token(user.kite_access_token_enc)
        kc = KiteConnect(api_key=self._api_key)
        kc.set_access_token(access_token)
        return kc

    async def get_historical(self, user: User, **kwargs) -> list:
        """Rate-limited historical data fetch (global 3 req/sec across all users)."""
        await self._historical_limiter.acquire()
        return self.for_user(user).historical_data(**kwargs)


# Singleton — registered in FastAPI lifespan
kite_client = KiteClient()

def get_kite_client() -> KiteClient:
    return kite_client
```

### Usage in a route

```python
@router.get("/portfolio/holdings")
async def get_holdings(
    user: User = Depends(get_current_user),
    kite_client: KiteClient = Depends(get_kite_client),
):
    kite = kite_client.for_user(user)   # decrypt + build instance
    return kite.holdings()
```

---

## 5. `get_current_user` FastAPI Dependency

This is the dependency injected into every protected route. It converts an inbound JWT cookie into an authenticated `User` ORM object.

```python
# core/dependencies.py

async def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="NOT_AUTHENTICATED")

    try:
        payload = jwt.decode(
            token,
            settings.JWT_PUBLIC_KEY,
            algorithms=["RS256"],
        )
    except ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="TOKEN_EXPIRED")
    except JWTError:
        raise HTTPException(status_code=401, detail="INVALID_TOKEN")

    user_id: str = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="INVALID_TOKEN")

    user = db.query(User).filter_by(id=user_id, is_active=True).first()
    if not user:
        raise HTTPException(status_code=401, detail="USER_NOT_FOUND")

    return user


async def get_kite_for_user(
    user: User = Depends(get_current_user),
    kite_client: KiteClient = Depends(get_kite_client),
) -> KiteConnect:
    """Dependency for routes that need to call Kite API."""
    if user.kite_token_expires_at.replace(tzinfo=pytz.utc) < datetime.now(pytz.utc):
        raise HTTPException(status_code=401, detail="KITE_SESSION_EXPIRED")
    return kite_client.for_user(user)
```

### JWT payload structure

```json
{
  "sub": "550e8400-e29b-41d4-a716-446655440000",
  "kite_user_id": "ABC123",
  "exp": 1740480000,
  "iat": 1740451200,
  "jti": "unique-token-id"
}
```

- `sub` = `users.id` (UUID) — used for all DB lookups
- `kite_user_id` = informational only (not used for DB lookup)
- `jti` = allows future token blacklisting if needed

---

## 6. Kite Token Expiry Handling (Daily)

Kite access tokens expire every day. Users must re-authenticate via OAuth once per day.

### APScheduler health job (every 30 minutes)

```python
# core/scheduler.py

async def kite_health_check():
    """Mark users whose Kite token has expired. Runs every 30 minutes."""
    now = datetime.now(pytz.utc)
    with get_db_session() as db:
        expired_users = db.query(User).filter(
            User.kite_token_expires_at < now,
            User.is_active == True,
        ).all()

    for user in expired_users:
        logger.warning(
            "kite_token_expired",
            user_id=str(user.id),
            kite_user_id=user.kite_user_id,
            expired_at=user.kite_token_expires_at.isoformat(),
        )
    # No automatic action — user must re-login. Frontend detects 401 KITE_SESSION_EXPIRED.
```

### Frontend re-auth flow

```
Any API call
  │
  └── 401 { detail: "KITE_SESSION_EXPIRED" }
        │
        └── Frontend redirects to /auth/login
              │
              └── Full OAuth flow restarts (§1 above)
                    │
                    └── New access_token stored in DB → session continues
```

The re-auth flow is identical to first login — `upsert_user` overwrites the encrypted token and updates `kite_token_expires_at`.

---

## 7. Global Kite Historical API Rate Limiter

The app's Kite Connect API key allows **3 requests/second** for historical data — this limit is **per API key**, shared across all users simultaneously.

With multiple concurrent users fetching charts, a per-user bucket is insufficient. A global token bucket is required.

```python
# core/kite_client.py

import asyncio
import time

class HistoricalRateLimiter:
    """
    Global token bucket: 3 requests/second, shared across all users.
    Any request for historical data must acquire() before calling Kite.
    """

    def __init__(self, rate: int = 3):
        self._rate = rate                          # tokens per second
        self._tokens = float(rate)
        self._last_check = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self):
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_check
            self._last_check = now

            # Refill tokens based on elapsed time
            self._tokens = min(self._rate, self._tokens + elapsed * self._rate)

            if self._tokens >= 1:
                self._tokens -= 1
                return   # proceed immediately

            # Not enough tokens — sleep until next token available
            wait = (1 - self._tokens) / self._rate
            self._tokens = 0
        await asyncio.sleep(wait)
```

All `historical_data()` calls go through `kite_client.get_historical()`, which calls `await self._historical_limiter.acquire()` before hitting Kite. This serializes requests across all users transparently.

---

## 8. Refresh Token Rotation

```python
# services/auth_service.py

async def refresh_access_token(db: Session, raw_refresh_token: str) -> tuple[str, str]:
    """
    Validates inbound refresh token, rotates it, and returns new JWT + new raw refresh token.
    Raises 401 if token is invalid, revoked, or expired.
    """
    token_hash = hashlib.sha256(raw_refresh_token.encode()).hexdigest()

    record = db.query(RefreshToken).filter_by(token_hash=token_hash).first()

    if not record:
        raise HTTPException(401, "INVALID_REFRESH_TOKEN")
    if record.revoked:
        # Possible token reuse — revoke entire user's session family
        await revoke_all_user_tokens(db, record.user_id)
        raise HTTPException(401, "REFRESH_TOKEN_REUSED")
    if record.expires_at < datetime.utcnow():
        raise HTTPException(401, "REFRESH_TOKEN_EXPIRED")

    # Revoke old token
    record.revoked = True

    # Issue new JWT + new refresh token
    user = db.query(User).get(record.user_id)
    new_jwt = security.create_access_token(subject=str(user.id), kite_user_id=user.kite_user_id)
    new_raw, new_hash = security.create_refresh_token()

    db.add(RefreshToken(
        user_id=user.id,
        token_hash=new_hash,
        expires_at=datetime.utcnow() + timedelta(days=30),
    ))
    db.commit()

    return new_jwt, new_raw
```

---

## 9. Access Control Policy

| Scenario | Behaviour |
|----------|-----------|
| `ALLOWED_KITE_USER_IDS` is empty (default) | Any Zerodha account holder can log in and create an account |
| `ALLOWED_KITE_USER_IDS=BBQ846,XYZ123` | Only listed `kite_user_id` values can log in; others get `403` |
| `users.is_active = FALSE` | User is blocked at the `get_current_user` dependency; all requests return `401` |

The `is_active` column is the only ban mechanism. It must be set manually via DB query — no admin UI in v1.

```sql
-- Disable a user
UPDATE users SET is_active = FALSE WHERE kite_user_id = 'XYZ123';

-- Re-enable a user
UPDATE users SET is_active = TRUE WHERE kite_user_id = 'XYZ123';
```

---

## 10. Environment Variables (Updated)

```bash
# .env.example

# Application
APP_ENV=development

# Kite Connect
KITE_API_KEY=your_kite_api_key
KITE_API_SECRET=your_kite_api_secret
KITE_REDIRECT_URL=https://localhost:8000/api/v1/auth/callback

# Access control (optional — empty = open registration)
# Comma-separated list of Zerodha user IDs allowed to log in
ALLOWED_KITE_USER_IDS=

# Token Encryption (AES-256-GCM, 32 bytes base64-encoded)
KITE_TOKEN_ENCRYPTION_KEY=<generate: python -c "import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())">

# JWT (RS256 RSA key pair)
JWT_PRIVATE_KEY=<RSA 4096-bit PEM>
JWT_PUBLIC_KEY=<RSA 4096-bit PEM>
JWT_ALGORITHM=RS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=480
JWT_REFRESH_TOKEN_EXPIRE_DAYS=30

# Database
DATABASE_URL=mysql+pymysql://stockpilot:password@localhost:3306/stockpilot
# Dev SQLite: DATABASE_URL=sqlite:///./stockpilot.db

# CORS
CORS_ALLOWED_ORIGINS=https://localhost:3000
```

---

## 11. Data Isolation Enforcement (Checklist)

Every service method that reads user-scoped data MUST include a `user_id` filter.

| Table | Required filter | Example |
|-------|----------------|---------|
| `kpis` | `WHERE user_id = :uid` | `db.query(KPI).filter_by(user_id=user.id)` |
| `chart_drawings` | `WHERE user_id = :uid` | `db.query(Drawing).filter_by(user_id=user.id)` |
| `audit_logs` | `WHERE user_id = :uid` | `db.query(AuditLog).filter_by(user_id=user.id)` |
| `refresh_tokens` | `WHERE user_id = :uid` | Used internally in auth service |
| `ohlcv_cache` | No user filter — global | Market data shared across all users |
| `fundamental_cache` | No user filter — global | Fundamental data shared across all users |

**Rule:** If a route handler accepts a resource ID (e.g., `kpi_id`, `drawing_id`) it must always fetch it with BOTH the resource ID AND `user_id`. Never fetch by ID alone — that is an IDOR vulnerability.

```python
# Correct
kpi = db.query(KPI).filter_by(id=kpi_id, user_id=user.id).first()
if not kpi:
    raise HTTPException(404)

# WRONG — allows any authenticated user to access any KPI by guessing the UUID
kpi = db.query(KPI).filter_by(id=kpi_id).first()
```
