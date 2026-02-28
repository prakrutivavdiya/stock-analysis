# Security Design Document
## StockPilot — Personal Trading & Analysis Platform

**Version:** 1.0
**Date:** 2026-02-25
**Classification:** Internal — Single User Private Application

---

## 1. Threat Model

Since StockPilot is a single-user, self-hosted personal application, the key threats are:

| # | Threat | Impact | Mitigation |
|---|--------|--------|-----------|
| T1 | Unauthorized user gains access to the web UI | Full portfolio exposure; ability to place trades | Strong auth, no public registration, single-user enforcement |
| T2 | Kite access token stolen from storage | Attacker can trade on Kite account | Token encrypted at rest (AES-256-GCM); key stored in env only |
| T3 | JWT stolen from cookie | Session hijacking | httpOnly + Secure + SameSite=Strict cookie; short expiry (8h) |
| T4 | CSRF attack tricks browser to place orders | Unauthorized trade placement | SameSite=Strict cookie; CSRF token on state-changing endpoints |
| T5 | SQL injection via API parameters | Data exfiltration or corruption | Parameterized queries via SQLAlchemy ORM; no raw SQL with user input |
| T6 | Brute-force login attempts | Account takeover | Rate limiting (10 req/min on auth); OAuth delegates credential checking to Kite |
| T7 | Man-in-the-middle attack | Token/data interception | HTTPS-only; HSTS; no HTTP fallback |
| T8 | Insecure direct object reference | Access to other users' data | Not applicable (single user), but all queries include user_id filter |
| T9 | Accidental destructive trade | Financial loss | Order confirmation dialog; audit log; paper-trade mode flag |
| T10 | Sensitive data in logs | Token/credential leakage | Structured logging strips sensitive fields; never log raw tokens |

---

## 2. Authentication & Session Security

### 2.1 Kite OAuth (Delegated Authentication)
- Credentials (username/password) are **never handled by StockPilot**
- Authentication is fully delegated to Zerodha's OAuth 2.0 flow
- Only the `request_token` (short-lived, single-use) is received by StockPilot
- `request_token` is immediately exchanged for a `access_token` via Kite SDK (server-side, never exposed to browser)

### 2.2 JWT Access Token
| Property | Value |
|----------|-------|
| Algorithm | RS256 (asymmetric) |
| Expiry | 8 hours |
| Storage | httpOnly cookie (never accessible to JavaScript) |
| Claims | `sub` (user_id), `exp`, `iat`, `jti` (unique token ID) |
| Signing key | 4096-bit RSA private key (stored in `JWT_PRIVATE_KEY` env var) |
| Verification key | RSA public key (stored in `JWT_PUBLIC_KEY` env var) |

### 2.3 Refresh Token
| Property | Value |
|----------|-------|
| Value | Cryptographically random 256-bit token (secrets.token_urlsafe) |
| Storage (client) | httpOnly Secure SameSite=Strict cookie |
| Storage (server) | SHA-256 hash only — raw token never stored |
| Expiry | 30 days |
| Revocation | Server-side: `revoked = TRUE` in `refresh_tokens` table |
| Rotation | New refresh token issued on every use (old one revoked) |

### 2.4 Cookie Security Attributes
```
Set-Cookie: access_token=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=28800
Set-Cookie: refresh_token=<token>; HttpOnly; Secure; SameSite=Strict; Path=/api/auth/refresh; Max-Age=2592000
```

### 2.5 Single-User Enforcement
- On first OAuth callback, user record is created if none exists
- On subsequent logins, existing user record is found by `kite_user_id`
- If a `kite_user_id` that does NOT match `ALLOWED_KITE_USER_ID` env var attempts login → `403 Forbidden`
- This ensures only Prakruti (`BBQ846`) can use this application, even if the URL were discovered

---

## 3. Kite Token Encryption at Rest

The Kite `access_token` (a sensitive credential) is stored encrypted in the database.

### Encryption Scheme: AES-256-GCM
```python
# Pseudocode
key = os.getenv("KITE_TOKEN_ENCRYPTION_KEY")  # 32 raw bytes, base64 encoded
iv  = secrets.token_bytes(12)                   # 96-bit nonce per encryption
ciphertext, tag = AES_GCM_encrypt(key, iv, plaintext)
stored = base64(iv + tag + ciphertext)          # Stored in DB column
```

- Encryption key is stored **only in the environment** (`.env` file or Docker secret)
- Key is never written to the database or logged
- Each encryption uses a fresh random IV
- GCM provides authenticated encryption (integrity + confidentiality)

---

## 4. Transport Security

### 4.1 HTTPS Everywhere
- Nginx terminates TLS with Let's Encrypt certificate (or self-signed for local dev)
- HTTP requests are redirected to HTTPS (301)
- HSTS header set: `Strict-Transport-Security: max-age=31536000; includeSubDomains`

### 4.2 Security Headers (Nginx)
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

### 4.3 CORS
```python
# Only the specific frontend origin is allowed
CORS_ALLOWED_ORIGINS = ["https://localhost:3000"]  # Dev
# Production: ["https://stockpilot.local"]
```
No wildcard (`*`) origins permitted.

---

## 5. Input Validation & Injection Prevention

### 5.1 SQL Injection
- All database queries use SQLAlchemy ORM with parameterized binds
- Raw SQL strings with user input are **never used**
- User-provided filter values go through Pydantic type validation before reaching the DB layer

