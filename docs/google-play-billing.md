# Google Play Billing (Android subscriptions)

Android subscriptions are bought in the app with Google Play Billing and sent to `POST /api/subscription`. The API checks every purchase token with Google before it grants premium, the same way iOS receipts are checked against Apple's signature (`services/AppleReceiptVerifier.js`).

Code: `services/GooglePlayReceiptVerifier.js` (Google auth and API call), `SubscriptionService.processAndroidReceipt` / `verifyAndroidReceipt` / `refreshAndroidSubscriptions`, `models/AndroidSubscription.js`.

## Flow

1. The app buys `com.helpful.yearly.29.99` or `com.helpful.monthly.9.99` and gets a `purchaseToken`.
2. While the purchase is still **unacknowledged**, the app posts it (`StoreManager.submitThenAcknowledge` → `SubscriptionReceiptBridge.recoverAndroidReceipt`):
   ```json
   {
     "platform": "android",
     "product_id": "com.helpful.yearly.29.99",
     "purchase_token": "<token from Play>",
     "order_id": "GPA.1234-5678-9012-34567",
     "package_name": "com.helpful.couples",
     "purchase_date": 1768926462000,
     "expiration_date": null
   }
   ```
   `expiration_date` is always `null`, because Play Billing's `Purchase` has no expiry. The API never needs it.
3. The API checks that `package_name` is allowed (`GOOGLE_PLAY_PACKAGE_NAMES`), then calls
   [`purchases.subscriptionsv2.get`](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get)
   with the service account.
4. Google's answer replaces the client's fields: product id (`lineItems[].productId`, which must be in `GOOGLE_PLAY_PRODUCT_IDS`), expiry (`lineItems[].expiryTime`), order id (`lineItems[].latestSuccessfulOrderId`), start time, `subscriptionState`, auto-renew, `testPurchase` and `linkedPurchaseToken`.
5. The API stores the row and updates the premium flag on the user's pairings. The app then **acknowledges** the purchase itself. The server does not acknowledge, because the app already does after a successful submit.
6. Renewals: the app never sends the same purchase again, so a background job (`[google-play-refresh]`) asks Google about verified rows whose expiry is close or recently passed. It stores the new expiry, or ends premium if the subscription was canceled, refunded, put on hold or expired.

### Accept / reject rules

