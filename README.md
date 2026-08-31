# Helpful API

Express REST API (MySQL) for **Sit Together** and the Helpful mobile apps: accounts, JWT auth, partner pairing, AI Sit Sessions, 14-day programs, org-code / Stripe / IAP premium, FCM push, and admin tooling.

**Clients**

| Client | Repo / product | What it uses here |
|--------|----------------|-------------------|
| Sit Together web | [`helpful-web`](https://github.com/rherubin/helpful-web) · [sittogether.org](https://www.sittogether.org) | Auth, pairing, Sit Sessions, Stripe Payment Element + Customer Portal |
| Helpful mobile | iOS / Android | Auth, pairing, Sit Sessions, 14-day programs, IAP receipts, FCM device tokens |

There is no password-reset, email, or magic-link flow. LLM calls are **OpenAI only** (Helpful vs Hopeful are prompt tracks, not vendors).

**Stack:** Node **18** in production (Dockerfile / Nixpacks; `package.json` engines `>=16`), Express 4, MySQL 8, JWT + bcrypt, OpenAI Chat Completions (`BasePromptService`), Stripe, optional Firebase Admin (FCM). Railway-first: `PORT` is required; `MYSQL_URL` is supported.

Deeper docs (this README is the client contract):

- Sit Sessions — [Prompt sessions (“Sit Sessions”)](#prompt-sessions-sit-sessions) and [`docs/prompt-sessions-design.md`](./docs/prompt-sessions-design.md)
- Stripe — [`docs/stripe-billing.md`](./docs/stripe-billing.md)
- Tests — [`tests/README.md`](./tests/README.md)

## Contents

1. [What this API does](#what-this-api-does)
2. [Features (detail)](#features-detail)
3. [Setup](#setup)
4. [Quick reference](#quick-reference)
5. [Cross-cutting behavior](#cross-cutting-behavior)
6. [API endpoints](#api-endpoints)
7. [Database schema](#database-schema)
8. [Error handling](#error-handling)
9. [Example workflows](#example-workflows)
10. [Testing](#testing)
11. [Project structure](#project-structure)
12. [Deployment](#deployment-notes)
13. [Removed / obsolete](#removed--obsolete-do-not-use)

---

## What this API does

| Area | Capability | Typical client |
|------|------------|----------------|
| **Users & auth** | Email/password accounts; access + refresh JWTs (rotation, sliding refresh); `GET /api/profile`; self-gated update / soft-delete / restore; login auto-restores a soft-deleted account | Web + mobile |
| **Pairing** | 6-character partner codes; request / accept / reject; soft-delete / restore; `max_pairings` | Web + mobile |
| **Sit Sessions** | Solo or paired `prompt_sessions`: prep → generate Bridge + Session JSON; `generation` job state (`idle` / `running` / `succeeded` / `failed`) | **Web (primary)** + mobile |
| **14-day programs** | Async AI generation of day steps; user messages; couples therapy system replies; unlock tracking | **Mobile** (web does not call these) |
| **Helpful vs Hopeful** | Same OpenAI model; Hopeful (faith-based) when the user has an org code or custom org name/city/state | Any client |
| **Stripe (web)** | `POST /api/billing/subscription-intent` for in-app Payment Element; Customer Portal; webhooks; reconcile + orphaned-trial jobs | **Web** |
| **IAP (mobile)** | `POST /api/subscription` iOS/Android receipts — **503** unless `TEST_MOCK_IAP=true` (no App Store / Play verification yet) | **Mobile** |
| **Org codes** | Admin CRUD + audit; app users may list (secrets stripped); linking sets `users.is_premium` | Admin + mobile |
| **Push** | Device-token CRUD; FCM send is a no-op if Firebase is unconfigured | **Mobile** |
| **Admin** | Separate `admin_users` JWT (`type: "admin"`); org-code mutations; push-test | Internal |
| **Ops** | Auto schema on boot; in-process background jobs; rate limits; Railway `PORT` / `MYSQL_URL` | — |

**Premium** on profile, user GET/PUT, and **login** is pairing premium **or** `users.is_premium` (org code, Stripe `trialing`/`active`, or IAP-driven pairing premium). Prefer `GET /api/profile` as the canonical user payload.

---

## Features (detail)

### Core
- **Users** — create, profile update, soft-delete / restore; bcrypt passwords with validation
- **JWT auth** — access + refresh tokens, rotation, sliding refresh extension on authenticated calls
- **Combined profile** — `GET /api/profile` (user + premium + org summary + pairings)
- **Pairing** — request partner code → accept/reject; soft-delete / restore
- **AI programs** — async generation of day-based program steps; two tracks:
  - **Helpful** (default) — secular EFT/Gottman-style
  - **Hopeful** — faith-based when the user has a linked org code or custom `org_name` / `org_city` / `org_state`
- **Program steps + messages** — day steps, user messages, contributions tracking, unlock progress
- **Sit Sessions** (`/api/prompt-sessions`) — solo (single-device) or paired prep → **working** `POST .../generate` (strict Bridge/Session JSON with comparison, session title, focus, psychoeducation + title/references, reflections, conversation-starter, challenge) with a first-class `generation_status` job state (`idle`/`running`/`succeeded`/`failed`) so clients can distinguish "not started" from "generating"; pairing is optional and can happen after the first Sit Session; full docs under [Prompt sessions (“Sit Sessions”)](#prompt-sessions-sit-sessions)

### Premium & orgs
- **Pairing premium** — active iOS/Android subscription on either partner sets `pairings.premium`
- **Org premium** — valid `org_code` (or full custom org name/city/state) sets `users.is_premium`
- **Stripe web billing** — **Payment Element** via `POST /api/billing/subscription-intent` (primary); hosted Checkout (`POST /api/billing/checkout`) is legacy; Customer Portal + webhooks; persists `stripe_subscriptions` and sets `users.is_premium` when status is `trialing`/`active` (see [`docs/stripe-billing.md`](./docs/stripe-billing.md))
- **Computed `premium`** on login, profile, and GET/PUT user: pairing premium **or** `is_premium`

### Ops
- **Push** — device token CRUD; FCM soft no-op when Firebase is not configured
- **Admin** — separate `admin_users` JWT (`type: "admin"`) for org-code CRUD, audit, push-test
- **Rate limits** — global API, login, user update, device tokens, admin push-test
- **CORS** — `cors()` default (reflects any `Origin`; no allowlist). Stripe **return URLs** are a separate check (`STRIPE_CHECKOUT_ALLOWED_ORIGINS` / `WEB_APP_ORIGIN`)
- **Auto schema** — tables + incremental column migrations on startup
- **Railway-friendly** — `PORT` required, `MYSQL_URL` supported
- **Background jobs** — regeneration poller, device-token cleanup, Stripe subscription reconcile, orphaned-trial cleanup all run in-process on a timer; see [Background jobs](#background-jobs)

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment

**`PORT` is required.** If unset, the process exits on startup (Railway injects it; locally set e.g. `PORT=9000`).

Copy `.env.example` or create `.env`:

```bash
PORT=9000
HOST=0.0.0.0

# MySQL (individual vars)
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=helpful_db

# Or single URL (preferred on Railway; enables SSL rejectUnauthorized:false)
# MYSQL_URL=mysql://user:password@host:port/database

# JWT
JWT_SECRET=your-secret-key-change-in-production
JWT_REFRESH_SECRET=your-refresh-secret-key-change-in-production
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=14d
# Optional explicit seconds for response bodies (defaults derived from strings above for app users)
# JWT_ACCESS_TOKEN_EXPIRES_IN_SECONDS=86400
# JWT_REFRESH_TOKEN_EXPIRES_IN_SECONDS=1209600

# OpenAI (required for real program / step LLM work)
OPENAI_API_KEY=your-openai-api-key
# OPENAI_MODEL=gpt-5.4

# Optional rate limits
# USER_UPDATE_RATE_LIMIT=3          # PUT /api/users/:id per IP / 5 min
# DEVICE_TOKEN_RATE_LIMIT=10        # POST /api/device-tokens per IP / 5 min

# Program generation
# PROGRAM_GENERATION_FOLLOWUP_ENABLED=true
# PROGRAM_GENERATION_FOLLOWUP_DELAY_MS=60000
# DEFAULT_STEPS_REQUIRED_FOR_UNLOCK=0
# REGENERATION_POLL_INTERVAL_MS=30000

# Push (optional — API stays healthy without these)
# FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
# FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
# TEST_MOCK_PUSH=true
# PUSH_TOKEN_CLEANUP_INTERVAL_HOURS=24   # 0 disables periodic cleanup

# Testing / CI
# TEST_MOCK_LLM=true
# NODE_ENV=test
# SKIP_RATE_LIMITS=true

# Stripe (web billing — see docs/stripe-billing.md). Omit or TEST_MOCK_STRIPE=true for local/CI.
# STRIPE_SECRET_KEY=sk_test_...
# STRIPE_WEBHOOK_SECRET=whsec_...
# STRIPE_PRICE_MONTHLY=price_...
# STRIPE_PRICE_YEARLY=price_...
# STRIPE_TRIAL_PERIOD_DAYS=7
# STRIPE_CHECKOUT_ALLOWED_ORIGINS=http://localhost:8080,https://www.sittogether.org
# WEB_APP_ORIGIN=http://localhost:8080
# TEST_MOCK_STRIPE=true

# IAP receipts (POST /api/subscription) — 503 unless this is set (no store verification yet)
# TEST_MOCK_IAP=true
```

| Variable | Required | Default | Notes |
|----------|----------|---------|--------|
| `PORT` | **Yes** | — | Process exits if missing |
| `HOST` | No | `0.0.0.0` | Listen address |
| `MYSQL_*` / `MYSQL_URL` | Yes (DB) | localhost/root/helpful_db | URL overrides individuals |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Prod yes | insecure strings | Change in production |
| `JWT_EXPIRES_IN` | No | `24h` | App access token (AuthService) |
| `JWT_REFRESH_EXPIRES_IN` | No | `14d` | App refresh token string |
| `JWT_ACCESS_TOKEN_EXPIRES_IN_SECONDS` | No | 86400 | Admin access expiry uses this; app uses for response `expires_in` |
| `JWT_REFRESH_TOKEN_EXPIRES_IN_SECONDS` | No | 1209600 | Admin refresh; app response `refresh_expires_in` |
| `OPENAI_API_KEY` | For LLM | — | Soft-fail if missing (no generation) |
| `OPENAI_MODEL` | No | `gpt-5.4` | Chat model |
| `TEST_MOCK_LLM` | No | — | Deterministic mock responses |
| `TEST_MOCK_LLM_DELAY_MS` | No | `0` | Holds each mocked LLM call open this long, so tests can observe a generation mid-flight (concurrency assertions). Test-only |
| `PROMPT_SESSION_GENERATION_LEASE_MS` | No | `600000` | How long a Sit Session `generation_status = 'running'` row is trusted before `POST .../generate` may reclaim it |
| `TEST_MOCK_PUSH` | No | — | Mock FCM success |
| `TEST_MOCK_IAP` | No | — | Trust client IAP receipt fields (`POST /api/subscription`). Required for subscription tests; otherwise **503** |
| `ALLOW_ADMIN_REGISTRATION` | No | — | Opt-in open `POST /api/admin/auth/register`. Also allowed when `TEST_MOCK_LLM`/`TEST_MOCK_STRIPE` is true, or no admins exist yet |
| `ADMIN_REGISTRATION_SECRET` | No | — | Alternate admin-register unlock (header `x-admin-registration-secret` or body `registration_secret`) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` / `_PATH` | No | — | Real FCM |
| `USER_UPDATE_RATE_LIMIT` | No | `3` | ≤0 disables |
| `DEVICE_TOKEN_RATE_LIMIT` | No | `10` | ≤0 disables |
| `PROGRAM_GENERATION_FOLLOWUP_*` | No | on / 60s | Second LLM attempt after failure |
| `DEFAULT_STEPS_REQUIRED_FOR_UNLOCK` | No | `0` | Create/next program body default |
| `REGENERATION_POLL_INTERVAL_MS` | No | `30000` | Poller for `regenerate_therapy_response` |
| `PUSH_TOKEN_CLEANUP_INTERVAL_HOURS` | No | `24` | Stale device tokens (>180 days) |
| `STRIPE_RECONCILE_INTERVAL_HOURS` | No | `6` | Re-check local `stripe_subscriptions` against Stripe (safety net for missed webhooks); `0` disables |
| `STRIPE_RECONCILE_BATCH_LIMIT` | No | `50` | Rows checked per reconcile run |
| `ORPHANED_CLEANUP_INTERVAL_HOURS` | No | `24` | Cancel abandoned free-trial subscriptions + soft-delete their placeholder accounts; `0` disables |
| `ORPHANED_CLEANUP_AGE_HOURS` | No | `48` | Minimum age of a stalled trial before it's a cleanup candidate |
| `ORPHANED_CLEANUP_BATCH_LIMIT` | No | `50` | Rows checked per cleanup run |
| `ORPHANED_CLEANUP_DRY_RUN` | No | `true` | Logs candidates only; set `false` to actually cancel/delete |
| `STRIPE_SECRET_KEY` | For live Stripe | — | Test `sk_test_` / `rk_test_` on develop; live keys on production. Missing key or `TEST_MOCK_STRIPE=true` → in-process mock |
| `STRIPE_WEBHOOK_SECRET` | For webhooks | — | Signing secret for `/api/billing/webhook` |
| `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY` | For Stripe | — | Price IDs; catalog in [`docs/stripe-billing.md`](./docs/stripe-billing.md) |
| `STRIPE_TRIAL_PERIOD_DAYS` | No | `7` | Trial length on new subscriptions |
| `STRIPE_CHECKOUT_ALLOWED_ORIGINS` | For Checkout/Portal URLs | — | Comma-separated origins; fallback `WEB_APP_ORIGIN` (default `http://localhost:3000`) |
| `WEB_APP_ORIGIN` | No | `http://localhost:3000` | Fallback origin for Stripe return URLs (web local default is **8080**) |
| `TEST_MOCK_STRIPE` | No | — | In-process Stripe mock (local/CI; never on Railway) |
| `RAILWAY_ENVIRONMENT` / `RAILWAY_ENVIRONMENT_NAME` | No | — | If production, logs an error when Stripe keys are test-mode |

**LLM provider:** OpenAI only (`BasePromptService`). There is no Anthropic/Gemini client in this codebase. Helpful vs Hopeful are **prompt product tracks**, not different vendors.

### 3. Database

**Local MySQL**

```sql
CREATE DATABASE helpful_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

**Docker MySQL**

```bash
docker run --name helpful-mysql \
  -e MYSQL_ROOT_PASSWORD=password \
  -e MYSQL_DATABASE=helpful_db \
  -p 3306:3306 \
  -d mysql:8.0
```

Tables and incremental migrations run automatically on server start. No separate migration runner.

Optional local seed for org codes:

```bash
node scripts/seed-local-org-codes.js
```

### 4. Run

```bash
npm start          # node server.js
npm run dev        # nodemon
```

- Health: `GET http://localhost:9000/health` → plain text `OK`
- Diagnostics: `GET /health/diagnostics` → `{ "ok": true, "test_mock_llm": false }`
- Root: `GET /` → plain text `Helpful API is running`

---

## Quick reference

| Area | Endpoints |
|------|-----------|
| Health | `GET /health`, `GET /health/diagnostics`, `GET /` |
| Auth | `POST /api/login`, `/api/refresh`, `/api/logout`, `/api/token-info`, `GET /api/profile` |
| Users | `POST/GET/PUT/DELETE /api/users…`, restore, deleted list |
| Pairing | `/api/pairing/*` and alias `GET /api/pairings` |
| Programs | `POST/GET/DELETE /api/programs…`, next, therapy_response, metrics |
| Steps | `/api/programs/:id/programSteps`, `/api/programSteps/...` |
| Subscriptions | `POST/GET /api/subscription`, `GET .../receipts` |
| Stripe billing | `POST /api/billing/subscription-intent` (Payment Element, **primary**), `POST /api/billing/checkout` (legacy hosted), `POST /api/billing/portal`, `GET /api/billing/status`, `POST /api/billing/webhook` |
| Org codes | `/api/org-codes` (admin for mutations) |
| Admin | `/api/admin/auth/*`, `POST /api/admin/push-test` |
| Push devices | `/api/device-tokens` |
| Sit sessions | `/api/prompt-sessions` — [full docs](#prompt-sessions-sit-sessions) |
| Stats | `GET /api/messages-stats?date=&programId=` |

Auth header: `Authorization: Bearer {access_token}` unless noted.

---

## Cross-cutting behavior

### Authentication

| Token | Lifetime | Notes |
|-------|----------|--------|
| App access | `JWT_EXPIRES_IN` (default **24h**) | Payload: `id`, `email`, `first_name`, `last_name` (legacy name fields; profiles use `user_name` / `partner_name`) |
| App refresh | **14d** window stored in DB | Rotation on `/api/refresh`; **sliding extension** on every authenticated request |
| Admin access | `JWT_ACCESS_TOKEN_EXPIRES_IN_SECONDS` (default 86400) | Payload includes `type: "admin"` |
| Admin refresh | `JWT_REFRESH_TOKEN_EXPIRES_IN_SECONDS` | Same refresh secret; rows use `user_type = 'admin'` |

- Missing/invalid/expired access → **401** + `WWW-Authenticate`
- Account lockout (login only, in-memory): **5** failed attempts in **15 min** → **423** for **5 min** (per process; not shared across replicas)
- Soft-deleted accounts: login with the same email/password **restores** the user and returns `data.restored: true` (pairings stay cascade-deleted until explicitly restored)
- `bypass_password` on a user row skips password check at login (not settable via public user API)

### Rate limits (`middleware/security.js`)

| Limiter | Limit | Applied to |
|---------|-------|------------|
| `apiLimiter` | 1000 / 15 min / IP | All routes after mount (not health/root) |
| `loginLimiter` | 100 failed / 15 min / IP | `POST /api/login`, admin login (`skipSuccessfulRequests`) |
| `userUpdateLimiter` | 3 / 5 min / IP | `PUT /api/users/:id` |
| `deviceTokenLimiter` | 10 / 5 min / IP | `POST /api/device-tokens` |
| `adminActionLimiter` | 100 / 15 min / IP | `POST /api/admin/push-test` (counts all) |

Skipped when `NODE_ENV=test`, `TEST_MOCK_LLM=true`, `TEST_MOCK_OPENAI=true`, `TEST_MODE=true`, or `SKIP_RATE_LIMITS=true` (where coded).

### Security headers

On all responses: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`. HSTS only when request is HTTPS / `x-forwarded-proto: https`. CORS is `cors()` with **no origin allowlist** (reflects the request `Origin`). Stripe Checkout/Portal **return URLs** are validated separately against `STRIPE_CHECKOUT_ALLOWED_ORIGINS` / `WEB_APP_ORIGIN` — that is not CORS.

### Helpful vs Hopeful

Per user (and step messaging for that program owner’s context):

1. Linked `org_code_id` → org prompts + org location → **Hopeful**
2. Else any of `org_name` / `org_city` / `org_state` → **Hopeful**
3. Else → **Helpful**

Both use the same OpenAI key/model.

### Program generation

1. `POST /api/programs` or `.../next_program` returns **201** with the program row immediately.
2. Background LLM generates content and creates **14** day steps (when configured).
3. On failure: optional follow-up after `PROGRAM_GENERATION_FOLLOWUP_DELAY_MS` (default 60s) unless follow-up disabled; `generation_error` stored on failure.
4. `POST /api/programs/:program_id/therapy_response` → **202** to manually kick generation if steps missing (**409** if steps already exist, **503** if LLM not configured).
5. Poller every `REGENERATION_POLL_INTERVAL_MS` processes rows with `regenerate_therapy_response = true`.
6. Successful generation may push `program_ready` to owner (+ partner if paired).

### Premium

| Source | Effect |
|--------|--------|
| Active iOS/Android IAP | Updates accepted pairings’ `premium`; partners see pairing-based premium |
| Stripe `trialing` / `active` | Sets `users.is_premium` (web Payment Element / webhooks / reconcile) |
| Valid `org_code` on profile update | Links org, `is_premium = true` |
| Detach / clear org | May clear org premium; **Stripe premium is preserved** if the user still has an active Stripe sub |
| Custom org name+city+state (no code) | Creates/links org path; premium when all three present after merge |

Login, profile, and GET/PUT user all compute `premium` as pairing premium **or** `is_premium` (org or Stripe). Prefer `GET /api/profile` as the canonical payload.

### Push

- Unconfigured Firebase → sends return `{ skipped: true }` (no-op); API stays up.
- Exception: `POST /api/admin/push-test` → **503** if not configured.
- Dead FCM tokens pruned on send; periodic cleanup of tokens idle >180 days.

### Background jobs

All four run **in-process** (`setInterval`/`setTimeout` in `server.js`, plus the poller's own loop in `routes/programs.js`) — there is no external cron/worker process or queue. Each is started once at boot inside `initializeApp()`, guarded by whether the service it depends on is configured. All logs are prefixed with the job's tag below.

| Job | Log tag | Runs when | Interval env var | Default | Other env vars |
|-----|---------|-----------|-------------------|---------|-----------------|
| Program regeneration poller | `[regen_poller]` | An LLM service is configured (`OPENAI_API_KEY`, or `TEST_MOCK_LLM`) | `REGENERATION_POLL_INTERVAL_MS` | `30000` (30s) | — (always on while configured; no `0`-disables switch) |
| Device token cleanup | `[push-cleanup]` | Always | `PUSH_TOKEN_CLEANUP_INTERVAL_HOURS` | `24` | Age threshold fixed at 180 days in code (not configurable) |
| Stripe subscription reconcile | `[stripe-reconcile]` | Stripe billing configured (`STRIPE_SECRET_KEY` or `TEST_MOCK_STRIPE`) | `STRIPE_RECONCILE_INTERVAL_HOURS` | `6` | `STRIPE_RECONCILE_BATCH_LIMIT` (default `50`) |
| Orphaned-trial cleanup | `[orphaned-trial-cleanup]` | Stripe billing configured | `ORPHANED_CLEANUP_INTERVAL_HOURS` | `24` | `ORPHANED_CLEANUP_AGE_HOURS` (default `48`), `ORPHANED_CLEANUP_BATCH_LIMIT` (default `50`), `ORPHANED_CLEANUP_DRY_RUN` (default `true`) |

Any job with an `_INTERVAL_HOURS` env var is disabled by setting it to `0` (logged at boot, e.g. `[stripe-reconcile] disabled via STRIPE_RECONCILE_INTERVAL_HOURS`). The regeneration poller has no such switch — it runs whenever an LLM backend is configured at all.

- **Program regeneration poller** (`routes/programs.js` — `startRegenerationPoller`) — polls for programs with `regenerate_therapy_response = true`, claims each with a compare-and-swap flag (so a crash mid-run or multiple instances can't double-process or loop forever), regenerates via the Helpful/Hopeful prompt service, and pushes `program_ready` on success. See [Program generation](#program-generation).
- **Device token cleanup** (`server.js` — `startDeviceTokenCleanupJob`) — deletes FCM device tokens whose `last_used_at` (falling back to `updated_at`) is older than 180 days. First run 4 minutes after boot, then on the configured interval.
- **Stripe subscription reconcile** (`services/StripeBillingService.js` — `reconcileSubscriptions`, scheduled by `startStripeSubscriptionReconcileJob`) — re-fetches local `trialing`/`active`/`past_due`/`unpaid`/`incomplete` subscriptions from Stripe and re-applies them, so a missed or delayed webhook (failed renewal, cancellation) still clears or restores `users.is_premium`. First run 5 minutes after boot. See [`docs/stripe-billing.md`](./docs/stripe-billing.md).
- **Orphaned-trial cleanup** (`services/StripeBillingService.js` — `cleanupOrphanedTrials`, scheduled by `startOrphanedTrialCleanupJob`) — `helpful-web` silently creates a placeholder account (`trial.*@sit-together.local`) and a real Stripe trial subscription the moment someone reaches the checkout screen, before any payment method is entered; most abandoned checkouts never come back to finish. This job finds trials still `trialing`/`incomplete`, owned by an un-claimed placeholder account, older than `ORPHANED_CLEANUP_AGE_HOURS`, double-checks each against **live** Stripe (status + no `default_payment_method`/`default_source`) immediately before acting so an in-progress checkout is never touched, then cancels the Stripe subscription (via the same `cancelActiveSubscriptionsForUser` used on manual account delete — the Stripe **customer** object is left alone) and soft-deletes the placeholder user (`softDeleteUser`, cascades pairings, revokes refresh tokens). Ships with `ORPHANED_CLEANUP_DRY_RUN=true` — logs candidates without acting until explicitly set to `false`. First run 10 minutes after boot.

### Push kinds (`data.kind`)

| kind | When |
|------|------|
| `pairing_accepted` | Partner accepted pairing |
| `program_ready` | Program generation finished |
| `step_message` | Partner posted on a step |
| `therapy_response` | Couples therapy system messages added |
| `prompt_session_*` | Sit Sessions — see [Prompt sessions](#prompt-sessions-sit-sessions) |

---

## API endpoints

User-facing names use **`user_name`** and **`partner_name`** (not first/last).

### Health

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/health` | none | text `OK` |
| GET | `/health/diagnostics` | none | `{ ok, test_mock_llm }` |
| GET | `/` | none | text `Helpful API is running` |

### Authentication

#### POST `/api/login`

Body: `{ "email", "password" }`  
**200:**

```json
{
  "message": "Login successful",
  "data": {
    "user": { "id": "...", "email": "...", "user_name": "...", "premium": false },
    "access_token": "...",
    "refresh_token": "...",
    "expires_in": 86400,
    "refresh_expires_in": 1209600,
    "restored": false
  }
}
```

`user.premium` is pairing **or** `users.is_premium` (org / Stripe).  
`restored` is `true` when login auto-restored a soft-deleted account (`message` becomes `"Login successful; soft-deleted account restored"`).  
`expires_in` / `refresh_expires_in` are **seconds** (from env or defaults).  
**400** missing fields · **401** bad credentials · **423** locked · **500** server.

#### POST `/api/refresh`

Body: `{ "refresh_token" }` → new access + refresh (old refresh invalidated).

#### POST `/api/logout`

Body: `{ "refresh_token" }` → invalidate refresh.

#### POST `/api/token-info`

Body: `{ "access_token" }` — **decodes without verifying signature** (local debug only). Returns expiry metadata, `user_id`, `user_email`, `is_expired`.

#### GET `/api/profile` (recommended)

Returns profile without `password_hash`, with:

- `premium` (pairing **or** `is_premium` — org code / Stripe)
- `pairings[]` (accepted + pending; pending have `partner: null`)
- `pairing_codes[]`
- `org_id`, `org_name`, `org_city`, `org_state` (from linked org code or custom fields)

### Users

#### POST `/api/users`

Body: `{ "email", "password" }` only.  
**201:** user + tokens + auto-created pending pairing (`pairings`, optional `pairing_code`).  
Also sets `Authorization: Bearer …` response header.  
**409** email exists · **400** password/email validation.

#### GET `/api/users/:id`

Auth required; **must be self** (`req.user.id` must match `:id`). Returns flat user + computed `premium` + org summary fields. Outsiders get **403**.

#### PUT `/api/users/:id`

Auth; **must be self**. Rate-limited. Optional body: `email`, `user_name`, `partner_name`, `children`, `org_code`, `org_name`, `org_city`, `org_state`.

**Org premium paths:**
- `org_code` string → lookup; not expired → link + premium; **400** invalid/expired code
- Without `org_code`, all three of `org_name`, `org_city`, `org_state` → self-register org premium path
- Clearing org fields does **not** drop Stripe-based `is_premium` while a `trialing`/`active` subscription exists

#### DELETE `/api/users/:id` · PATCH `/api/users/:id/restore` · GET `/api/users/deleted/all`

Soft-delete / restore / list deleted. Delete and restore are **self-gated** (`req.user.id` must match `:id`). `GET .../deleted/all` requires an **admin** JWT (`type=admin`); regular user tokens get **403**.

**Cascade:** soft-deleting a user best-effort **cancels Stripe subscriptions** (response includes `canceled_stripe_subscriptions`), then soft-deletes that user’s pairings and revokes refresh tokens. Restoring the user does **not** automatically restore those pairings or recreate Stripe subs — restore pairings separately via `PATCH /api/pairing/:id/restore` if needed.

**Recovery:** after soft-delete, `POST /api/login` with the same email/password restores the account (so the UNIQUE email is not permanently locked once access tokens expire) and sets `data.restored: true`. Pairings remain cascade-deleted until explicitly restored.

### Pairing

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/pairing/request` | **201** partner code; returns existing pending code if one already open |
| POST | `/api/pairing/accept` | Body `{ "partner_code" }` → **200 empty body**; push to requester |
| POST | `/api/pairing/reject/:pairingId` | Reject **pending** only (participant); **400** if already processed/accepted; **403** outsider |
| GET | `/api/pairing/` | All pairings for user (excludes soft-deleted) |
| GET | `/api/pairings` | **Same as** `GET /api/pairing/` (alias in `server.js`) |
| GET | `/api/pairing/pending` | Pending only |
| GET | `/api/pairing/accepted` | Accepted only |
| GET | `/api/pairing/stats` | `max_pairings`, `current_pairings`, `available_slots`, `pending_requests` |
| GET | `/api/pairing/:pairingId` | Detail (**participant only**; soft-deleted → not found; **403** outsider) |
| DELETE | `/api/pairing/:pairingId` | Soft-delete (**participant only**); **403** outsider |
| PATCH | `/api/pairing/:pairingId/restore` | Restore soft-deleted pairing (**member only**). **400** if restoring would push a member over `max_pairings`, or a member account is deleted |
| GET | `/api/pairing/deleted/all` | Soft-deleted list (**admin** JWT only; regular users **403**) |

**Partner codes:** 6 chars, `A–Z` + `0–9`, unique among active pending codes. Accepting a pairing soft-deletes both members’ leftover open partner-code invites and enforces `max_pairings` for the requester as well as the acceptor.

Request response shape:

```json
{
  "message": "Partner code generated successfully. Share this code with someone to pair with you.",
  "partner_code": "ABC123",
  "pairing_id": "...",
  "requester": { "id": "...", "user_name": "...", "email": "..." },
  "expires_note": "This partner code is valid until someone uses it or you cancel the request."
}
```

### Programs

| Method | Path | Status | Notes |
|--------|------|--------|--------|
| POST | `/api/programs` | **201** | Body: `user_input` required; `pairing_id`, `steps_required_for_unlock` optional. **Requires `user_name` on profile** or **400**. Async generation. |
| POST | `/api/programs/:id/next_program` | **201** | Body: `user_input` required; inherits `pairing_id` from previous. **No** hard gate on `next_program_unlocked`. |
| POST | `/api/programs/:program_id/therapy_response` | **202** | Manual generation kick |
| GET | `/api/programs/metrics` | **200** | Hopeful + Helpful queue/latency metrics |
| GET | `/api/programs` | **200** | User’s programs + steps |
| GET | `/api/programs/:id` | **200** | One program + steps (owner or accepted partner) |
| DELETE | `/api/programs/:id` | **200** | Soft-delete; **owner only** |

Create body example:

```json
{
  "user_input": "We want to reconnect and communicate better.",
  "pairing_id": "optional_accepted_pairing_id",
  "steps_required_for_unlock": 5
}
```

`steps_required_for_unlock` defaults to `DEFAULT_STEPS_REQUIRED_FOR_UNLOCK` (**0**). When threshold &gt; 0 and enough steps have messages, `next_program_unlocked` becomes `true` (client UX; not enforced on next_program).

List/get include `user_input`, `pairing_id`, steps; raw `therapy_response` is not exposed in those list payloads as client content.

### Program unlock

1. Count steps with at least one message (paired: both partners’ contributions matter for unlock tracking).
2. When count ≥ `steps_required_for_unlock` and threshold &gt; 0 → `next_program_unlocked = true`.
3. Re-checked shortly after each new message (`setTimeout` ~500ms).

### Program steps & messages

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/programs/:programId/programSteps` | All steps; includes `contributions`, `started`, `total_steps` |
| GET | `/api/programSteps/:id` | One step + contributions |
| GET | `/api/programSteps/:id/messages` | Messages for step |
| POST | `/api/programSteps/:id/messages` | Body `{ "content" }` → **201** `{ message, data, system_messages }` |
| PUT | `/api/programSteps/:stepId/messages/:messageId` | Own messages only; body `{ "content" }` → `{ message, data }` |

**There are no `/api/conversations` or `/api/programs/.../conversations` routes.** Use programSteps paths only.

#### Background therapy & chime-in

- **Both partners posted** on a paired step → async couples therapy **system** messages (`message_type: "system"`) + push `therapy_response`.
- Message content containing **`hopeful`** or **`helpful`** (case-insensitive) may trigger chime-in system messages.
- **First** user message on **day 1** of a program **without** `previous_program_id` → sync welcome system message (may appear in `system_messages` on the 201 response).
- Other system replies are async — poll `GET .../messages`.

Message types: `user_message`, `system`, legacy `openai_response`.

### Subscriptions

#### POST `/api/subscription`

Auth. Platform-specific body. Receipt fields are trusted only when `TEST_MOCK_IAP=true` (no App Store / Play verification is implemented yet); otherwise the endpoint returns **503**.

**iOS:** `platform: "ios"`, `product_id`, `transaction_id`, `original_transaction_id`, `jws_receipt`, `environment` (`Production`|`Sandbox`), `purchase_date`, `expiration_date` (epoch **ms**).

**Android:** `platform: "android"`, `product_id`, `purchase_token`, `order_id`, `package_name`, `purchase_date`, `expiration_date` (epoch **ms**).

**200** update / **201** create:

```json
{
  "message": "Subscription receipt created successfully",
  "subscription": {
    "id": "...",
    "platform": "ios",
    "product_id": "...",
    "is_active": true,
    "expiration_date": 1768926462000
  },
  "premium_status": { "active": true, "pairings_updated": 1 }
}
```

Conflict if receipt belongs to another user (**409** via `SubscriptionError`).

#### GET `/api/subscription`

```json
{
  "premium": true,
  "active_subscriptions": 1,
  "latest_expiration": 1768926462000,
  "subscriptions": [{ "id", "platform", "product_id", "expiration_date", "purchase_date" }]
}
```

#### GET `/api/subscription/receipts`

`{ "message", "data": { "ios_receipts", "android_receipts", "total_receipts" } }`

### Stripe billing (web)

Canonical setup (price IDs, webhooks, Railway env matrix): [`docs/stripe-billing.md`](./docs/stripe-billing.md). Sit Together web uses **Payment Element in-app**; hosted Checkout is legacy.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/billing/subscription-intent` | Bearer | Body `{ "plan": "monthly" \| "yearly" }` → `{ client_secret, mode: "setup" \| "payment", subscription_id, plan }`. **Primary** purchase path. **409** if already `trialing`/`active` |
| POST | `/api/billing/checkout` | Bearer | Hosted Checkout session URL. **Legacy / optional** — web does not call this |
| POST | `/api/billing/portal` | Bearer | Body `{ "return_url"? }` → `{ url }` for Stripe Customer Portal |
| GET | `/api/billing/status` | Bearer | Premium + latest `stripe_subscriptions` row |
| POST | `/api/billing/webhook` | Stripe signature | Raw body (mounted **before** `express.json()`). Updates `stripe_subscriptions` and `users.is_premium` |

Return URLs for hosted Checkout/Portal must match an origin in `STRIPE_CHECKOUT_ALLOWED_ORIGINS` (or `WEB_APP_ORIGIN`). Webhook events: `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`.

`TEST_MOCK_STRIPE=true` (or missing `STRIPE_SECRET_KEY`) uses an in-process mock — local/CI only, never on Railway.

### Organization codes

Admin JWT (`type: "admin"`) required for create / get-by-id / update / delete / audit.  
**GET list** allows any authenticated app or admin JWT; non-admins get LLM prompt fields **and the redeemable `org_code` secret** stripped (`initial_program_prompt`, `next_program_prompt`, `therapy_response_prompt`, `org_code`).

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/org-codes` | admin |
| GET | `/api/org-codes` | app or admin |
| GET | `/api/org-codes/audit/org-linkages` | admin · query: `user_id`, `limit`, `offset` |
| GET | `/api/org-codes/:id` | admin |
| PUT | `/api/org-codes/:id` | admin |
| DELETE | `/api/org-codes/:id` | admin |

Create required: `org_code`, `organization`. Optional: address fields, prompt overrides, `expires_at`, `duration_start`, `duration_end`.

### Admin authentication

Separate from app users (`admin_users` table). Same JWT secrets; access payload includes `type: "admin"`.

| Method | Path | Auth | Notes |
|--------|------|------|--------|
| POST | `/api/admin/auth/login` | none | Body email/password; login limiter + lockout |
| POST | `/api/admin/auth/register` | gated | Creates admin — allowed only when `ALLOW_ADMIN_REGISTRATION=true`, or `ADMIN_REGISTRATION_SECRET` matches, or no admins exist yet (bootstrap) |
| GET | `/api/admin/auth/profile` | admin | |
| PUT | `/api/admin/auth/profile` | admin | email, names, children |
| POST | `/api/admin/auth/refresh` | none | Body `refresh_token` |
| POST | `/api/admin/auth/logout` | admin access | Invalidates admin refresh tokens |

### Admin tooling

#### POST `/api/admin/push-test`

Admin JWT. Body: `user_id` required; at least one of `title` / `body`; optional `data`.  
**200** send result · **503** push not configured · rate-limited 100/15min.

### Device tokens

Max **25** tokens per user. Raw FCM token never returned after register (only record `id` + `platform`).

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/device-tokens` | Body `device_token` (10–512 chars), `platform`: `ios`\|`android`\|`web`. **201** new / **200** upsert |
| GET | `/api/device-tokens` | List without token strings; includes `last_used_at` when present |
| DELETE | `/api/device-tokens/:id` | Own tokens only |

### Prompt sessions (“Sit Sessions”)

**Canonical docs for Sit Sessions.** Internal name `prompt_sessions` / product name **Sit Session**. Auth on all routes: `Authorization: Bearer {access_token}`. Design notes (open questions, schema intent): [`docs/prompt-sessions-design.md`](./docs/prompt-sessions-design.md). Tests: `npm run test:prompt-sessions`.

#### Modes and policies

| Mode | Create body | Access | Prep ready (`both_preps_complete`) | Generate |
|------|-------------|--------|------------------------------------|----------|
| **Solo / single-device** | omit `pairing_id` (or `{}`) | Creator only | **1** completed prep | **Yes** — pairing not required |
| **Paired** | `{ "pairing_id" }` | Creator or pairing member | **2** completed preps | **Yes** — after both preps |

**Product note for web / app:** Sit Sessions are always written as a **couple experience** (two reflections, partner comparison, shared challenge), even in single-device mode. Pairing can happen **after** the first Sit Session. On one phone/shared web session, create a solo session (`pairing_id: null`), complete prep, then generate — the LLM still returns couple-shaped Bridge + Session content. When only one prep exists, Partner 2 may be labeled `"Partner"` (or similar) and inferred carefully from Partner 1’s answers.

- Pairing status need **not** be `accepted`. If `pairing_id` is sent, the caller must be a **member** (pending is fine). Soft-deleted pairings do not grant partner access.
- **One** active (non-terminal) session **per pairing**; **one** active solo session **per user**. Active = status not `complete` / `abandoned`.
- Statuses (product lifecycle): `prep` \| `bridge` \| `in_session` \| `complete` \| `abandoned`. This is **separate** from the generation job state below.
- `generation_prompt` is stored server-side for audit/replay and is **never** exposed to clients.
- Prefer setting `user_name` on the profile before generate — display names in reflections/comparison come from `user_name` (else email local-part).

#### Call sequence (create → prep → generate)

1. **Create** — `POST /api/prompt-sessions` (solo or with `pairing_id`).
2. **Prep** — `POST /api/prompt-sessions/:id/prep` with the six required fields (merge/upsert; may be called more than once). Solo is ready after one complete prep; paired needs both partners.
3. **Generate** — `POST /api/prompt-sessions/:id/generate` once prep is ready (or wait for auto-generate, then `GET`). Works for solo/single-device (1 prep) and paired (2 preps). Live OpenAI often takes **~20–40s**; treat **409 `GENERATION_RUNNING`** as “poll `GET`”, not a user-facing error.

#### Generation state (`generation_status`)

Every `prompt_session` carries an explicit **generation job state**, separate from the product `status` (`prep`/`bridge`/…). This is what lets clients distinguish "not started yet" from "generating right now" — something that used to be ambiguous from `bridge_content === null` alone.

| `generation_status` | Meaning |
|----------------------|---------|
| `idle` | Not started (fresh session, or prep not ready yet) |
| `pending` | Reserved for future queued-job use; no current code path sets this — transitions go `idle` → `running` directly |
| `running` | LLM call in flight (explicit `POST .../generate` or the auto-generate background trigger) |
| `succeeded` | `bridge_content` + `session_content` persisted and valid |
| `failed` | `generation_error` is set; content is still `null` — safe to retry |

**Transitions:** `idle` → `running` → `succeeded` \| `failed`. A `failed` session can retry: `failed` → `running` → `succeeded` \| `failed`. A `succeeded` session never restarts (`POST .../generate` just returns the stored content).

`running` is never a dead end. Because it means "a server process is working on this", the backend recovers it two ways so an interrupted job can't leave a session permanently un-retryable:

- **On startup**, only **expired** `running` leases are swept to `failed` with an explanatory `generation.error` (same lease window as reclaim). Fresh leases are left alone so multi-instance / rolling deploys do not fail a peer's still-live generation. In-lease abandoned work becomes reclaimable once the lease expires.
- **While running**, the lock is a *lease*: a `running` row whose `started_at` is older than `PROMPT_SESSION_GENERATION_LEASE_MS` (default 10 minutes) can be reclaimed by the next `POST .../generate`. Success and failure writes are bound to an opaque `generation_claim_id` stamped on claim, so a late first worker cannot overwrite or fail the reclaimer.

Clients don't need to special-case either: keep polling while `running`, and if you hit your own timeout, `POST .../generate` again.

Every `prompt_session` response includes a computed, non-persisted `generation` object so clients never have to reinvent these rules from raw columns. This object is the **only** place job state is exposed — the raw `generation_status` / `generation_started_at` / `generation_finished_at` columns are deliberately not emitted at the top level, so there's no second source of truth to drift onto:

```json
"generation": {
  "status": "running",
  "error": null,
  "started_at": "2026-08-09T16:00:00.000Z",
  "finished_at": null,
  "ready": false
}
```

`generation.ready` is `true` **only** when `generation.status === "succeeded"` **and** both `bridge_content` / `session_content` are present — use it instead of manually checking both columns.

**Client state table:**

| Client state | How to know |
|--------------|-------------|
| Prep incomplete | `GET`/`POST .../prep` → `both_preps_complete === false` |
| Ready, not started | `both_preps_complete === true` && `generation.status === "idle"` && no content |
| Generating | `generation.status === "running"` |
| Success | `generation.status === "succeeded"` && `generation.ready === true` |
| Failed | `generation.status === "failed"` && `generation.error` is a non-null string |

**Polling guidance:** after prep returns `both_preps_complete: true` (or after a `POST .../generate` returns **409 `GENERATION_RUNNING`** because auto-generate is already running), poll `GET /api/prompt-sessions/:id` every **1–2s** for up to **~90–120s** (live GPT can take ~20–40s+), stopping once `generation.status` is `succeeded` or `failed`. Prefer having exactly **one** device/tab call `POST .../generate` synchronously and block on its response; other devices/tabs should just poll `GET`. A realtime push notification on generation success/failure (`prompt_session_generation_succeeded` / `_failed`) is a nice-to-have, not yet implemented.

> **Migrating an existing client:**
> 1. `POST .../generate` can return **409 `GENERATION_RUNNING`** when auto-generate is still in flight — treat that as “keep polling `GET`”, not as an error to surface.
> 2. **Generated content shape changed.** Do **not** bind UI to the old Bridge/Session fields (`summary`, `shared_themes`, `transition`, `phases` with `open`/`deepen`/`close`). Use the current contract below (`comparison`, `title`, `focus`, `psychoeducation`, `reflections`, `conversation_starter`, `challenge`). `bridge_content.title` is the generated 4–6 word session title (not the retired top-level `session.title`). Old rows may still exist in some DBs until purged; new generates always write the new shape.

#### Generate endpoint — working state (app / web)

**Status: implemented and live.** `POST /api/prompt-sessions/:id/generate` is **not** a stub. It builds a prompt from completed prep(s) via `HelpfulPromptService.generateSitSessionContent`, calls the LLM, validates + normalizes a **strict JSON schema**, and persists Bridge + Session content. On success, session `status` becomes `bridge` and `generation_status` becomes `succeeded`.

| Behavior | Detail |
|----------|--------|
| **When it runs** | Explicitly via `POST .../generate`, **or** auto in the background when prep becomes ready (`both_preps_complete: true` on prep response). Both paths drive the **same** `generation_status` state machine, so polling `GET .../:id` sees identical transitions either way |
| **Sync vs async** | Explicit generate is **synchronous** — the HTTP response includes the generated payload (or an error). Auto-generate is fire-and-forget; poll `GET .../:id` until `generation.status` is terminal |
| **Idempotent** | If `generation.status === "succeeded"` (content already exists), `POST .../generate` returns **200** with the **stored** session (does not re-call the LLM) |
| **Concurrency-safe** | The `idle`/`failed` → `running` transition is a database compare-and-swap. If a call is already `running` (this call or the auto-generate trigger), a second `POST .../generate` gets **409 `GENERATION_RUNNING`** instead of also calling the LLM — the model spend never doubles |
| **Crash-safe** | `running` is held as a lease, and any `running` row is swept to `failed` on startup, so an interrupted generation is always retryable rather than stuck at 409 forever |
| **Retry after failure** | `POST .../generate` on a `failed` session retries (`failed` → `running` → `succeeded`\|`failed`) and clears `generation_error` on the new attempt |
| **Auth** | Same as other member routes: `Authorization: Bearer {access_token}`; caller must be creator or pairing member |
| **LLM config** | Needs `OPENAI_API_KEY` or `TEST_MOCK_LLM=true`. Otherwise **503** |
| **Never returned** | `generation_prompt` (server audit only) |

**Status codes for `POST .../generate`:**

| Status | `code` | Meaning |
|--------|--------|---------|
| **200** | — | Content generated **or** already present (see `message`; `generation.status` is `succeeded`) |
| **403** | — | Not a member / no access |
| **404** | `NOT_FOUND` | Session not found |
| **409** | `PREP_NOT_READY` | Prep not ready (solo: complete own prep; paired: both partners) |
| **409** | `GENERATION_RUNNING` | A generation is already in flight for this session (body also includes `prompt_session`) |
| **500** | `GENERATION_FAILED` | LLM/validation failure after retries (`generation_error` set, `generation.status` becomes `failed`) — retryable |
| **503** | `LLM_NOT_CONFIGURED` | LLM not configured |

The two 409s mean opposite things, so **branch on `code`, not on the status**: `GENERATION_RUNNING` means poll `GET` and the content is coming, while `PREP_NOT_READY` means collect more prep first and polling will never resolve.

##### Example: GET while running vs succeeded vs failed

```json
// GET .../:id while an LLM call is in flight
{ "prompt_session": { "status": "prep", "bridge_content": null, "session_content": null,
  "generation": { "status": "running", "error": null, "started_at": "2026-08-09T16:00:00.000Z", "finished_at": null, "ready": false } } }

// GET .../:id once generation succeeds
{ "prompt_session": { "status": "bridge", "bridge_content": { "comparison": { "partner_1": "…", "partner_2": "…", "insight": "…" }, "title": "…", "focus": "…", "psychoeducation": { "title": "…", "body": "…", "references": [{ "citation": "…" }] } }, "session_content": { "reflections": [ /* two */ ], "conversation_starter": { "question": "…" }, "challenge": { "title": "…", "steps": [ /* … */ ] } },
  "generation": { "status": "succeeded", "error": null, "started_at": "2026-08-09T16:00:00.000Z", "finished_at": "2026-08-09T16:00:01.000Z", "ready": true } } }

// GET .../:id after a failed attempt (safe to retry via POST .../generate)
{ "prompt_session": { "status": "prep", "bridge_content": null, "session_content": null,
  "generation": { "status": "failed", "error": "Failed to generate Sit Session content", "started_at": "2026-08-09T16:00:00.000Z", "finished_at": "2026-08-09T16:00:02.000Z", "ready": false } } }
```

##### How to read generated data after `/generate`

Clients should treat the session object as the source of truth. Content lives on **`prompt_session.bridge_content`** and **`prompt_session.session_content`**.

| Access path | When to use |
|-------------|-------------|
| **`POST /api/prompt-sessions/:id/generate`** response | Immediate use after the user taps Generate (or to force/wait for content). Body includes full `prompt_session`. |
| **`GET /api/prompt-sessions/:id`** | Resume, refresh, second device, or after **auto-generate** (prep completed and you did not call generate). Same fields once ready. |
| **`GET /api/prompt-sessions`** | List sessions; each item can include `bridge_content` / `session_content` when already generated. |

**Ready check (client):** prefer the server-computed `generation.ready` flag over re-deriving it from content shape:

```js
const ready = session?.generation?.ready === true;
// Equivalent to (but prefer generation.ready): session?.generation?.status === 'succeeded'
//   && session?.bridge_content?.psychoeducation?.body
//   && Array.isArray(session?.session_content?.reflections)
//   && session.session_content.reflections.length === 2;
```

If only auto-generate ran: after prep returns `both_preps_complete: true`, poll `GET /api/prompt-sessions/:id` until `ready` (or call `POST .../generate` — **200** if already done, **409 `GENERATION_RUNNING`** if still running, in which case fall back to polling).

**Suggested UI field binding:**

| UI | Path |
|----|------|
| Partner 1 comparison sentence | `prompt_session.bridge_content.comparison.partner_1` |
| Partner 2 comparison sentence | `prompt_session.bridge_content.comparison.partner_2` |
| Comparison insight | `prompt_session.bridge_content.comparison.insight` |
| Session title (4–6 words) | `prompt_session.bridge_content.title` |
| Session focus paragraph | `prompt_session.bridge_content.focus` |
| Psychoeducation title | `prompt_session.bridge_content.psychoeducation.title` |
| Psychoeducation body | `prompt_session.bridge_content.psychoeducation.body` |
| Study / science references | `prompt_session.bridge_content.psychoeducation.references[]` (`citation`, optional `note`) |
| Reflection questions | `prompt_session.session_content.reflections[]` (`partner`, `question`) — **always exactly 2**, even for solo/single-device |
| Conversation starter | `prompt_session.session_content.conversation_starter.question` (text starts immediately; may be prefixed with “Conversation starter:” by the model) |
| Challenge title | `prompt_session.session_content.challenge.title` |
| Challenge steps | `prompt_session.session_content.challenge.steps[]` (`number`, `title`, `body`, optional `bullets`) — render in `number` order |
| Session lifecycle | `prompt_session.status` (`prep` → `bridge` after generate; client may `PATCH` to `in_session` / `complete` / `abandoned`) |
| Generation spinner / state | `prompt_session.generation.status` (`idle`/`running`/`succeeded`/`failed`) — show a spinner while `running` |
| Failure hint | `prompt_session.generation.error` (string or null; mirrors `generation_error`); do not show `generation_prompt` |

##### Example: successful `POST .../generate` response (solo / single-device)

```http
POST /api/prompt-sessions/{id}/generate
Authorization: Bearer {access_token}
```

```json
{
  "message": "Prompt session content generated successfully",
  "prompt_session": {
    "id": "ps_abc123",
    "pairing_id": null,
    "created_by_user_id": "user_…",
    "status": "bridge",
    "current_phase": null,
    "bridge_content": {
      "comparison": {
        "partner_1": "Alex is entering this session hopeful and a bit tender…",
        "partner_2": "Partner may also be arriving with some sensitivity around the hard week…",
        "insight": "Both of you seem to need this conversation to feel soft and team-oriented…"
      },
      "title": "Feeling like a team again",
      "focus": "Tonight is about slowing down enough to feel like a team again, even if the week was hard.",
      "psychoeducation": {
        "title": "Turning Toward After a Hard Week",
        "body": "After a hard week, many couples try to reconnect…",
        "references": [
          {
            "citation": "Gottman, J. M., & Levenson, R. W. (1992). Marital processes predictive of later dissolution…",
            "note": "Classic work showing how interaction patterns and failed repair predict relationship distress."
          }
        ]
      }
    },
    "session_content": {
      "reflections": [
        { "partner": "Alex", "question": "As you sit here feeling hopeful and tender…" },
        { "partner": "Partner", "question": "As you join Alex in this gentle and honest conversation…" }
      ],
      "conversation_starter": {
        "question": "Conversation starter: Looking at both of your reflections, what is one small thing…"
      },
      "challenge": {
        "title": "The Same-Team Reset",
        "steps": [
          {
            "number": 1,
            "title": "Set the tone before the topic",
            "body": "Sit facing each other and take one slow breath…",
            "bullets": ["Examples: calm, honesty, warmth", "No problem-solving yet"]
          }
        ]
      }
    },
    "llm_used": "gpt-5.4",
    "seconds_to_generate": 26.322,
    "generation_error": null,
    "generation_prompt_used_at": "2026-08-10T14:06:07.000Z",
    "generation": {
      "status": "succeeded",
      "error": null,
      "started_at": "2026-08-10T14:06:07.000Z",
      "finished_at": "2026-08-10T14:06:34.000Z",
      "ready": true
    },
    "created_at": "…",
    "updated_at": "…"
  }
}
```

Paired sessions use the same content shape; `pairing_id` is set and both partners’ display names typically appear in `comparison` / `reflections`.

If content was already stored, same **200** shape with `"message": "Prompt session content already generated"`.

`GET /api/prompt-sessions/:id` returns the same `prompt_session` object (including `bridge_content` / `session_content` when present).

#### Generated content schema (strict)

The generation prompt asks the model for `bridge_content` / `session_content` with `session_title`, `session_focus`, and `psychoeducation.headline`. The server **normalizes** those into the stored keys below (`title`, `focus`, `psychoeducation.title`), trims strings, renumbers challenge steps `1..n`, drops empty optional notes/bullets, and drops unknown keys. LLM output is rejected (and retried once) unless it matches the prompt contract (or the older `bridge` / `session` aliases). API responses always use this shape on `bridge_content` / `session_content`.

Works for **solo/single-device** (1 completed prep) and **paired** (2 completed preps). **Output is always couple-shaped** (exactly two reflections; `partner_1` + `partner_2` + `insight`) so web/app can use one renderer for both modes.

```json
{
  "bridge_content": {
    "comparison": {
      "partner_1": "string (≥ 15 chars)",
      "partner_2": "string (≥ 15 chars)",
      "insight": "string (≥ 15 chars)"
    },
    "title": "string (≥ 8 chars, 4–6 words)",
    "focus": "string (≥ 40 chars)",
    "psychoeducation": {
      "title": "string (≥ 5 chars)",
      "body": "string (≥ 40 chars)",
      "references": [
        { "citation": "string (≥ 8 chars)", "note": "string (optional)" }
      ]
    }
  },
  "session_content": {
    "reflections": [
      { "partner": "string", "question": "string (≥ 15 chars)" },
      { "partner": "string", "question": "string (≥ 15 chars)" }
    ],
    "conversation_starter": { "question": "string (≥ 15 chars)" },
    "challenge": {
      "title": "string (≥ 5 chars)",
      "steps": [
        {
          "number": 1,
          "title": "string",
          "body": "string (≥ 15 chars)",
          "bullets": ["string"]
        }
      ]
    }
  }
}
```

| Field | Rules |
|-------|--------|
| `bridge_content.comparison.partner_1` / `partner_2` / `insight` | required strings |
| `bridge_content.title` | required string (short warm session title) |
| `bridge_content.focus` | required string (short paragraph) |
| `bridge_content.psychoeducation.title` | required string |
| `bridge_content.psychoeducation.body` | required string |
| `bridge_content.psychoeducation.references` | required array, **≥ 1**; each has `citation`; `note` optional |
| `session_content.reflections` | exactly **2** objects with `partner` + `question` |
| `session_content.conversation_starter.question` | required string (starts with the starter text) |
| `session_content.challenge.title` | required string |
| `session_content.challenge.steps` | non-empty array; each has `number`, `title`, `body`; `bullets` optional |
| Extra keys | stripped on normalize; not returned |

Clients should bind UI to these fields only (not free-form prose blobs).

#### Endpoints

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/prompt-sessions` | Body optional `{ "pairing_id" }` · **201** · **409** if an active session already exists |
| GET | `/api/prompt-sessions` | Optional `?pairing_id=` · list; items include `bridge_content` / `session_content` when generated |
| GET | `/api/prompt-sessions/:id` | Creator or pairing member · **primary read path** for Bridge/Session after generate or auto-generate |
| POST | `/api/prompt-sessions/:id/prep` | Merge prep fields. Strings only (≤2000 chars). Prompt-injection / jailbreak content → **400** `PREP_UNSAFE_INPUT`. Response: `prep`, `both_preps_complete` |
| GET | `/api/prompt-sessions/:id/prep` | Own prep; partner answers only when both complete (paired). Solo: `partner_prep: null` |
| PATCH | `/api/prompt-sessions/:id` | Body `status` and/or `current_phase` |
| POST | `/api/prompt-sessions/:id/generate` | **Working** (solo or paired). **200** + full `prompt_session` with Bridge/Session · **409** `PREP_NOT_READY` or `GENERATION_RUNNING` (branch on `code`) · **503** LLM not configured · idempotent once `succeeded`; retries when `failed` |

#### Prep fields

Six required (all non-empty strings mark prep complete). API field names are storage keys; generation maps them into product copy:

| Field | Product line in generation prompt |
|-------|-----------------------------------|
| `gratitude` | 1. They're feeling {{value}} |
| `energy_level` | 2. Their emotional tank is feeling {{value}} right now (e.g. very full / somewhat full / empty) |
| `boundary` | 3. They're feeling {{value}} to their partner (e.g. very close / somewhat close / distant) |
| `intention` | 4. They want the tone of the session to be {{value}} |
| `curiosity` | 5. They want the topic to {{value}} |
| `bringing_text` | 6. In a free form text field, they've entered {{value}} |

Optional: `optional_focus` (appended to free-form line 6 when present).

Each field must be a string (or JSON `null` to clear). Control characters, code fences, role markers (`System:` / `Assistant:` at line start), and jailbreak/instruction-override phrases are rejected with **400** so they never enter `generation_prompt`. Generate-time sanitization in `HelpfulPromptService` remains as a second layer.

Display names in the prompt come from each user's `user_name` (else email local-part). Creator is Partner A; when paired, the other member is Partner B. In solo/single-device mode (one prep), Partner 2 is typically labeled `"Partner"` in generated content.

##### Client checklist (web / app)

1. Create solo (`{}`) or paired (`{ pairing_id }`) session.
2. POST prep until `both_preps_complete === true`.
3. Either wait for auto-generate or call `POST .../generate`.
4. On **409 `GENERATION_RUNNING`**, poll `GET .../:id` until `generation.ready === true` (or `failed`).
5. Render **only** the new `bridge_content` / `session_content` fields listed above — never the legacy `summary` / `shared_themes` / `phases` shape.
6. Advance product UI with `PATCH` (`status`: `in_session` → `complete`, optional `current_phase`).

#### Push (`data.kind`) for Sit Sessions

| kind | When |
|------|------|
| `prompt_session_created` | Partner started a paired Sit Session |
| `prompt_session_prep_complete` | One partner finished prep; the other is still pending |

#### Example curls

Solo create → prep → generate:

```bash
# 1. Create (solo)
curl -s -X POST http://localhost:9000/api/prompt-sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
# → 201 { "prompt_session": { "id": "…", "pairing_id": null, "status": "prep", … } }

# 2. Submit prep (all six required fields to mark complete)
curl -s -X POST http://localhost:9000/api/prompt-sessions/$SESSION_ID/prep \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "gratitude":"hopeful and a bit tender",
    "energy_level":"somewhat full",
    "boundary":"somewhat close",
    "intention":"gentle and honest",
    "curiosity":"stay on reconnecting after a hard week",
    "bringing_text":"I want us to leave tonight feeling more on the same team."
  }'
# → both_preps_complete: true after one complete prep (solo)
# → server may auto-start generation in the background

# 3. Generate (synchronous; safe to call even if auto-generate already finished)
curl -s -X POST http://localhost:9000/api/prompt-sessions/$SESSION_ID/generate \
  -H "Authorization: Bearer $TOKEN"
# → 200 {
#     "message": "Prompt session content generated successfully",
#     "prompt_session": {
#       "status": "bridge",
#       "bridge_content": { "comparison", "title", "focus", "psychoeducation" },
#       "session_content": { "reflections", "conversation_starter", "challenge" },
#       "generation": { "status": "succeeded", "error": null, "started_at": "…", "finished_at": "…", "ready": true },
#       …
#     }
#   }
# → 409 code=PREP_NOT_READY if prep not ready
# → 409 code=GENERATION_RUNNING if auto-generate already has this session "running" (poll GET instead)
# → 503 if LLM not configured

# 4. Re-fetch anytime (same content shape)
curl -s http://localhost:9000/api/prompt-sessions/$SESSION_ID \
  -H "Authorization: Bearer $TOKEN"
# → 200 { "prompt_session": { … bridge_content, session_content … } }
```

##### Debug demo: generate JSON (solo create → prep → generate)

Creates a user, creates a **solo** Sit Session, submits prep, exercises auto-generate + concurrent generate, and prints `generation` state at each step:

```bash
# Terminal 1 — mock LLM (stable schema, no OpenAI spend):
TEST_MOCK_LLM=true TEST_MOCK_PUSH=true npm start

# Terminal 2:
npm run test:prompt-session-generate-demo
```

Live model (real GPT text, same response shape):

```bash
# Terminal 1 — OPENAI_API_KEY set, TEST_MOCK_LLM unset:
npm start

# Terminal 2:
npm run test:prompt-session-generate-demo
```

Script: `tests/prompt-session-generate-demo.js`. Optional: `TEST_BASE_URL=http://127.0.0.1:9000`.

Paired create:

```bash
curl -s -X POST http://localhost:9000/api/prompt-sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pairing_id":"PAIRING_ID"}'
# Each partner then POSTs .../prep; generate is ready after both complete
# (or call POST .../generate explicitly).
```

#### Schema (summary)

Tables `prompt_sessions` and `prompt_session_preps` (see [Database schema](#database-schema)). `pairing_id` nullable for solo. Startup adds the `generation_status` / `generation_started_at` / `generation_finished_at` columns if missing, and migrates older NOT NULL columns.

Two startup behaviours are worth knowing about:

- **Backfill** derives `generation_status` for pre-existing rows from the content/error they already have. It runs on every boot (not only the boot that adds the columns) because it is a no-op once applied, and gating it on the schema change meant an interrupted first boot could leave legacy rows stuck reporting `idle` while holding content.
- **Adding the columns is fatal on failure.** Every generation write path references them, so booting without them would break Sit Session generation on a database that worked before the deploy. The backfill itself stays best-effort — a stale status degrades the UI but doesn't break generation.

`prompt_sessions` fields relevant to generation:

| Column | Type | Notes |
|--------|------|-------|
| `status` | `ENUM('prep','bridge','in_session','complete','abandoned')` | Product lifecycle; unaffected by generation failures |
| `generation_status` | `ENUM('idle','pending','running','succeeded','failed')` DEFAULT `'idle'` | Generation job state — see [Generation state](#generation-state-generation_status). Exposed to clients as `generation.status`, not as a top-level field |
| `generation_started_at` / `generation_finished_at` | `DATETIME NULL` | Stamped by `beginGeneration()` / `saveGeneratedContent()` / `updateGenerationError()`. `generation_started_at` also doubles as the lease clock for reclaiming an abandoned `running` row |
| `generation_claim_id` | `VARCHAR(50) NULL` | Opaque lease token set by `beginGeneration()`; success/failure CAS must match it. **Never** exposed to clients |
| `generation_error` | `TEXT NULL` | Set on failure; cleared on the next successful or retried attempt |
| `bridge_content` / `session_content` | `LONGTEXT NULL` (JSON) | Present once `generation_status = 'succeeded'` |
| `generation_prompt` | `LONGTEXT NULL` | Server audit only — **never** in API responses |

#### Purge all Sit Sessions (dev / env reset)

While the feature is in development, wipe **all** `prompt_sessions` (and cascaded `prompt_session_preps`) so legacy or invalid generated payloads do not linger. Dry-run by default; pass `--confirm` to delete.

```bash
# Dry-run — prints counts against the DB from MYSQL_* / MYSQL_URL
npm run purge:prompt-sessions

# Delete every prompt session + prep on that DB
npm run purge:prompt-sessions:confirm
```

Point at another environment with env vars (dry-run first):

```bash
MYSQL_URL='mysql://…' npm run purge:prompt-sessions
MYSQL_URL='mysql://…' npm run purge:prompt-sessions:confirm
```

Script: `scripts/purge-prompt-sessions.js`. This is a full wipe of Sit Session data for the target database — not a selective legacy-only migration.

### Message stats

#### GET `/api/messages-stats?date={epoch_seconds}&programId={id}`

Auth required; caller must have program access (`checkProgramAccess`) or **403**. `date` is Unix time in **seconds** (not ms).  
Returns map: `{ "<step_id>": { "messageCount": N }, ... }`.

---

## Password requirements

From `User.validatePassword` / admin validation:

- **Minimum 8**, **maximum 128** characters (not “exactly 8”)
- At least one lowercase, one uppercase, one digit, one symbol
- Rejects weak patterns (long repeats, common sequences/words, simple keyboard runs)

---

## Database schema

Created/migrated on startup. Core tables:

| Table | Purpose |
|-------|---------|
| `users` | Accounts, org fields, `is_premium`, `bypass_password`, `stripe_customer_id`, soft delete |
| `user_org_code_audit_logs` | Org link/unlink audit |
| `refresh_tokens` | App + admin refresh (`user_type` ENUM) |
| `pairings` | Partner codes, status, `premium`, soft delete |
| `programs` | Input, pairing, generation metadata, unlock flags, soft delete |
| `program_steps` | Day, theme, conversation_starter, science_behind_it, `started` |
| `program_step_user_contribution` | First contribution per user per step |
| `messages` | step messages + metadata |
| `ios_subscriptions` / `android_subscriptions` | Store receipts |
| `stripe_subscriptions` | Web Stripe subscriptions (plan, status, period ends) |
| `org_codes` | Codes, address, prompt overrides, duration, expires |
| `admin_users` | Admin accounts |
| `device_tokens` | FCM tokens, platform, `last_used_at` |
| `prompt_sessions` / `prompt_session_preps` | Sit Sessions (`pairing_id` nullable for solo) |

### Users (representative)

```sql
-- Key columns (see models/User.js for full CREATE + migrations)
id, email UNIQUE, password_hash,
user_name, partner_name, children, max_pairings,
org_code_id, org_name, org_city, org_state,
is_premium, bypass_password, stripe_customer_id,
deleted_at, created_at, updated_at
```

### Programs (representative)

```sql
id, user_id, user_input, pairing_id, previous_program_id,
therapy_response, generation_prompt, generation_error,
regenerate_therapy_response, llm_used, seconds_to_load,
steps_required_for_unlock,  -- API default when omitted: env DEFAULT_STEPS_REQUIRED_FOR_UNLOCK (0)
next_program_unlocked,
deleted_at, created_at, updated_at
```

Note: raw `CREATE TABLE` may still show an older default of `7` for `steps_required_for_unlock`; runtime API and migrations treat omitted create values as **0** unless env/body override.

### Device tokens

Includes `last_used_at` (activity + cleanup). UNIQUE `(user_id, device_token)`. Cap 25 per user. Registering a token deletes any other user's row for the same FCM string so a device is owned by at most one account.

### Prompt sessions (representative)

API behavior, endpoints, and examples: [Prompt sessions (“Sit Sessions”)](#prompt-sessions-sit-sessions).

```sql
-- prompt_sessions
id, pairing_id NULL, created_by_user_id,
status ENUM('prep','bridge','in_session','complete','abandoned'),
current_phase, generation_prompt, bridge_content, session_content,
generation_status ENUM('idle','pending','running','succeeded','failed') DEFAULT 'idle',
generation_started_at NULL, generation_finished_at NULL, generation_error, …

-- prompt_session_preps (one row per user per session)
id, prompt_session_id, user_id,
bringing_text, energy_level, intention, curiosity, boundary, gratitude, optional_focus,
completed_at, …
```

`pairing_id` is nullable (solo / single-device). Startup migrates older NOT NULL columns.

---

## Error handling

| Status | Typical meaning |
|--------|-----------------|
| 400 | Validation, missing fields, bad password/email/org |
| 401 | Missing/invalid/expired token or bad login |
| 403 | Not allowed (wrong user, non-admin, non-member) |
| 404 | Not found |
| 409 | Conflict (email, receipt, active prompt session, therapy already generated, prep not ready, or Sit Session generation already `running`). Sit Session generate returns a `code` — `PREP_NOT_READY` vs `GENERATION_RUNNING` — because the two need opposite client handling |
| 423 | Login lockout |
| 429 | Rate limit |
| 500 | Server / DB |
| 503 | LLM or push not configured (where enforced; Sit Session generate when no API key / mock) |

---

## Example workflows

### Pairing

```bash
# Create users
curl -s -X POST http://localhost:9000/api/users \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"Test1!@#"}'

curl -s -X POST http://localhost:9000/api/users \
  -H "Content-Type: application/json" \
  -d '{"email":"bob@example.com","password":"Test2!@#"}'

# Alice requests code
curl -s -X POST http://localhost:9000/api/pairing/request \
  -H "Authorization: Bearer $ALICE_TOKEN"

# Bob accepts
curl -s -X POST http://localhost:9000/api/pairing/accept \
  -H "Authorization: Bearer $BOB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"partner_code":"ABC123"}'
# → 200 empty body
```

### Program + step message

```bash
# Set names first (required for POST /programs)
curl -s -X PUT http://localhost:9000/api/users/$USER_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_name":"Alex","partner_name":"Sam"}'

curl -s -X POST http://localhost:9000/api/programs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_input":"We want to reconnect.","pairing_id":"PAIRING_ID"}'

# Poll until steps exist
curl -s http://localhost:9000/api/programs/$PROGRAM_ID/programSteps \
  -H "Authorization: Bearer $TOKEN"

curl -s -X POST http://localhost:9000/api/programSteps/$STEP_ID/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"We tried today'\''s exercise together."}'
```

### Login

```bash
curl -s -X POST http://localhost:9000/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"Pass123!"}'
```

Sit Session create / prep / generate curls live under [Prompt sessions (“Sit Sessions”)](#prompt-sessions-sit-sessions).

---

## Testing

Requires a running API (unless `test:ci` / `--skip-server-check`) and MySQL. Prefer mock modes so CI does not spend OpenAI/FCM:

```bash
TEST_MOCK_LLM=true TEST_MOCK_PUSH=true TEST_MOCK_IAP=true npm start
# other terminal:
npm test
```

Test emails use **`@example.com`** so `npm run test:cleanup` can remove them safely. Details: `tests/README.md`.

### Commands

| Command | Purpose |
|---------|---------|
| `npm test` | Full suite (`tests/run-all-tests.js`) |
| `npm run test:ci` | Suite with `--skip-server-check` |
| `npm run test:quick` | Suite with `--no-load` |
| `npm run test:auth` / `test:mysql` | Auth integration (`auth-test.js`) |
| `npm run test:security` | Prompt-injection / safety (service-level) |
| `npm run test:load` | Concurrent/load smoke |
| `npm run test:programs` | Programs CRUD + therapy_response + next_program |
| `npm run test:steps` | Program steps |
| `npm run test:messages` | Step messages CRUD |
| `npm run test:therapy-trigger` | Auto therapy response when both partners post |
| `npm run test:pairing-lifecycle` | Pairing reject / soft-delete / restore |
| `npm run test:user-soft-delete` | User soft-delete / restore + pairing cascade |
| `npm run test:authz-idor` | Pairing/user/messages-stats ownership + admin register gate |
| `npm run test:stripe-billing` | Stripe intent / portal / webhook mock (`stripe-billing-test.js`) |
| `npm run test:admin-auth-refresh` | Admin refresh/logout (`admin-auth-refresh-test.js`) |
| `npm run test:push` | `PushNotificationService` unit tests (mocked FCM) |
| `npm run test:admin-push` | `POST /api/admin/push-test` integration |
| `npm run test:prompt-sessions` | Sit Sessions: solo + paired + pending pairing, prep, generate |
| `npm run test:prompt-session-generate-demo` | Solo create → prep → generate demo; prints `generation` state for debugging |
| `npm run test:cleanup` | Delete `@example.com` test rows |
| `npm run purge:prompt-sessions` | Dry-run: count all Sit Sessions on target DB |
| `npm run purge:prompt-sessions:confirm` | **Delete all** Sit Sessions + preps (see [Purge](#purge-all-sit-sessions-dev--env-reset)) |

Useful flags on the main runner: `--no-load`, `--no-security`, `--no-pairing-lifecycle`, `--no-user-soft-delete`, `--no-stripe-billing`, `--no-admin-auth-refresh`, `--url=…`, `--timeout=…`, `--skip-server-check`.

### Coverage map (`npm test`)

What the default suite exercises vs thinner / standalone areas:

| Area | Covered in `npm test` | Primary suites |
|------|----------------------|----------------|
| Health | Yes | `auth-test` |
| Auth (login, refresh rotation, logout, weak password, WWW-Authenticate) | Yes | `auth-test`, `refresh-token-reset-test`, `www-authenticate-test` |
| Users create / profile / update / authz | Yes | `user-creation-test`, `user-profile-test` |
| User soft-delete / restore + pairing cascade | Yes | `user-soft-delete-test` |
| Pairing request / accept / list / stats | Yes | `auth-test`, `pairings-endpoint-test` |
| Pairing reject / soft-delete / restore | Yes | `pairing-lifecycle-test` |
| Org code + custom org premium linking | Yes | `user-org-code-test`, `program-org-context-test` |
| Programs CRUD, metrics, next, therapy_response | Yes | `programs-test` |
| Steps + messages | Yes | `program-steps-test`, `messages-test` |
| Therapy auto-trigger / chime-in / welcome | Yes | `therapy-trigger-test` |
| Helpful vs Hopeful routing + prompt unit tests | Yes | `program-org-context-test`, `helpful-prompt-service-test`, `hopeful-prompt-service-test` |
| Subscriptions + pairing premium | Yes | `subscription-test` |
| Stripe billing (subscription-intent / Portal / webhook mock) | Yes | `stripe-billing-test` |
| Device tokens | Yes | `device-tokens-test` |
| Sit Sessions (solo, paired, pending pairing; prep visibility; generate) | Yes | `prompt-sessions-test` |
| Push unit + admin push-test | Yes | `push-notification-service-test`, `admin-push-test-test` |
| Security (prompt injection helpers) | Yes | `security-test` |
| Load | Yes (skip with `test:quick`) | `load-test` |
| Admin auth full lifecycle (profile/refresh/logout) | Partial | `admin-auth-refresh-test` (refresh/logout); login/register still used as setup elsewhere |
| Org-codes GET `/:id` / PUT as first-class | Thin (create/delete fixtures + list/audit) | `user-org-code-test` |
| `POST /api/token-info`, `GET /api/messages-stats` | Not covered | — |
| Real OpenAI / load benchmarks | **Excluded** from `npm test` | `openai-test.js`, `openai-load-benchmark.js` (manual) |
| `generation_prompt` / `llm_used` column E2E | Standalone | `generation-prompt-*-test.js`, `llm-used-test.js` |

### Utility scripts

| Script | Purpose |
|--------|---------|
| `node scripts/seed-local-org-codes.js` | Upsert sample org codes for local Hopeful testing |
| `node scripts/query-mysql-database.js` | Ad-hoc DB stats (path/require may need running from repo root) |
| `node scripts/purge-prompt-sessions.js` | Dry-run Sit Session purge; add `--confirm` to delete all (or `npm run purge:prompt-sessions[:confirm]`) |

---

## Project structure

```
helpful-api/
├── config/database.js
├── middleware/
│   ├── auth.js
│   └── security.js
├── models/          # User, Pairing, Program, ProgramStep, Message,
│                    # OrgCode, AdminUser, DeviceToken, PromptSession,
│                    # RefreshToken, Ios/AndroidSubscription, StripeSubscription, …
├── services/
│   ├── AuthService.js
│   ├── AdminAuthService.js
│   ├── PairingService.js
│   ├── SubscriptionService.js        # iOS/Android IAP
│   ├── StripeBillingService.js       # web Payment Element + Portal + webhooks
│   ├── PushNotificationService.js
│   ├── BasePromptService.js          # OpenAI + TEST_MOCK_LLM
│   ├── HelpfulPromptService.js
│   ├── HopefulPromptService.js
│   └── prepValidation.js             # Sit Session prep injection checks
├── routes/
│   ├── users.js
│   ├── auth.js
│   ├── pairing.js
│   ├── programs.js
│   ├── programSteps.js
│   ├── subscription.js               # IAP
│   ├── billing.js                    # Stripe web
│   ├── org-codes.js
│   ├── device-tokens.js
│   ├── promptSessions.js
│   ├── admin-auth.js
│   └── admin.js                      # push-test
├── scripts/
│   ├── seed-local-org-codes.js
│   ├── query-mysql-database.js
│   └── purge-prompt-sessions.js
├── docs/
│   ├── prompt-sessions-design.md
│   └── stripe-billing.md
├── tests/
├── server.js
├── package.json
├── Dockerfile                        # node:18-alpine
├── railway.json
├── nixpacks.toml                     # Node 18
└── .env.example
```

---

## Deployment notes

- **Runtime:** Node **18** (Dockerfile + Nixpacks). `package.json` engines allow `>=16`.
- **Railway / containers:** set `PORT`, `MYSQL_URL` (or MySQL vars), `JWT_*`, `OPENAI_API_KEY`. Optional: Firebase JSON, Stripe (`STRIPE_SECRET_KEY`, webhook secret, price IDs, `STRIPE_CHECKOUT_ALLOWED_ORIGINS`).
- Schema auto-creates; no separate migrate step.
- Health checks should hit `GET /health` (plain text).
- Multi-instance: login lockout is **in-process memory** only. Background jobs also run in-process on **every** instance — disable extras with interval `0` if you scale out.
- Production Stripe: live keys (`rk_live_` / `sk_live_`) + live prices. `RAILWAY_ENVIRONMENT*` logs an error if production is still on test keys.
- Staging / prod URLs: [`docs/stripe-billing.md`](./docs/stripe-billing.md) (Railway environments table).

---

## Removed / obsolete (do not use)

| Item | Status |
|------|--------|
| `/api/conversations`, `/api/programs/.../conversations` | **Not mounted** — use `/api/programSteps` |
| Anthropic / Gemini env keys as API providers | **Not implemented** — OpenAI only |
| `RAILWAY_SETUP.md` | **Not in repo** — use this README + Railway dashboard |
| Password “exactly 8 characters” | **Wrong** — min 8, max 128 |
| Documenting `strictLoginLimiter` as active | **Exported but not mounted** |
| Login `premium` as pairing-only | **Fixed** — login ORs `users.is_premium` (org / Stripe) |
| Hosted Stripe Checkout as the web purchase path | **Legacy** — web uses `POST /api/billing/subscription-intent` |

---

## License

ISC
