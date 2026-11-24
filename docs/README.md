# Helpful API docs

Start with the root [AGENTS.md](../AGENTS.md). The root [README.md](../README.md) is the endpoint and environment reference. [tests/README.md](../tests/README.md) documents the test suites.

## Product and billing

- [Google Play billing](google-play-billing.md) — Android receipt verification, env vars, and one-time Play Console setup
- [Stripe billing](stripe-billing.md) — Web subscriptions, webhooks, trials
- [Prompt sessions design](prompt-sessions-design.md) — Sit Session model and shared-device rules

## Runbooks

- [Release develop to main](runbooks/release.md)
- [Deploy verification and health checks](runbooks/deploy-verification.md)
- [Rotate JWT secrets on Railway](runbooks/rotate-jwt-secrets.md)
- [Google Play service account setup](runbooks/google-play-service-account.md)
- [High-pressure and large test runs](runbooks/high-pressure-testing.md)
- [Pull request review](runbooks/pr-review.md)
- [Find Bugs daily scan (Cursor automation)](runbooks/find-bugs-automation.md)

## Decisions and learnings

- [docs/decisions/](decisions/) — short, dated records of why something is the way it is
- [learnings.md](learnings.md) — gotchas and known gaps

Sibling repos: [helpful-web](https://github.com/rherubin/helpful-web), [helpful_mobile](https://github.com/rherubin/helpful_mobile).