| Google says | API response | `code` |
|---|---|---|
| `ACTIVE`, `IN_GRACE_PERIOD`, or `CANCELED` with paid time left | **201/200**, premium granted until `expiryTime` | — |
| `EXPIRED`, `ON_HOLD`, `PAUSED`, or no time left | **400** | `android_subscription_not_active` |
| `PENDING`, `PENDING_PURCHASE_CANCELED`, unknown | **400** | `android_purchase_not_completed` |
| Product not in `GOOGLE_PLAY_PRODUCT_IDS` | **400** | `android_unknown_product` |
| `package_name` not in `GOOGLE_PLAY_PACKAGE_NAMES` (Google is never called) | **400** | `android_package_not_allowed` |
| Token unknown / no longer valid (Google 404 / 410) | **400** | `android_purchase_token_not_found` |
| Other Google 400 | **400** | `android_receipt_invalid` |
| License-tester purchase while `GOOGLE_PLAY_ALLOW_TEST_PURCHASES=false` | **400** | `android_test_purchase_rejected` |
| Token (or Google's order id) already belongs to another user | **409** | — |
| Google auth/permission error (401/403), 429, 5xx, network | **503** (the app retries later) | `android_verification_unavailable` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` unset | **503** | `android_verification_not_configured` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` set but malformed | **503** | `android_verification_misconfigured` |

Error bodies are `{ "error": "<message>", "code": "<code>" }`.

**Upgrades, downgrades and re-signups**: Google issues a new token with `linkedPurchaseToken` pointing at the old one. The new row is stored, and the old row is marked `SUPERSEDED` and stops granting premium, following Google's guidance to invalidate the linked token. This applies even when the old row belongs to a different Helpful account on the same Google account, because the new token is a fresh, verified payment. Premium is then recalculated for both accounts.

**Test purchases**: purchases from license testers (internal or closed testing tracks) carry `testPurchase`. Like Apple Sandbox receipts, they are accepted by default and recorded with `is_test_purchase = 1`, so premium granted to testers can still be told apart. Set `GOOGLE_PLAY_ALLOW_TEST_PURCHASES=false` to reject them.

## Env vars

| Variable | Required | Default | Notes |
|---|---|---|---|
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | **Yes** (for live Android IAP) | — | The full service account key file (JSON), pasted as is **or** base64-encoded (`base64 -w0 key.json`). Without it, Android receipts return **503**. |
| `GOOGLE_PLAY_PACKAGE_NAMES` | No | `com.helpful.couples` | Comma-separated application ids to accept. On the develop server, add the dev build if it is a real Play listing, e.g. `com.helpful.couples.dev,com.helpful.couples`. |
| `GOOGLE_PLAY_PRODUCT_IDS` | No | `com.helpful.yearly.29.99,com.helpful.monthly.9.99` | Comma-separated subscription product ids that grant premium. |
| `GOOGLE_PLAY_ALLOW_TEST_PURCHASES` | No | `true` | `false` rejects license-tester purchases. |
| `GOOGLE_PLAY_REFRESH_INTERVAL_HOURS` | No | `1` | How often the renewal refresh job runs. `0` turns it off. It only starts when `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` is set and `TEST_MOCK_IAP` is not `true`. |
| `GOOGLE_PLAY_REFRESH_BATCH_LIMIT` | No | `50` | Rows checked per run. |

`TEST_MOCK_IAP=true` skips Google entirely and trusts the client, so it must **not** be set on production. When the client sends no expiry in that mode, the API gives it one: 365 days for products whose id contains "year", 30 days otherwise.

## One-time setup (Google Cloud + Play Console)

You need Owner/Admin access to the Helpful Play Console developer account and to a Google Cloud project.

1. **Google Cloud: enable the API.** In <https://console.cloud.google.com/>, pick or create a project (e.g. `helpful-play-billing`). Go to **APIs & Services → Library**, search for **Google Play Android Developer API**, and click **Enable**.
2. **Google Cloud: create the service account.** Go to **IAM & Admin → Service Accounts → Create service account** and name it e.g. `play-receipt-verifier`. It needs **no** Cloud IAM roles, so skip the "Grant access" steps and click **Done**.
3. **Google Cloud: create a key.** Open the service account, then **Keys → Add key → Create new key → JSON**. A `.json` file downloads. Treat it like a password. If your organization blocks key creation (`iam.disableServiceAccountKeyCreation`), an org admin has to allow it for this project.
4. **Play Console: grant access.** In <https://play.google.com/console/>, go to **Users and permissions → Invite new users**. Enter the service account's email (`play-receipt-verifier@<project>.iam.gserviceaccount.com`, also `client_email` in the JSON). Under **App permissions**, add **Helpful (`com.helpful.couples`)** and tick:
   - **View app information (read-only)**
   - **View financial data, orders, and cancellation survey responses**, which the subscription lookup needs
   - **Manage orders and subscriptions**, which is optional today. It is only needed for future server-side acknowledge, refund or revoke calls.

   Click **Invite user**. Service accounts are added right away, with no email to accept.
5. **Wait for propagation.** Google can take up to ~24h, occasionally longer, before a new service account's Play permissions take effect. Until then, lookups return **403** and the API answers **503** `android_verification_unavailable`, which the app retries. A commonly reported way to speed this up is to edit and save any subscription product's description in Play Console.
6. **Set it in Railway** (project → **helpful-api** service → the environment → **Variables**):
   - `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` = the whole contents of the JSON file. Railway accepts multi-line values. If the paste gets mangled, use the base64 form instead: `base64 -w0 key.json` on Linux, or `base64 -i key.json` on macOS.
   - Optionally `GOOGLE_PLAY_PACKAGE_NAMES` (develop only, see above).
   - Make sure `TEST_MOCK_IAP` is **not** `true` in production.

   Saving the variables redeploys the service.
7. **Smoke test.** Buy a subscription from a license-tester account on an internal-testing build pointed at the server. You should see `201` from `POST /api/subscription` and the row in `android_subscriptions` with `subscription_state = SUBSCRIPTION_STATE_ACTIVE`, `is_test_purchase = 1`. Within about an hour you should see `[google-play-refresh] scheduled …` and later `checked=…` log lines. Tester subscriptions renew every few minutes, so the refresh job gets exercised quickly.

## Database

The new columns on `android_subscriptions` are added automatically at startup, and all are nullable. Rows written under `TEST_MOCK_IAP` leave them `NULL`.

`purchase_token` and `linked_purchase_token` are `VARCHAR(1000)` with an `ascii_bin` collation, matching Google's documented 1,000-character maximum for purchase tokens (the original `VARCHAR(255)` would reject or truncate a long token). `purchase_token` is unique, so two Helpful accounts cannot be granted premium for the same Play purchase, including when two submits race.

| Column | Meaning |
|---|---|
| `subscription_state` | Google's `SubscriptionState`, or `SUPERSEDED` (replaced via `linkedPurchaseToken`), `TOKEN_INVALID` (Google 404/410 on refresh), or `UNKNOWN_PRODUCT` |
| `auto_renewing` | `autoRenewingPlan.autoRenewEnabled` |
| `is_test_purchase` | License-tester purchase |
| `linked_purchase_token` | Token this purchase replaced |
| `last_verified_at` | Epoch ms of the last Google lookup. Only rows with this set are refreshed. |

A row is looked up by `order_id` first, then by `purchase_token`. A renewal keeps the token, while Google's latest order id gains a `..N` suffix, so the existing row is updated in place.

Premium is granted from `expiration_date` only when the stored state is not lapsed (`EXPIRED`, `ON_HOLD`, `PAUSED`, `SUPERSEDED`, `TOKEN_INVALID`, `UNKNOWN_PRODUCT`). That way a paused or superseded row cannot keep premium just because its old expiry is still in the future.

## Follow-up: Real-time developer notifications (RTDN)

Without RTDN, the hourly refresh job is the only way renewals, cancellations, refunds, holds and revocations reach the database. Changes can lag by up to `GOOGLE_PLAY_REFRESH_INTERVAL_HOURS`. Rows that are still in an entitled state and already past their stored expiry are re-checked immediately (the usual 1-hour minimum between re-checks does not apply), and a verified subscription stays premium for two hours after its stored expiry so a renewal is not dropped while the job catches up. A refund in the middle of a period is only noticed once the row is near its expiry. To make all of this instant:

1. Create a Pub/Sub topic. Grant `google-play-developer-notifications@system.gserviceaccount.com` the **Pub/Sub Publisher** role on it, then set it under Play Console → **Monetize → Monetization setup → Real-time developer notifications**.
2. Add a push subscription pointing at a new authenticated endpoint (e.g. `POST /api/subscription/google-play/rtdn`). Verify the Pub/Sub OIDC token on each request.
3. For each `subscriptionNotification`, call `verifier.getSubscription(packageName, purchaseToken)` and apply it the same way `refreshAndroidSubscriptions` does. For `voidedPurchaseNotification`, mark the row lapsed.

Today, iOS has the same gap (no App Store Server Notifications), and `pairings.premium` is only recalculated when a receipt is submitted, a pairing changes, or this job touches a user.
