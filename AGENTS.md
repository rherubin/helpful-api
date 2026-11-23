# Helpful API — contributor and agent guide

This is the canonical onboarding guide for humans and AI tools working in [rherubin/helpful-api](https://github.com/rherubin/helpful-api). Read this file first. Detailed how-tos live under [`docs/`](docs/README.md).

Sibling apps: [helpful-web](https://github.com/rherubin/helpful-web) (Sit Together web) and [helpful_mobile](https://github.com/rherubin/helpful_mobile) (iOS/Android).

## Overview

Node.js / Express API for couples programs, pairing, Sit Sessions (AI prompt generation), push, and premium billing (Stripe on the web; Apple and Google Play in-app purchases on mobile). Persistent store is MySQL. The process auto-creates tables and applies incremental migrations on startup.

Production and develop are hosted on Railway and auto-deploy from `main` and `develop` respectively.

| Environment | URL | Branch |
|-------------|-----|--------|
| Production | https://helpful-api-prod.up.railway.app | `main` |
| Develop | https://helpful-api-dev.up.railway.app | `develop` |

Health: `GET /health` returns plain text `OK`. `GET /health/diagnostics` returns only `{"ok":true}` (it must not expose mock flags or other internals).

## Architecture

```
server.js                 # Process entry, wiring, background jobs, health
config/                   # database.js (mysql2 pool), runtimeEnv.js
middleware/               # auth.js (JWT), security.js (rate limits, lockout, headers)
routes/                   # One factory per area; mounted in setupRoutes()
services/                 # Business logic (auth, pairing, billing, prompts, IAP, push)
models/                   # MySQL access
tests/                    # Live-server integration suites + some unit tests
docs/                     # Product and ops docs (see docs/README.md)
scripts/                  # One-off maintenance (purge, seed, query)
```

### Route factories

| Mount | Factory file | Role |
|-------|--------------|------|
| `/api` (login, refresh, logout, profile, token-info) | `routes/auth.js` | App user auth |
| `/api/users` | `routes/users.js` | User CRUD, soft-delete, org code |
| `/api/pairing` | `routes/pairing.js` | Pair requests, accept/reject, restore |
| `/api/programs`, program steps, messages | `routes/programs.js`, `programSteps.js` | Programs and step chat |
| `/api/prompt-sessions` | `routes/promptSessions.js` | Sit Sessions / AI generation |
| `/api/subscription` | `routes/subscription.js` | Apple / Google Play receipts |
| `/api/billing` | `routes/billing.js` | Stripe (web) |
| `/api/device-tokens` | `routes/device-tokens.js` | Push device tokens |
| `/api/admin`, `/api/admin/auth`, `/api/admin/org-codes` | `routes/admin.js`, `admin-auth.js`, `org-codes.js` | Admin |

Prompt product tracks (Helpful vs Hopeful) are implemented in `services/HelpfulPromptService.js` and `services/HopefulPromptService.js`, both extending `BasePromptService.js`. The LLM vendor is OpenAI only.

## Local setup

Requirements: **Node 24** (see `.nvmrc`; `package.json` `engines.node` is `>=24.0.0`) and a local **MySQL 8** server. CI uses `mysql:8.0`. MariaDB may work but is not what CI or the README use.

```bash
npm ci                 # required; the committed node_modules tree is incomplete
cp .env.example .env
# Set PORT=9000, MYSQL_* (or MYSQL_URL), and JWT_SECRET / JWT_REFRESH_SECRET.
# For local-only work, placeholder JWT values only warn; Railway and production refuse to start without real secrets.

# Create the database (tables are created on boot):
#   CREATE DATABASE helpful_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
# Or: docker run --name helpful-mysql -e MYSQL_ROOT_PASSWORD=password -e MYSQL_DATABASE=helpful_db -p 3306:3306 -d mysql:8.0

npm start          # node server.js
# or
npm run dev        # nodemon
curl -s http://127.0.0.1:9000/health    # expect: OK
```

Optional org-code seed: `node scripts/seed-local-org-codes.js`. Full environment reference: `.env.example` and the Setup section of [README.md](README.md).

## Tests

Most suites hit a **live** server plus MySQL. Mock third-party systems so runs do not spend tokens or call Stripe/FCM/stores.

### Start the server (terminal 1)

```bash
TEST_MOCK_LLM=true TEST_MOCK_PUSH=true TEST_MOCK_IAP=true TEST_MOCK_STRIPE=true npm start
```

`TEST_MOCK_LLM=true` (or `SKIP_RATE_LIMITS=true`) also bypasses the device-token and user-update rate limiters, which is what high-concurrency runs need.

### Run the suite (terminal 2)

```bash
npm test                 # full orchestrator (tests/run-all-tests.js); expects http://127.0.0.1:9000
npm run test:quick       # skip load tests
npm run test:ci          # --skip-server-check (CI still starts the server first)
npm run test:cleanup     # delete @example.com test rows
```

The orchestrator does **not** read `TEST_BASE_URL`. To point `npm test` at a different host or port, pass `--url=`:

```bash
npm test -- --url=http://127.0.0.1:9011
```

Some standalone suites *do* honor `TEST_BASE_URL`. Set both if you run a mix. `tests/README.md` currently lists `TEST_BASE_URL` as if it applied to the whole suite; that is only true for those standalone files.

CI (`.github/workflows/ci.yml`) starts MySQL 8, sets `PORT=9000`, `JWT_SECRET` / `JWT_REFRESH_SECRET`, `MYSQL_*` pointing at the service container, and the four `TEST_MOCK_*` flags above, then `npm start` and `npm test`. Use those same flags locally. CI runs on PRs and pushes to `main` and `develop`, and by hand (`gh workflow run ci.yml --ref <branch>`); docs-only changes skip CI and CodeQL but not the secret scan. Dependabot (`.github/dependabot.yml`) opens at most one grouped update PR per ecosystem (npm, GitHub Actions) each Monday, into `develop`.

There is **no** `test:coverage` script and no `c8` dependency on `develop` as of this writing. Open coverage work may add that later; do not assume the command exists until it is in `package.json`.

All test users must use `@example.com` so cleanup is safe. Suite map, standalone files, and env vars: [tests/README.md](tests/README.md).

Standalone suites that exist but are **not** in `npm test` (run them explicitly when needed):

| Command | What it covers |
|---------|----------------|
| `npm run test:authz-idor` | Ownership / IDOR regressions (`tests/authz-idor-regression-test.js`) |
| `node tests/subscription-sandbox-reuse-test.js` | Apple sandbox receipt reuse |

For large or high-concurrency API runs, restart the server first and follow [docs/runbooks/high-pressure-testing.md](docs/runbooks/high-pressure-testing.md).

## Coding conventions

- **Service injection, not service location.** Routes are factory functions. `server.js` → `setupRoutes()` passes services and models in as arguments; handlers close over them. Do **not** read `req.app.locals.<service>` at request time. Optional dependencies default to `null` and are null-checked. When extending a factory, append the new parameter at the end. `app.locals` is for per-request middleware state, not the dependency graph. (`routes/users.js` used to read `req.app.locals.pairingModel` for soft-delete; that is already threaded through `createUserRoutes`. Do not put it back.)

```javascript
// server.js
app.use('/api/pairing', createPairingRoutes(
  pairingService, authService, pushNotificationService || null, userModel || null, pairingModel || null
));

// routes/pairing.js
function createPairingRoutes(pairingService, authService, pushNotificationService = null, userModel = null, pairingModel = null) {
  router.post('/accept', authenticateToken, async (req, res) => {
    if (pushNotificationService) {
      await pushNotificationService.sendToUser(userId, payload);
    }
  });
}
```

- Match existing file layout: one route factory, one service, one model per concern.
- Prefer extending current patterns (JWT middleware, `isMockFlagEnabled`, `isProductionEnv`) over new ones.
- Do not log emails, tokens, or raw purchase tokens. The lockout logger already redacts identifiers.

## Branch and release workflow

- Default integration branch is **`develop`**. Open feature work as `feat/*`, `fix/*`, `docs/*`, `test/*`, `chore/*` off `develop`, then open a pull request **into `develop`**.
- **Release** is a pull request of `develop` → `main`, merged with a **merge commit** (not squash, so develop history stays intact).
- **Never** push directly to `main` or `develop`. **Never** force-push shared branches.
- `delete_branch_on_merge` is off on this repo. A ruleset named **Protect main and develop from deletion** (created 21 November 2026) blocks deleting those two branches. That exists because a release merge previously auto-deleted `develop`.
- Required reviews and required status checks are **not** enforced by GitHub on this repo (the ruleset is deletion-only). Treat review and green CI as process, not as a merge gate the platform will impose.
- Every pull request gets an **independent, thorough, validated review** before merge: a reviewer who did not author the change, re-run tests, and check findings against the code. See [docs/runbooks/pr-review.md](docs/runbooks/pr-review.md).
- Step-by-step release and health checks: [docs/runbooks/release.md](docs/runbooks/release.md) and [docs/runbooks/deploy-verification.md](docs/runbooks/deploy-verification.md).

## Security rules

- The process **exits** if `JWT_SECRET` or `JWT_REFRESH_SECRET` is missing or still a public placeholder, in production or on any Railway environment (including develop). Local `npm run dev` only warns.
- `TEST_MOCK_*` flags are ignored when `isProductionEnv()` is true (Railway environment name `production`, or `NODE_ENV=production` with no Railway name). Railway develop is **not** treated as production, so mocks still work there.
- `mysql2` is `^3.24.6` or later. TLS certificate verification is **opt-in** via `MYSQL_SSL_REJECT_UNAUTHORIZED=true` (default `false`), because Railway MySQL's certificate chain is not in a public CA set. Prefer turning verification on once the chain is trusted.
- Trust `X-Forwarded-For` only on Railway or when `TRUST_PROXY=true`. Do not trust spoofable forwarded headers on a bare local or unproxied process.
- `CORS_ORIGIN` is an optional comma-separated allowlist. When unset, the API reflects any `Origin` (historical default). Set it in production once the real web origins are confirmed (for example `https://sittogether.org,https://www.sittogether.org`).
- `POST /api/token-info` returns **404** in production. It remains available on develop and local.
- Admin JWTs (`type === 'admin'`) are rejected on user routes with 403 unless the middleware is called with `{ allowAdmin: true }`.
- Do not commit secrets, service-account JSON, `.p8` keys, or `.env` files. `node_modules/` is in `.gitignore` but an old tree is still tracked; do not add more of it.
- JWT signing secrets were rotated on 21 November 2026 after older values appeared in public git history (July–August 2025). Rotation how-to: [docs/runbooks/rotate-jwt-secrets.md](docs/runbooks/rotate-jwt-secrets.md).
- Google Play receipt verification and the org-policy blocker for key creation: [docs/runbooks/google-play-service-account.md](docs/runbooks/google-play-service-account.md) and [docs/google-play-billing.md](docs/google-play-billing.md).
- Known gaps and deferred hardening: [docs/learnings.md](docs/learnings.md).

## Pull request checklist

- [ ] Branch off `develop`; PR targets `develop` (release PRs are the exception: `develop` → `main`).
- [ ] Docs or product behavior updated if the change requires it.
- [ ] Tests added or updated for behavior changes; `npm test` green against a live server with the CI mock flags.
- [ ] No secrets, tokens, private keys, or personal contact details in the diff.
- [ ] Conventions above followed (especially service injection).
- [ ] Independent review completed (see [docs/runbooks/pr-review.md](docs/runbooks/pr-review.md)) before merge.
- [ ] Do not merge until the author or a reviewer has said to merge.

## Where to look next

| Doc | Contents |
|-----|----------|
| [docs/README.md](docs/README.md) | Index of all docs in this repo |
| [README.md](README.md) | Endpoint reference and environment catalog |
| [tests/README.md](tests/README.md) | Suite map and test env vars |
| [docs/learnings.md](docs/learnings.md) | Gotchas and known gaps |
| [docs/decisions/](docs/decisions/) | Dated decision records |
