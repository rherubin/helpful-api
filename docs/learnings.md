# Learnings and known gaps

Short, verified notes. If a fact is not true in the current `develop` tree, it does not belong here.

## Product behavior

- There is **no password-reset or email-verification** feature in this API. Do not assume `/forgot-password` or verify-email routes exist.
- Sit Session / program **prompt generation is not premium-gated** in the API. If generation should be premium-only, that is a product decision plus a code change.
- Program generation follow-up waits **60 seconds** by default (`PROGRAM_GENERATION_FOLLOWUP_DELAY_MS`, default `60000`). Lower it in tests; do not change the production default casually.
- Shared-device Sit Sessions reject prep from anyone but the creator with **409** `SHARED_DEVICE_SESSION`. The mobile app does not currently handle that code (see [helpful_mobile](https://github.com/rherubin/helpful_mobile)).

## Premium and IAP

- Login and profile report `premium` as "has a premium pairing **or** `users.is_premium`". Stripe and org entitlements set `users.is_premium`. **IAP does not.** `SubscriptionService.getStatus` returns `premium` from pairings only. An unpaired Apple/Google buyer therefore shows as Free on the web until they are in a premium pairing (or until this is changed).
- Bind Play purchases to the signed-in Helpful user (`obfuscatedAccountId` / `obfuscatedExternalAccountId`) is **not implemented**. Until it is, the first account to submit a given `purchaseToken` keeps it (`409` afterwards). That needs a mobile change as well as an API check.
- Android entitlement uses a unique `purchase_token`, a two-hour post-expiry grace for still-entitled rows, and never grants premium in `PAUSED` / `ON_HOLD` / `SUPERSEDED` (and related lapsed states). Details: [google-play-billing.md](google-play-billing.md).
- `GOOGLE_PLAY_ALLOW_TEST_PURCHASES` defaults to `true`, including in production, matching Apple Sandbox. Testers are flagged `is_test_purchase`.

## Tests

- `npm test` is the live-server orchestrator in `tests/run-all-tests.js`. It does **not** currently include `tests/authz-idor-regression-test.js` or `tests/subscription-sandbox-reuse-test.js`. Those files exist; run them with `npm run test:authz-idor` and `node tests/subscription-sandbox-reuse-test.js`. (Coverage work in flight may fold them into the orchestrator later.)
- There is no `npm run test:coverage` / `c8` script on `develop` yet.
- Real OpenAI suites (`tests/openai-test.js`, `tests/openai-load-benchmark.js`) are standalone on purpose — they spend tokens.
- The root README still mentions `test_mock_llm` on `/health/diagnostics`. The code returns only `{"ok":true}`. Trust the code.

## Security follow-ups (not done)

- Optional `CORS_ORIGIN` allowlist is implemented but, when unset, any Origin is reflected. Setting it on Railway production is a recommended follow-up.
- `MYSQL_SSL_REJECT_UNAUTHORIZED` defaults to `false`. Turn it on once Railway MySQL's certificate chain is trusted.
- Login lockout is an **in-memory** map in `middleware/security.js` (5 failures in 15 minutes → 5 minute lock). Multiple Railway replicas do not share it; a shared store (for example Redis) is required for a real lockout.
- Open registration for app users is still allowed; tightening it is a product decision.
- `node_modules` is listed in `.gitignore` but a historical tree is still tracked (thousands of files). Removing it is a repo-hygiene change with a large diff; do it deliberately.
- Dependabot security updates are disabled. Secret scanning and push protection are **enabled** on this public repository (confirmed via the GitHub API, 22 November 2026). They are not a substitute for keeping secrets out of git.
- Firebase Admin / FCM remains optional; client Firebase keys live in the mobile apps and should be restricted in Google Cloud (mobile follow-up).

## Operations

- JWT secrets were rotated 21 November 2026 on Railway production and develop. Rotation logs everyone out. See [runbooks/rotate-jwt-secrets.md](runbooks/rotate-jwt-secrets.md).
- Play billing key creation may be blocked by `iam.disableServiceAccountKeyCreation`. See [runbooks/google-play-service-account.md](runbooks/google-play-service-account.md).
- The Find Bugs Cursor automation may be idle if Cursor is no longer used. See [runbooks/find-bugs-automation.md](runbooks/find-bugs-automation.md).