### 5.2 KPI Formula Injection
KPI formulas are user-defined but must not allow arbitrary code execution:
- Formula is parsed by a **custom restricted parser** (not Python `eval()`)
- Parser only allows: whitelisted function names, numeric literals, arithmetic operators
- Parsing happens at save time; invalid formulas are rejected with `400`
- Evaluation happens in a sandboxed context over a pandas DataFrame

### 5.3 Order Parameter Validation
- All order fields validated by Pydantic schemas before reaching Kite API
- `quantity` must be positive integer; `price` must be positive numeric
- `tradingsymbol` validated against instrument lookup — not accepted as free text
- `exchange` constrained to enum: `NSE`, `BSE`, `MCX`, `NFO`, `BFO`

---

## 6. Rate Limiting

Implemented as an in-process token bucket per endpoint group:

| Endpoint Group | Requests | Window |
|---------------|----------|--------|
| `/api/v1/auth/*` | 10 | 1 minute |
| `/api/v1/orders` (POST/PUT/DELETE) | 20 | 1 minute |
| `/api/v1/gtt` (POST/PUT/DELETE) | 20 | 1 minute |
| `/api/v1/historical/*` | 60 | 1 minute |
| All other | 120 | 1 minute |

On limit exceeded: `429 Too Many Requests` with `Retry-After` header.

The Kite API itself enforces 3 requests/second for historical data — the `KiteClient` wrapper implements a token bucket to stay within this limit.

---

## 7. Audit Logging

All trade-modifying actions are permanently recorded in `audit_logs`:

| What is logged | Details |
|----------------|---------|
| Every `POST /orders` | Full request payload, Kite order ID, outcome |
| Every `PUT /orders/{id}` | Modification payload, outcome |
| Every `DELETE /orders/{id}` | Cancellation, outcome |
| Every `POST /gtt` | Full GTT params, trigger ID, outcome |
| Every `PUT /gtt/{id}` | Modification params, outcome |
| Every `DELETE /gtt/{id}` | Deletion, outcome |

**What is NOT logged:**
- Read-only requests (GET endpoints)
- JWT tokens, Kite tokens, passwords — never in logs

**Immutability:**
- `audit_logs` rows have no UPDATE or DELETE at the application layer
- In PostgreSQL production: a `RULE` or trigger can enforce this at DB level

---

## 8. Sensitive Data Handling

| Data | Where Stored | Protection |
|------|-------------|------------|
| Zerodha password | Never stored | Delegated to Kite OAuth |
| Kite access_token | `users.kite_access_token_enc` | AES-256-GCM encrypted |
| JWT access token | httpOnly cookie | Never in localStorage; never in logs |
| Refresh token (raw) | httpOnly cookie | Never stored on server; only SHA-256 hash stored |
| RSA private key (JWT signing) | `.env` / Docker secret | Never in DB or code |
| Encryption key (AES) | `.env` / Docker secret | Never in DB or code |
| `ALLOWED_KITE_USER_ID` | `.env` | Controls who can log in |

---

## 9. Environment Variables

All secrets are managed via environment variables (`.env` for dev, Docker secrets for prod):

```bash
# .env.example (no real values)

# Application
APP_ENV=development
SECRET_APP_NAME=StockPilot

# Single-user allowlist
ALLOWED_KITE_USER_ID=BBQ846

# Kite Connect
KITE_API_KEY=your_kite_api_key
KITE_API_SECRET=your_kite_api_secret

# Token Encryption (AES-256-GCM key, 32 bytes base64)
KITE_TOKEN_ENCRYPTION_KEY=<generate with: python -c "import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())">

# JWT (RSA key pair)
JWT_PRIVATE_KEY=<RSA 4096-bit private key PEM>
JWT_PUBLIC_KEY=<RSA 4096-bit public key PEM>
JWT_ALGORITHM=RS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=480
JWT_REFRESH_TOKEN_EXPIRE_DAYS=30

# Database
DATABASE_URL=postgresql+asyncpg://stockpilot:password@db:5432/stockpilot
# Dev: DATABASE_URL=sqlite+aiosqlite:///./stockpilot.db

# CORS
CORS_ALLOWED_ORIGINS=https://localhost:3000

# Frontend callback URL after Kite OAuth
KITE_REDIRECT_URL=https://localhost:8000/api/v1/auth/callback
```

**Never commit `.env` to version control.** `.env` is in `.gitignore`.

---

## 10. Security Checklist

### Before First Run
- [ ] Generate RSA 4096-bit key pair for JWT signing
- [ ] Generate 32-byte random AES key for token encryption
- [ ] Set `ALLOWED_KITE_USER_ID` to your Kite user ID
- [ ] Enable HTTPS (self-signed cert acceptable for localhost)
- [ ] Verify `.env` is not tracked by git

### Ongoing
- [ ] Rotate RSA JWT key pair yearly
- [ ] Review audit log monthly
- [ ] Keep Python dependencies updated (`pip audit`)
- [ ] Monitor for failed login attempts in application logs
- [ ] Kite access tokens auto-expire daily — verify re-login flow works

---

## 11. Key Generation Commands

```bash
# Generate RSA 4096-bit key pair for JWT
openssl genrsa -out private.pem 4096
openssl rsa -in private.pem -pubout -out public.pem

# Generate AES-256 encryption key
python3 -c "import secrets, base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"

# Generate a strong DB password
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```
