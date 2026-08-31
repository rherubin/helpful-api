# Stripe Billing (web subscriptions)

Sit Together web purchase uses **Stripe Payment Element** (in-app) + **Customer Portal** (hosted) for manage/cancel, with durable records in MySQL. Mobile IAP continues to use `/api/subscription` (iOS/Android receipts).

Account: **Helpful Labs, Inc.** (`acct_1RT5H2HhC3Kq8LCh`).

## Flow

1. Web onboarding: plan picker → create account → Checkout UI
2. Web calls `POST /api/billing/subscription-intent` with `{ plan }`
3. API creates/reuses a Stripe Customer + incomplete Subscription (7-day trial), returns `{ client_secret, mode, subscription_id }`
4. Web mounts Payment Element and confirms Setup/Payment **on Sit Together** (`redirect: 'if_required'`)
5. Stripe webhooks update `stripe_subscriptions` and `users.is_premium` when status is `trialing` or `active`
6. Manage/cancel: `POST /api/billing/portal` → redirect to Stripe Customer Portal
7. Reconcile cron periodically re-fetches open subscriptions from Stripe (missed webhooks / failed renewals)

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/billing/subscription-intent` | Bearer | Body `{ plan }` → `{ client_secret, mode: 'setup'\|'payment', subscription_id, plan }`. **409** if already `trialing`/`active`. |
| POST | `/api/billing/checkout` | Bearer | Hosted Checkout redirect (legacy/optional). Same plan body + return URLs. |
| POST | `/api/billing/portal` | Bearer | Body `{ return_url? }` → `{ url }` |
| GET | `/api/billing/status` | Bearer | Premium + latest subscription row |
| POST | `/api/billing/webhook` | Stripe signature | Raw body; updates DB |

Return URLs for hosted Checkout/Portal must match an origin in `STRIPE_CHECKOUT_ALLOWED_ORIGINS` (or `WEB_APP_ORIGIN`). The web app sends `window.location.origin` for portal returns.

## Database

- `users.stripe_customer_id` (nullable, unique)
- `stripe_subscriptions` — `user_id`, `stripe_subscription_id`, `stripe_price_id`, `plan`, `status`, `trial_end`, `current_period_end`, `cancel_at_period_end`

## Premium semantics

- Premium when subscription status is `trialing` or `active` **or** org entitlement
- `invoice.payment_failed` / `customer.subscription.updated|deleted` + reconcile cron clear Stripe-based premium when entitlement lapses (org premium preserved)
- Orphaned-trial cleanup cron cancels abandoned trials (placeholder `trial.*@sit-together.local` account, `ORPHANED_CLEANUP_AGE_HOURS` old, still no `default_payment_method`) and soft-deletes the placeholder account — see `startOrphanedTrialCleanupJob` in `server.js`

## Env vars

See [`.env.example`](../.env.example):

- `STRIPE_SECRET_KEY` — test `sk_test_` / `rk_test_` on develop; live `rk_live_` (preferred) or `sk_live_` on production
- `STRIPE_WEBHOOK_SECRET` — signing secret for that environment’s webhook endpoint
- `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`
- `STRIPE_TRIAL_PERIOD_DAYS` (default `7`)
- `STRIPE_CHECKOUT_ALLOWED_ORIGINS`
- `STRIPE_RECONCILE_INTERVAL_HOURS` (default `6`; `0` disables)
- `STRIPE_RECONCILE_BATCH_LIMIT` (default `50`)
- `ORPHANED_CLEANUP_INTERVAL_HOURS` (default `24`; `0` disables)
- `ORPHANED_CLEANUP_AGE_HOURS` (default `48`)
- `ORPHANED_CLEANUP_BATCH_LIMIT` (default `50`)
- `ORPHANED_CLEANUP_DRY_RUN` (default `true` — logs candidates only; set `false` to actually cancel/delete)
- `TEST_MOCK_STRIPE=true` — in-process mock client (local/CI only; never on Railway)

Web needs `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (publishable only). It must be the same mode as the API secret: `pk_test_` with develop, `pk_live_` with production.

## Stripe catalog

Product **Sit Together Premium** — $14.99 / month, $79.99 / year, 7-day trial (trial is set in API env, not on the Price).

| Mode | Monthly price | Yearly price | Product |
|------|---------------|--------------|---------|
| Test | `price_1U6aNZHhC3Kq8LChHGPhfBo9` | `price_1U6aRxHhC3Kq8LChrmrfJbis` | `prod_V6nzrCnzmDlmZr` (monthly), `prod_V6o4j5aqUUDugq` (yearly) |
| Live | `price_1U6wpMHhC3Kq8LChFNA328Z7` | `price_1U6wydHhC3Kq8LChlholGwTL` | `prod_V7BBaMIcKILQYo` |

## Railway environments

| | Develop | Production |
|--|---------|------------|
| API | `https://helpful-api-dev.up.railway.app` | `https://helpful-api-prod.up.railway.app` |
| Web | `https://dev.sittogether.org` | `https://www.sittogether.org` |
| API Stripe mode | Test | **Live** (`rk_live_` / `sk_live_` + live prices) |
| Web publishable key | `pk_test_…` on `helpful-web-dev` | `pk_live_…` on `helpful-web-prod` |
| Webhook | `https://helpful-api-dev.up.railway.app/api/billing/webhook` | `https://helpful-api-prod.up.railway.app/api/billing/webhook` |

Webhook events (both endpoints): `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.

## Stripe Dashboard setup

1. Product + Prices as in the catalog table above
2. Copy the matching Price IDs into that environment’s API vars
3. Enable Customer Portal (test and live): [test portal](https://dashboard.stripe.com/test/settings/billing/portal) / [live portal](https://dashboard.stripe.com/settings/billing/portal) — allow payment method update, invoice history, and cancel-at-period-end
4. Webhook endpoints as in the Railway table
5. Prefer a [restricted API key](https://dashboard.stripe.com/apikeys) (`rk_live_` / `rk_test_`) with Customers, Subscriptions, Checkout Sessions, Billing Portal, Invoices, PaymentIntents, SetupIntents, Payment Methods, Products, and Prices

## Local

```bash
TEST_MOCK_LLM=true TEST_MOCK_PUSH=true TEST_MOCK_STRIPE=true npm start
npm run test:stripe-billing
```

For real Elements testing, set real Stripe test keys + publishable key on web, and:

```bash
stripe listen --forward-to localhost:9000/api/billing/webhook
```

Use [test cards](https://docs.stripe.com/testing#cards) such as `4242 4242 4242 4242`.

## Tax

Stripe Tax is **not** enabled (`automatic_tax` is off) and there are no tax registrations. Do not turn on `automatic_tax` until there is an active registration for each jurisdiction where you must collect tax — otherwise Stripe calculates nothing and does not error. See [Collect taxes for recurring payments](https://docs.stripe.com/billing/taxes/collect-taxes).
