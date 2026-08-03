# Helpful API

Node.js / Express REST API with MySQL for couples therapy programs: user accounts, JWT auth, partner pairing, AI-generated multi-day programs (Helpful vs Hopeful tracks), step messaging with optional therapy responses, org-code premium, iOS/Android subscriptions, **Stripe web billing**, FCM push registration, admin tooling, and Sit Sessions (prompt sessions).

**Stack:** Node ≥16, Express 4, MySQL 8, JWT + bcrypt, OpenAI Chat Completions (via `BasePromptService`), optional Firebase Admin (FCM).

---

## Features

### Core
- **Users** — create, profile update, soft-delete / restore; bcrypt passwords with validation
- **JWT auth** — access + refresh tokens, rotation, sliding refresh extension on authenticated calls
- **Combined profile** — `GET /api/profile` (user + premium + org summary + pairings)
- **Pairing** — request partner code → accept/reject; soft-delete / restore
- **AI programs** — async generation of day-based program steps; two tracks:
  - **Helpful** (default) — secular EFT/Gottman-style
  - **Hopeful** — faith-based when the user has a linked org code or custom `org_name` / `org_city` / `org_state`
- **Program steps + messages** — day steps, user messages, contributions tracking, unlock progress
- **Sit Sessions** (`/api/prompt-sessions`) — solo (single-device) or paired prep flow; **content generation not implemented** (`POST .../generate` → **501**)

### Premium & orgs
- **Pairing premium** — active iOS/Android subscription on either partner sets `pairings.premium`
- **Org premium** — valid `org_code` (or full custom org name/city/state) sets `users.is_premium`
- **Stripe web billing** — Checkout + Customer Portal + webhooks; persists `stripe_subscriptions` and sets `users.is_premium` when status is `trialing`/`active` (see [`docs/stripe-billing.md`](./docs/stripe-billing.md))
- **Computed `premium`** on profile / GET-PUT user: `hasPremiumPairing || is_premium`  
  **Note:** login response `premium` currently reflects **pairing premium only** (does not OR `is_premium`)

### Ops
- **Push** — device token CRUD; FCM soft no-op when Firebase is not configured
- **Admin** — separate `admin_users` JWT (`type: "admin"`) for org-code CRUD, audit, push-test
- **Rate limits** — global API, login, user update, device tokens, admin push-test
- **Auto schema** — tables + incremental column migrations on startup
- **Railway-friendly** — `PORT` required, `MYSQL_URL` supported

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
| `TEST_MOCK_PUSH` | No | — | Mock FCM success |
| `FIREBASE_SERVICE_ACCOUNT_JSON` / `_PATH` | No | — | Real FCM |
| `USER_UPDATE_RATE_LIMIT` | No | `3` | ≤0 disables |
| `DEVICE_TOKEN_RATE_LIMIT` | No | `10` | ≤0 disables |
| `PROGRAM_GENERATION_FOLLOWUP_*` | No | on / 60s | Second LLM attempt after failure |
| `DEFAULT_STEPS_REQUIRED_FOR_UNLOCK` | No | `0` | Create/next program body default |
| `REGENERATION_POLL_INTERVAL_MS` | No | `30000` | Poller for `regenerate_therapy_response` |
| `PUSH_TOKEN_CLEANUP_INTERVAL_HOURS` | No | `24` | Stale device tokens (>180 days) |

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
| Stripe billing | `POST /api/billing/checkout`, `POST /api/billing/portal`, `GET /api/billing/status`, `POST /api/billing/webhook` |
| Org codes | `/api/org-codes` (admin for mutations) |
| Admin | `/api/admin/auth/*`, `POST /api/admin/push-test` |
| Push devices | `/api/device-tokens` |
| Sit sessions | `/api/prompt-sessions` |
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

On all responses: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`. HSTS only when request is HTTPS / `x-forwarded-proto: https`. CORS is enabled (`cors()` default).

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
| Active iOS/Android sub | Updates accepted pairings’ `premium`; partners see pairing-based premium |
| Valid `org_code` on profile update | Links org, `is_premium = true` |
| Detach / clear org | May clear premium fields per update logic |
| Custom org name+city+state (no code) | Creates/links org path; premium when all three present after merge |

Profile: `premium = pairingPremium || is_premium`.  
Login: `premium` = pairing premium only (implementation quirk — prefer `/api/profile` for full premium).

### Push

- Unconfigured Firebase → sends return `{ skipped: true }` (no-op); API stays up.
- Exception: `POST /api/admin/push-test` → **503** if not configured.
- Dead FCM tokens pruned on send; periodic cleanup of tokens idle >180 days.

### Push kinds (`data.kind`)

| kind | When |
|------|------|
| `pairing_accepted` | Partner accepted pairing |
| `program_ready` | Program generation finished |
| `step_message` | Partner posted on a step |
| `therapy_response` | Couples therapy system messages added |
| `prompt_session_created` | Partner started a Sit Session |
| `prompt_session_prep_complete` | One prep complete, partner still pending |

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
    "refresh_expires_in": 1209600
  }
}
```

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

