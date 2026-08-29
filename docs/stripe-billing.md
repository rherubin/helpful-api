# Stripe Billing (web subscriptions)

Sit Together web purchase uses **Stripe Payment Element** (in-app) + **Customer Portal** (hosted) for manage/cancel, with durable records in MySQL. Mobile IAP continues to use `/api/subscription` (iOS/Android receipts).

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

Return URLs for hosted Checkout/Portal must match an origin in `STRIPE_CHECKOUT_ALLOWED_ORIGINS` (or `WEB_APP_ORIGIN`).

## Database

- `users.stripe_customer_id` (nullable, unique)
- `stripe_subscriptions` — `user_id`, `stripe_subscription_id`, `stripe_price_id`, `plan`, `status`, `trial_end`, `current_period_end`, `cancel_at_period_end`

## Premium semantics

- Premium when subscription status is `trialing` or `active` **or** org entitlement
- `invoice.payment_failed` / `customer.subscription.updated|deleted` + reconcile cron clear Stripe-based premium when entitlement lapses (org premium preserved)

## Env vars

See [`.env.example`](../.env.example):

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`
- `STRIPE_TRIAL_PERIOD_DAYS` (default `7`)
- `STRIPE_CHECKOUT_ALLOWED_ORIGINS`
- `STRIPE_RECONCILE_INTERVAL_HOURS` (default `6`; `0` disables)
- `STRIPE_RECONCILE_BATCH_LIMIT` (default `50`)
- `TEST_MOCK_STRIPE=true` — in-process mock client

Web needs `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (publishable only).

## Stripe Dashboard setup

1. Create Product **Sit Together Premium** with Prices: monthly **$11.99**, yearly **$71.99**
2. Copy Price IDs into env
3. Enable Customer Portal
4. Webhook events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`

## Local

```bash
TEST_MOCK_LLM=true TEST_MOCK_PUSH=true TEST_MOCK_STRIPE=true npm start
npm run test:stripe-billing
```

For real Elements testing, set real Stripe test keys + publishable key on web, and:

```bash
stripe listen --forward-to localhost:9000/api/billing/webhook
```

## Staging (Railway)

1. Set Stripe env vars on the API service
2. Webhook endpoint: `https://<api-host>/api/billing/webhook`
3. Set `STRIPE_CHECKOUT_ALLOWED_ORIGINS` to web origin(s)
4. Set web `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
