# Test Suite Documentation

Integration and unit tests for the Helpful API. Most suites hit a **live** server + MySQL; LLM/push are mocked via env so CI does not spend tokens.

For API surface and product behavior, see the root [README.md](../README.md).

## Quick start

```bash
# Terminal 1 — mock LLM + push
TEST_MOCK_LLM=true TEST_MOCK_PUSH=true npm start

# Terminal 2
npm test                 # full suite
npm run test:quick       # skip load tests
npm run test:cleanup     # remove @example.com test rows
```

All test users **must** use `@example.com` so cleanup is safe.

---

## What `npm test` runs

Orchestrator: `run-all-tests.js` (order roughly: security → load → auth → users/pairings → programs/messages → subscriptions/org → device tokens → prompt services → push → prompt sessions).

| Suite file | Area |
|------------|------|
| `security-test.js` | Prompt-injection / safety helpers (service-level) |
| `load-test.js` | Concurrent request smoke |
| `auth-test.js` | Register, login, refresh rotation, logout, pairing request, profile |
| `user-creation-test.js` | `POST /api/users` |
| `pairings-endpoint-test.js` | `GET /api/pairings`, accept flow, accepted/stats |
| `pairing-lifecycle-test.js` | Reject, soft-delete, restore pairings |
| `user-soft-delete-test.js` | User soft-delete / restore + pairing cascade |
| `user-profile-test.js` | `GET /api/profile`, user GET/PUT |
| `refresh-token-reset-test.js` | Sliding refresh extension on authenticated calls |
| `programs-test.js` | Programs CRUD, metrics, `therapy_response`, `next_program` |
| `program-steps-test.js` | Program steps list/get |
| `messages-test.js` | Step message list/create/update |
| `therapy-trigger-test.js` | Couples therapy auto-trigger, welcome, chime-in |
| `www-authenticate-test.js` | 401 `WWW-Authenticate` header |
| `subscription-test.js` | iOS/Android receipts, premium, GET status/receipts |
| `user-org-code-test.js` | Org code + custom org premium on `PUT /users` |
| `device-tokens-test.js` | Device token CRUD |
| `helpful-prompt-service-test.js` | Helpful track unit tests (mocked fetch) |
| `hopeful-prompt-service-test.js` | Hopeful track + custom org prompts (mocked fetch) |
| `program-org-context-test.js` | Helpful/Hopeful routing by org context |
| `push-notification-service-test.js` | Push service unit tests (no real FCM) |
| `admin-push-test-test.js` | `POST /api/admin/push-test` |
| `prompt-sessions-test.js` | Sit Sessions end-to-end |

Skip categories with flags, e.g. `--no-load`, `--no-pairing-lifecycle`, `--no-user-soft-delete`, `--skip-server-check`.

### npm scripts

| Command | Runs |
|---------|------|
| `npm test` | Full orchestrator |
| `npm run test:ci` | `--skip-server-check` |
| `npm run test:quick` | `--no-load` |
| `npm run test:auth` | `auth-test.js` |
| `npm run test:security` | `security-test.js` |
| `npm run test:load` | `load-test.js` |
| `npm run test:programs` | `programs-test.js` |
| `npm run test:steps` | `program-steps-test.js` |
| `npm run test:messages` | `messages-test.js` |
| `npm run test:therapy-trigger` | `therapy-trigger-test.js` |
| `npm run test:pairing-lifecycle` | `pairing-lifecycle-test.js` |
| `npm run test:user-soft-delete` | `user-soft-delete-test.js` |
| `npm run test:push` | `push-notification-service-test.js` |
| `npm run test:admin-push` | `admin-push-test-test.js` |
| `npm run test:prompt-sessions` | `prompt-sessions-test.js` |
| `npm run test:cleanup` | `cleanup-test-data.js` |

---

## Standalone (not in `npm test`)

| File | Why separate |
|------|----------------|
| `openai-test.js` | Real OpenAI — burns tokens |
| `openai-load-benchmark.js` | Real OpenAI load — burns tokens |
| `generation-prompt-helpful-test.js` | DB assert on `generation_prompt` (Helpful path) |
| `generation-prompt-hopeful-test.js` | DB assert on `generation_prompt` (Hopeful/org path) |
| `llm-used-test.js` | DB assert on `llm_used` column |
| `test-refresh-token-hashing.js` | Local hashing unit check |
| `mysql-load-test.js` | Heavier MySQL/auth load |

Run with `node tests/<file>.js` when needed.

---

## Coverage notes

**Strong (default suite):** auth, users (create/profile/update/soft-delete), pairing lifecycle (request/accept/reject/delete/restore), org premium, programs/steps/messages/therapy, subscriptions, device tokens, Sit Sessions, Helpful/Hopeful prompts, push unit + admin push-test.

**Thin / untested product edges:**
- Admin auth profile / refresh / logout as a dedicated suite (login/register used as setup elsewhere)
- Org-codes admin GET-by-id and PUT as first-class cases
- `POST /api/token-info`, `GET /api/messages-stats`
- `GET /api/users/deleted/all`, `GET /api/pairing/deleted/all`

Do not add real OpenAI suites to `npm test` without an explicit decision to spend tokens.

---

## Environment

| Variable | Role |
|----------|------|
| `TEST_MOCK_LLM=true` | Deterministic LLM mocks; also bypasses some rate limits |
| `TEST_MOCK_PUSH=true` | Mock FCM for admin push-test / push paths |
| `TEST_MOCK_OPENAI=true` | Skip waiting for async step generation in some suites |
| `TEST_BASE_URL` | Override default `http://127.0.0.1:9000` |
| `TEST_REPORT_FILE` | If set, `run-all-tests.js` writes a JSON report |
| `SKIP_RATE_LIMITS=true` / `NODE_ENV=test` | Rate-limit bypass (where coded) |

Shared helpers: `test-helpers.js` (`generateTestEmail`, `pollForProgramSteps`, etc.).