- `premium` (pairing **or** org)
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

Auth required. Returns flat user + computed `premium` + org summary fields. **Not** restricted to self in code.

#### PUT `/api/users/:id`

Auth; **must be self**. Rate-limited. Optional body: `email`, `user_name`, `partner_name`, `children`, `org_code`, `org_name`, `org_city`, `org_state`.

**Org premium paths:**
- `org_code` string → lookup; not expired → link + premium; **400** invalid/expired code
- Without `org_code`, all three of `org_name`, `org_city`, `org_state` → self-register org premium path

#### DELETE `/api/users/:id` · PATCH `/api/users/:id/restore` · GET `/api/users/deleted/all`

Soft-delete / restore / list deleted. Authenticated (not self-gated on delete/restore today). List-deleted is authenticated but **not** admin-gated.

**Cascade:** soft-deleting a user soft-deletes that user’s pairings. Restoring the user does **not** automatically restore those pairings — restore pairings separately via `PATCH /api/pairing/:id/restore` if needed.

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
| GET | `/api/pairing/:pairingId` | Detail (active only; soft-deleted → not found) |
| DELETE | `/api/pairing/:pairingId` | Soft-delete (**participant only**); **403** outsider |
| PATCH | `/api/pairing/:pairingId/restore` | Restore soft-deleted pairing (any authenticated user; not membership-gated today) |
| GET | `/api/pairing/deleted/all` | Soft-deleted list (auth, not admin-gated) |

**Partner codes:** 6 chars, `A–Z` + `0–9`, unique among active pending codes.

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

Auth. Platform-specific body:

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

### Organization codes

Admin JWT (`type: "admin"`) required for create / get-by-id / update / delete / audit.  
**GET list** allows any authenticated app or admin JWT; non-admins get LLM prompt fields stripped (`initial_program_prompt`, `next_program_prompt`, `therapy_response_prompt`).

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
| POST | `/api/admin/auth/register` | none | Creates admin — **protect/disable in production** |
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

Internal name `prompt_sessions`; product name Sit Session. Design notes: [`docs/prompt-sessions-design.md`](./docs/prompt-sessions-design.md).

**Modes**

| Mode | How | Access | Prep “ready” (`both_preps_complete`) |
|------|-----|--------|--------------------------------------|
| **Solo / single-device** | `POST` with no `pairing_id` | Creator only | **1** completed prep |
| **Paired** | `POST` with `{ "pairing_id" }` | Creator or pairing member | **2** completed preps |

Pairing status need **not** be `accepted` to create a session or submit prep. If `pairing_id` is sent, the caller must still be a **member** of that pairing (pending is fine). Soft-deleted pairings do not grant partner access.

**Policies:** one active (non-terminal) session **per pairing**; one active **solo** session **per user**.

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/prompt-sessions` | Body optional `{ "pairing_id" }` · **201** · **409** if an active session already exists |
| GET | `/api/prompt-sessions` | Optional `?pairing_id=` · list includes solo sessions the user created |
| GET | `/api/prompt-sessions/:id` | Creator or pairing member |
| POST | `/api/prompt-sessions/:id/prep` | Merge prep fields (works without pairing) |
| GET | `/api/prompt-sessions/:id/prep` | Own prep; when paired, partner status (full partner answers only when both complete). Solo: `partner_prep: null` |
| PATCH | `/api/prompt-sessions/:id` | `status` and/or `current_phase` |
| POST | `/api/prompt-sessions/:id/generate` | **409** if prep not ready · **501** not implemented |

**Prep fields (six required for complete):** `bringing_text`, `energy_level`, `intention`, `curiosity`, `boundary`, `gratitude`. Optional: `optional_focus`.  
Statuses: `prep` \| `bridge` \| `in_session` \| `complete` \| `abandoned`.  
`generation_prompt` is never exposed to clients. Prep-ready triggers a **stub** only (log), not LLM.

### Message stats

#### GET `/api/messages-stats?date={epoch_seconds}&programId={id}`

Auth required. `date` is Unix time in **seconds** (not ms).  
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

Includes `last_used_at` (activity + cleanup). UNIQUE `(user_id, device_token)`. Cap 25 per user.

### Prompt sessions (representative)

```sql
-- prompt_sessions
id, pairing_id NULL, created_by_user_id,
status ENUM('prep','bridge','in_session','complete','abandoned'),
current_phase, generation_prompt, bridge_content, session_content, …

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
| 409 | Conflict (email, receipt, active prompt session, therapy already generated) |
| 423 | Login lockout |
| 429 | Rate limit |
| 500 | Server / DB |
| 501 | Prompt session generate not implemented |
| 503 | LLM or push not configured (where enforced) |

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

