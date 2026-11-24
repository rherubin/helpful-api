# Google Play service account setup

Android in-app purchase verification needs a Google Cloud service account key on Railway **and** Play Console access for that account on the Helpful app (`com.helpful.couples`). The product flow, accept/reject rules, and env var catalog are in [../google-play-billing.md](../google-play-billing.md). This runbook is the ops path and the current blocker.

## What the API needs

- Railway production variable `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` — the full JSON key, or base64 of it, on the `helpful-api` service.
- That service account invited in Play Console on **Helpful (`com.helpful.couples`)** with at least **View financial data, orders, and cancellation survey responses**. **Manage orders and subscriptions** is only required for future server-side acknowledge/refund/revoke.
- Optional: `GOOGLE_PLAY_PACKAGE_NAMES` (comma-separated). The default is `com.helpful.couples` only. The dev application id `com.helpful.couples.dev` is rejected until it is added here.
- `TEST_MOCK_IAP` must not take effect in production (`TEST_MOCK_*` is ignored there even if the variable is still set).

Without a usable key, live Android receipts fail closed with **503**.

## One-time setup

Follow the numbered steps in [../google-play-billing.md](../google-play-billing.md) (enable the Google Play Android Developer API, create the service account, create a JSON key, invite the account in Play Console, wait for propagation, set the Railway variable).

A new Play permission can take up to about 24 hours to apply. Until then Google returns 403 and the API answers **503** `android_verification_unavailable`.

## Current blocker: org policy on key creation

Google organizations can forbid service-account key creation with the constraint `iam.disableServiceAccountKeyCreation`. When that policy is on, **Keys → Add key** fails until an organization administrator temporarily allows key creation for the Cloud project used for Play billing, or grants a role that can change that policy (such as `roles/orgpolicy.policyAdmin`).

A typical temporary override (confirm the project id in Google Cloud before running it):

```bash
gcloud resource-manager org-policies disable-enforce iam.disableServiceAccountKeyCreation --project=PROJECT_ID
```

Create the key, store it only in Railway, then restore the policy so keys cannot be created again by default. Do not commit the JSON.

November 2026 operational work referred to Cloud project `hey-helpful` and service account `helpful-api-play-billing@hey-helpful.iam.gserviceaccount.com` under the heyhelpful.com organization. Those names are **not recorded in this repository** — confirm them in Google Cloud, Play Console, and Railway before changing policy or rotating a key.

## Entitlement rules worth remembering

These are implemented in `models/AndroidSubscription.js` and `services/SubscriptionService.js`:

- `purchase_token` is stored as `VARCHAR(1000)` ASCII with a unique key, so the same token cannot attach to two accounts.
- A verified, still-entitled row stays premium for **two hours** after its stored expiry, to cover the gap until the refresh job writes Google's new expiry.
- `PAUSED`, `ON_HOLD`, `SUPERSEDED`, `TOKEN_INVALID`, `EXPIRED`, and `UNKNOWN_PRODUCT` never grant premium, even if a stored expiry is still in the future.
- Google's own grace period (`SUBSCRIPTION_STATE_IN_GRACE_PERIOD`) is a different concept and does keep access while Google retries payment.

## Related gaps

See [../learnings.md](../learnings.md): no `obfuscatedAccountId` binding yet (needs a mobile change), the mobile app does not handle `SHARED_DEVICE_SESSION`, and an unpaired IAP buyer is not treated as premium on web login/profile (`premium` is pairing-based or `users.is_premium`, and IAP does not set `is_premium`).
