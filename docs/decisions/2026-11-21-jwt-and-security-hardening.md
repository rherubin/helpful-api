# JWT requirements and November 2026 security hardening

- **Date:** 21–22 November 2026
- **Status:** Accepted (shipped to production)

## Context

A security review of helpful-api, helpful-web, and helpful_mobile found no critical live server secrets in the current trees, but several high-severity issues: historical JWT signing secrets in this public repo's git history (present for a short window in July–August 2025), a hardcoded fallback signing secret, `TEST_MOCK_*` flags that could open unsafe paths, an outdated Next.js on the web app, mysql2 TLS behavior, and overly broad GitHub Actions permissions on mobile.

## Decision

- Require real `JWT_SECRET` and `JWT_REFRESH_SECRET` values in production and on every Railway environment; refuse to start otherwise. Local development still starts with a warning if placeholders are used.
- Ignore `TEST_MOCK_*` when the process is in the production deploy environment. Railway develop is not treated as production, so mocks remain usable there. (`config/runtimeEnv.js` is the source of truth; Railway sets `NODE_ENV=production` on every deploy, including develop, so the Railway environment *name* is what distinguishes them.)
- Keep `/health/diagnostics` limited to `{"ok":true}`.
- Upgrade `mysql2` to `^3.24.6`. Leave `MYSQL_SSL_REJECT_UNAUTHORIZED` defaulting to `false` so existing Railway MySQL connections keep working; make full certificate verification opt-in.
- Trust proxy headers only on Railway or when `TRUST_PROXY=true`.
- Add an optional `CORS_ORIGIN` allowlist; leave it unset until the production web origins are confirmed, so existing clients keep working.
- Disable `POST /api/token-info` in production (404).
- Reject admin JWTs on user routes.
- Rotate the live JWT secrets on Railway production and develop (21 November 2026). That signs everyone out once; it is the correct response to the historical leak, even though Railway does not display secret values for comparison.

## Consequences

- A missing or placeholder JWT secret is a hard startup failure on Railway, including develop.
- Production no longer honors mock flags even if someone leaves them set on the service.
- Full database certificate checking is still off by default; turning it on is a follow-up once the Railway MySQL chain is trusted.
- `CORS_ORIGIN` should be set once sittogether.org (and any www / preview origins) are confirmed.