### Sit Session (solo / single-device)

```bash
# Create without pairing
curl -s -X POST http://localhost:9000/api/prompt-sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'

# Submit prep (all six required fields to mark complete)
curl -s -X POST http://localhost:9000/api/prompt-sessions/$SESSION_ID/prep \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bringing_text":"…","energy_level":"medium","intention":"…",
    "curiosity":"…","boundary":"…","gratitude":"…"
  }'
# → both_preps_complete: true after one complete prep (solo)

# Optional: attach to a pairing you belong to (status need not be accepted)
curl -s -X POST http://localhost:9000/api/prompt-sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pairing_id":"PAIRING_ID"}'
```

---

## Testing

Requires a running API (unless `test:ci` / `--skip-server-check`) and MySQL. Prefer mock modes so CI does not spend OpenAI/FCM:

```bash
TEST_MOCK_LLM=true TEST_MOCK_PUSH=true npm start
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
| `npm run test:push` | `PushNotificationService` unit tests (mocked FCM) |
| `npm run test:admin-push` | `POST /api/admin/push-test` integration |
| `npm run test:prompt-sessions` | Sit Sessions: solo + paired + pending pairing, prep, generate stub |
| `npm run test:cleanup` | Delete `@example.com` test rows |

Useful flags on the main runner: `--no-load`, `--no-security`, `--no-pairing-lifecycle`, `--no-user-soft-delete`, `--url=…`, `--timeout=…`, `--skip-server-check`.

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
| Stripe billing (Checkout/Portal/webhook mock) | Yes | `stripe-billing-test` |
| Device tokens | Yes | `device-tokens-test` |
| Sit Sessions (solo, paired, pending pairing; prep visibility; generate stub) | Yes | `prompt-sessions-test` |
| Push unit + admin push-test | Yes | `push-notification-service-test`, `admin-push-test-test` |
| Security (prompt injection helpers) | Yes | `security-test` |
| Load | Yes (skip with `test:quick`) | `load-test` |
| Admin auth full lifecycle (profile/refresh/logout) | Thin (login/register as setup) | — |
| Org-codes GET `/:id` / PUT as first-class | Thin (create/delete fixtures + list/audit) | `user-org-code-test` |
| `POST /api/token-info`, `GET /api/messages-stats` | Not covered | — |
| Real OpenAI / load benchmarks | **Excluded** from `npm test` | `openai-test.js`, `openai-load-benchmark.js` (manual) |
| `generation_prompt` / `llm_used` column E2E | Standalone | `generation-prompt-*-test.js`, `llm-used-test.js` |

### Utility scripts

| Script | Purpose |
|--------|---------|
| `node scripts/seed-local-org-codes.js` | Upsert sample org codes for local Hopeful testing |
| `node scripts/query-mysql-database.js` | Ad-hoc DB stats (path/require may need running from repo root) |

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
│                    # RefreshToken, Ios/AndroidSubscription, …
├── services/
│   ├── AuthService.js
│   ├── AdminAuthService.js
│   ├── PairingService.js
│   ├── SubscriptionService.js
│   ├── PushNotificationService.js
│   ├── BasePromptService.js      # OpenAI + TEST_MOCK_LLM
│   ├── HelpfulPromptService.js
│   └── HopefulPromptService.js
├── routes/
│   ├── users.js
│   ├── auth.js
│   ├── pairing.js
│   ├── programs.js
│   ├── programSteps.js
│   ├── subscription.js
│   ├── org-codes.js
│   ├── device-tokens.js
│   ├── promptSessions.js
│   ├── admin-auth.js
│   └── admin.js                 # push-test
├── scripts/
│   ├── seed-local-org-codes.js
│   └── query-mysql-database.js
├── docs/
│   └── prompt-sessions-design.md
├── tests/
├── server.js
├── package.json
├── Dockerfile
├── railway.json
├── nixpacks.toml
└── .env.example
```

---

## Deployment notes

- **Railway / containers:** set `PORT`, `MYSQL_URL` (or MySQL vars), `JWT_*`, `OPENAI_API_KEY`, optional Firebase JSON.
- Schema auto-creates; no separate migrate step.
- Health checks should hit `GET /health` (plain text).
- Multi-instance note: login lockout is **in-process memory** only.

---

## Removed / obsolete (do not use)

| Item | Status |
|------|--------|
| `/api/conversations`, `/api/programs/.../conversations` | **Not mounted** — use `/api/programSteps` |
| Anthropic / Gemini env keys as API providers | **Not implemented** — OpenAI only |
| `RAILWAY_SETUP.md` | **Not in repo** — use this README + Railway dashboard |
| Password “exactly 8 characters” | **Wrong** — min 8, max 128 |
| Documenting `strictLoginLimiter` as active | **Exported but not mounted** |

---

## License

ISC
