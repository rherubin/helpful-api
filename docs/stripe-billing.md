# Stripe Billing (web subscriptions)

Sit Together web checkout uses **Stripe Checkout** (hosted) + **Customer Portal**, with durable records in MySQL. Mobile IAP continues to use `/api/subscription` (iOS/Android receipts).

## Flow

1. Web onboarding: plan picker → create account → confirm plan → `POST /api/billing/checkout`
2. API creates/reuses a Stripe Customer, creates a Checkout Session (`mode: subscription`, 7-day trial), returns `{ url }`
3. Browser redirects to Stripe; user enters payment details there
4. Stripe sends webhooks to `POST /api/billing/webhook`
5. API upserts `stripe_subscriptions` and sets `users.is_premium` when status is `trialing` or `active`
6. Browser returns to `/get-started?billing=success|cancel`

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/billing/checkout` | Bearer | Body `{ plan: 'monthly'\|'yearly', success_url?, cancel_url? }` → `{ url, session_id, plan }` |
| POST | `/api/billing/portal` | Bearer | Body `{ return_url? }` → `{ url }` |
| GET | `/api/billing/status` | Bearer | Premium + latest subscription row |
| POST | `/api/billing/webhook` | Stripe signature | Raw body; updates DB |

Return URLs must match an origin in `STRIPE_CHECKOUT_ALLOWED_ORIGINS` (or `WEB_APP_ORIGIN`).

## Database

- `users.stripe_customer_id` (nullable, unique)
- `stripe_subscriptions` — `user_id`, `stripe_subscription_id`, `stripe_price_id`, `plan`, `status`, `trial_end`, `current_period_end`, `cancel_at_period_end`

## Env vars

See [`.env.example`](../.env.example):

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`
- `STRIPE_TRIAL_PERIOD_DAYS` (default `7`)
- `STRIPE_CHECKOUT_ALLOWED_ORIGINS` (e.g. `http://localhost:3000,https://your-web-host`)
- Optional defaults: `STRIPE_CHECKOUT_SUCCESS_URL`, `STRIPE_CHECKOUT_CANCEL_URL`, `STRIPE_PORTAL_RETURN_URL`
- `TEST_MOCK_STRIPE=true` — in-process mock client (no real Stripe calls)

Without `STRIPE_SECRET_KEY`, the API uses the mock client so local/CI stay healthy.
Webhook handling stays disabled in that mode unless `TEST_MOCK_STRIPE=true` is set
explicitly — otherwise forged `stripe-signature` headers could grant premium.

## Stripe Dashboard setup

1. Create Product **Sit Together Premium** with two Prices: monthly **$11.99**, yearly **$71.99**
2. Copy Price IDs into `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_YEARLY`
3. Enable Customer Portal (Settings → Billing → Customer portal)

## Local webhook forwarding (Stripe CLI)

```bash
# Terminal 1 — API (mock LLM/push; real or mock Stripe)
TEST_MOCK_LLM=true TEST_MOCK_PUSH=true npm start

# Terminal 2 — forward webhooks (when using real test keys)
stripe listen --forward-to localhost:9000/api/billing/webhook
# set STRIPE_WEBHOOK_SECRET to the whsec_ value printed by the CLI
```

Then exercise checkout from the web app (`helpful-web` at `http://localhost:3000/get-started`) pointed at `NEXT_PUBLIC_API_URL=http://localhost:9000`.

## Staging (Railway)

1. Set Stripe **test** (or live) env vars on the Railway service
2. In Stripe Dashboard → Developers → Webhooks, add endpoint:
   `https://<your-api-host>/api/billing/webhook`
3. Subscribe to: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
4. Put the signing secret in `STRIPE_WEBHOOK_SECRET`
5. Set `STRIPE_CHECKOUT_ALLOWED_ORIGINS` to your web origin(s)

## Tests

```bash
# API must be running
TEST_MOCK_LLM=true TEST_MOCK_PUSH=true TEST_MOCK_STRIPE=true npm start
npm run test:stripe-billing
```

Or via the suite: `node tests/run-all-tests.js --no-load` (includes Stripe billing unless `--no-stripe-billing`).
