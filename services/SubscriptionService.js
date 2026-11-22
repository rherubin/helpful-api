const { AppleReceiptVerifier } = require('./AppleReceiptVerifier');
const {
  GooglePlayReceiptError,
  GooglePlayReceiptVerifier,
  parseRfc3339
} = require('./GooglePlayReceiptVerifier');
const { AndroidSubscriptionConflictError } = require('../models/AndroidSubscription');

// `code` is an optional machine-readable reason, returned alongside `error`
// so clients can branch without parsing the message.
class SubscriptionError extends Error {
  constructor(message, statusCode = 400, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const DEFAULT_GOOGLE_PLAY_PACKAGE_NAMES = ['com.helpful.couples'];
const DEFAULT_GOOGLE_PLAY_PRODUCT_IDS = ['com.helpful.yearly.29.99', 'com.helpful.monthly.9.99'];
const DAY_MS = 24 * 60 * 60 * 1000;

// Google SubscriptionState values that still entitle the user until expiryTime.
// CANCELED means auto-renew is off but the paid period has not ended yet.
const GOOGLE_ENTITLED_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED'
]);
// Paid-for states that no longer entitle the user right now.
const GOOGLE_LAPSED_STATES = new Set([
  'SUBSCRIPTION_STATE_EXPIRED',
  'SUBSCRIPTION_STATE_ON_HOLD',
  'SUBSCRIPTION_STATE_PAUSED'
]);

class SubscriptionService {
  constructor(
    iosSubscriptionModel,
    androidSubscriptionModel,
    userModel,
    pairingModel,
    stripeSubscriptionModel = null,
    appleReceiptVerifier = null,
    googlePlayReceiptVerifier = null
  ) {
    this.iosSubscriptionModel = iosSubscriptionModel;
    this.androidSubscriptionModel = androidSubscriptionModel;
    this.userModel = userModel;
    this.pairingModel = pairingModel;
    this.stripeSubscriptionModel = stripeSubscriptionModel;
    // Constructed lazily so the pinned root certificate is only read from disk
    // in deployments that actually verify receipts (and so tests can inject).
    this.appleReceiptVerifier = appleReceiptVerifier;
    // Also lazy: reads GOOGLE_PLAY_SERVICE_ACCOUNT_JSON on first Android receipt.
    this.googlePlayReceiptVerifier = googlePlayReceiptVerifier;
  }

  getAppleReceiptVerifier() {
    if (!this.appleReceiptVerifier) {
      this.appleReceiptVerifier = new AppleReceiptVerifier();
    }
    return this.appleReceiptVerifier;
  }

  // Throws a 503 SubscriptionError when the service account JSON is present
  // but malformed, so a bad paste surfaces loudly instead of as "not configured".
  getGooglePlayReceiptVerifier() {
    if (!this.googlePlayReceiptVerifier) {
      try {
        this.googlePlayReceiptVerifier = new GooglePlayReceiptVerifier();
      } catch (error) {
        throw new SubscriptionError(
          `Google Play receipt verification is misconfigured: ${error.message}`,
          503,
          'android_verification_misconfigured'
        );
      }
    }
    return this.googlePlayReceiptVerifier;
  }

  // GOOGLE_PLAY_PACKAGE_NAMES may list several application ids (comma-separated),
  // like APPLE_BUNDLE_ID, so a dev server can accept the .dev build too.
  allowedGooglePlayPackageNames() {
    const configured = (process.env.GOOGLE_PLAY_PACKAGE_NAMES || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return configured.length > 0 ? configured : DEFAULT_GOOGLE_PLAY_PACKAGE_NAMES;
  }

  // Subscription product ids that grant premium. Anything else Google returns
  // for this package (a future product, a one-off) does not.
  allowedGooglePlayProductIds() {
    const configured = (process.env.GOOGLE_PLAY_PRODUCT_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return configured.length > 0 ? configured : DEFAULT_GOOGLE_PLAY_PRODUCT_IDS;
  }

  // License-tester purchases (Google's `testPurchase`) are the Android analogue
  // of Apple Sandbox receipts. Accepted by default, like APPLE_IAP_ENVIRONMENT,
  // so internal/closed testing tracks work against any server; each row records
  // is_test_purchase so tester-granted premium stays identifiable. Set
  // GOOGLE_PLAY_ALLOW_TEST_PURCHASES=false to reject them.
  allowsGooglePlayTestPurchases() {
    return String(process.env.GOOGLE_PLAY_ALLOW_TEST_PURCHASES ?? 'true').trim().toLowerCase() !== 'false';
  }

  normalizePlatform(platform) {
    if (!platform || typeof platform !== 'string') {
      throw new SubscriptionError('Platform is required', 400);
    }

    const normalized = platform.trim().toLowerCase();
    if (normalized !== 'ios' && normalized !== 'android') {
      throw new SubscriptionError('Invalid platform. Must be "ios" or "android"', 400);
    }

    return normalized;
  }

  normalizeEnvironment(environment) {
    if (!environment || typeof environment !== 'string') {
      throw new SubscriptionError('environment is required for iOS subscriptions', 400);
    }

    const normalized = environment.trim().toLowerCase();
    if (normalized === 'production') {
      return 'Production';
    }
    if (normalized === 'sandbox') {
      return 'Sandbox';
    }

    throw new SubscriptionError('environment must be Production or Sandbox', 400);
  }

  // Which Apple environments this server accepts. Unset means both: App Review
  // buys with sandbox accounts against the production build, so a production
  // server that rejects Sandbox receipts fails review. Each row records its
  // environment, so sandbox-granted premium stays identifiable. Set
  // APPLE_IAP_ENVIRONMENT=Production (or a comma-separated list) to narrow it.
  allowedAppleIapEnvironments() {
    const configured = (process.env.APPLE_IAP_ENVIRONMENT || '').trim();
    if (!configured) {
      return ['Production', 'Sandbox'];
    }
    return configured.split(',').map((value) => this.normalizeEnvironment(value));
  }

  // APPLE_BUNDLE_ID may list several bundles (comma-separated) so a dev server
  // can accept receipts from both the dev and production builds.
  expectedAppleBundleIds() {
    return (process.env.APPLE_BUNDLE_ID || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  validateTimestamp(name, value) {
    if (value === undefined || value === null) {
      throw new SubscriptionError(`${name} is required`, 400);
    }

    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new SubscriptionError(
        `${name} must be a positive number (timestamp in milliseconds)`,
        400
      );
    }
  }

  // `requireExpiration` is false on the verified path: the mobile client types
  // expiration_date as optional (UserUpdateRequest.SubscriptionPurchaseRequest,
  // `expirationDate: Long? = null`), and when we verify the JWS we take the
  // expiry from Apple's signed claims anyway, so demanding it here would reject
  // a legitimate purchase over a field we are about to discard.
  validateIosPayload(payload, { requireExpiration = true } = {}) {
    const {
      product_id,
      transaction_id,
      original_transaction_id,
      jws_receipt,
      environment,
      purchase_date,
      expiration_date
    } = payload;

    if (!product_id) {
      throw new SubscriptionError('product_id is required for iOS subscriptions', 400);
    }
    if (!transaction_id) {
      throw new SubscriptionError('transaction_id is required for iOS subscriptions', 400);
    }
    if (!original_transaction_id) {
      throw new SubscriptionError('original_transaction_id is required for iOS subscriptions', 400);
    }
    if (!jws_receipt) {
      throw new SubscriptionError('jws_receipt is required for iOS subscriptions', 400);
    }

    const normalizedEnvironment = this.normalizeEnvironment(environment);
    this.validateTimestamp('purchase_date', purchase_date);

    const expirationSupplied = expiration_date !== undefined && expiration_date !== null;
    if (requireExpiration || expirationSupplied) {
      this.validateTimestamp('expiration_date', expiration_date);

      if (expiration_date <= purchase_date) {
        throw new SubscriptionError('expiration_date must be later than purchase_date', 400);
      }
    }

    return {
      product_id,
      transaction_id,
      original_transaction_id,
      jws_receipt,
      environment: normalizedEnvironment,
      purchase_date,
      expiration_date: expirationSupplied ? expiration_date : null
    };
  }

  // expiration_date is optional: the Android app never knows it (Play Billing's
  // Purchase has no expiry, so SubscriptionReceiptBridge.recoverAndroidReceipt
  // always sends null), and the verified path takes the expiry from Google.
  // When a client does send one it must still be sane.
  validateAndroidPayload(payload) {
    const {
      product_id,
      purchase_token,
      order_id,
      package_name,
      purchase_date,
      expiration_date
    } = payload;

    if (!product_id) {
      throw new SubscriptionError('product_id is required for Android subscriptions', 400);
    }
    if (!purchase_token) {
      throw new SubscriptionError('purchase_token is required for Android subscriptions', 400);
    }
    if (!order_id) {
      throw new SubscriptionError('order_id is required for Android subscriptions', 400);
    }
    if (!package_name) {
      throw new SubscriptionError('package_name is required for Android subscriptions', 400);
    }
    if (typeof purchase_token !== 'string' || typeof order_id !== 'string'
      || typeof package_name !== 'string' || typeof product_id !== 'string') {
      throw new SubscriptionError(
        'product_id, purchase_token, order_id and package_name must be strings',
        400
      );
    }

    this.validateTimestamp('purchase_date', purchase_date);

    const expirationSupplied = expiration_date !== undefined && expiration_date !== null;
    if (expirationSupplied) {
      this.validateTimestamp('expiration_date', expiration_date);

      if (expiration_date <= purchase_date) {
        throw new SubscriptionError('expiration_date must be later than purchase_date', 400);
      }
    }

    return {
      product_id,
      purchase_token,
      order_id,
      package_name,
      purchase_date,
      expiration_date: expirationSupplied ? expiration_date : null
    };
  }

  // TEST_MOCK_IAP only: the real app sends no expiry, so derive one from the
  // product's billing period so a mock purchase still grants premium.
  mockAndroidExpiration(productId, purchaseDate) {
    const id = String(productId || '').toLowerCase();
    const periodMs = /year|annual/.test(id) ? 365 * DAY_MS : 30 * DAY_MS;
    return purchaseDate + periodMs;
  }

  async ensureSubscriptionOwnership(existingRecord, userId) {
    if (existingRecord && existingRecord.user_id !== userId) {
      throw new SubscriptionError('Subscription receipt already belongs to another user', 409);
    }
  }

  async upsertAndroidSubscription(userId, data) {
    try {
      return await this.androidSubscriptionModel.upsertSubscription(userId, data);
    } catch (error) {
      if (error instanceof AndroidSubscriptionConflictError) {
        throw new SubscriptionError(error.message, 409);
      }
      throw error;
    }
  }

  // Xcode's local StoreKit store reissues transaction ids 0, 1, 2… after a tester
  // resets purchases. The iOS client reports that environment as Sandbox
  // (StoreManager maps `.xcode` to Sandbox). Those ids are not Apple-unique, so
  // a non-production server reassigns the row to the caller instead of
  // returning 409. Production keeps the rejection, including for App Review
  // sandbox purchases against the production build. A deployed production
  // process sets RAILWAY_ENVIRONMENT_NAME; NODE_ENV=production with no Railway
  // name stays closed too.
  allowsRecycledSandboxReceipts(environment) {
    if (environment !== 'Sandbox') {
      return false;
    }

    const railwayEnv = String(
      process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || ''
    ).trim().toLowerCase();
    if (railwayEnv === 'production') {
      return false;
    }
    if (railwayEnv) {
      return true;
    }

    return process.env.NODE_ENV !== 'production';
  }

  async getAcceptedPairingsForUser(userId) {
    try {
      const userPairings = await this.pairingModel.getAcceptedPairings(userId);
      return userPairings;
    } catch (error) {
      console.error('Error fetching accepted pairings for premium reconciliation:', error.message);
      return [];
    }
  }

  async hasActiveSubscription(userId) {
    const checks = [
      this.iosSubscriptionModel.hasActiveSubscription(userId),
      this.androidSubscriptionModel.hasActiveSubscription(userId)
    ];
    if (this.stripeSubscriptionModel) {
      checks.push(
        this.stripeSubscriptionModel.getActiveForUser(userId).then((row) => !!row)
      );
    }
    const results = await Promise.all(checks);
    return results.some(Boolean);
  }

  // Compute if a pairing should be premium based on either user having an active subscription
  async computePairingPremiumStatus(pairing) {
    const user1HasActive = await this.hasActiveSubscription(pairing.user1_id);
    if (user1HasActive) {
      return true;
    }
    
    if (pairing.user2_id) {
      const user2HasActive = await this.hasActiveSubscription(pairing.user2_id);
      if (user2HasActive) {
        return true;
      }
    }

    return false;
  }

  // Legacy method for backward compatibility - computes if user has access to premium via any pairing
  async computePremiumStatus(userId) {
    const hasActive = await this.hasActiveSubscription(userId);
    if (hasActive) {
      return true;
    }

    // Check if any of user's pairings have a partner with active subscription
    const pairings = await this.getAcceptedPairingsForUser(userId);
    for (const pairing of pairings) {
      const partnerId = pairing.user1_id === userId ? pairing.user2_id : pairing.user1_id;
      if (partnerId && await this.hasActiveSubscription(partnerId)) {
        return true;
      }
    }

    return false;
  }

  // Reconcile premium status for all pairings involving the user
  async reconcilePremiumStatus(userId) {
    const pairings = await this.getAcceptedPairingsForUser(userId);
    const premiumPairingIds = [];

    for (const pairing of pairings) {
      const shouldBePremium = await this.computePairingPremiumStatus(pairing);
      await this.pairingModel.setPremiumStatus(pairing.id, shouldBePremium);
      if (shouldBePremium) {
        premiumPairingIds.push(pairing.id);
      }
    }

    return premiumPairingIds;
  }

  // Verifies the StoreKit 2 JWS and returns a payload built from Apple's signed
  // claims rather than the client's. The client's copies of these fields are
  // only used to detect disagreement — Apple's values always win.
  verifyIosReceipt(validated) {
    let claims;
    try {
      claims = this.getAppleReceiptVerifier().verify(validated.jws_receipt);
    } catch (error) {
      throw new SubscriptionError(`Apple receipt verification failed: ${error.message}`, 400);
    }

    const {
      transactionId,
      originalTransactionId,
      productId,
      expiresDate,
      purchaseDate,
      environment,
      bundleId,
      revocationDate
    } = claims;

    if (!transactionId || !originalTransactionId || !productId) {
      throw new SubscriptionError(
        'Apple receipt is missing its transaction identifiers',
        400
      );
    }

    // Auto-renewable subscriptions always carry an expiry; anything without one
    // is not a subscription and must not grant premium.
    if (typeof expiresDate !== 'number' || !Number.isFinite(expiresDate) || expiresDate <= 0) {
      throw new SubscriptionError(
        'Apple receipt has no subscription expiration date',
        400
      );
    }

    if (typeof revocationDate === 'number' && Number.isFinite(revocationDate) && revocationDate > 0) {
      throw new SubscriptionError('Apple receipt has been revoked', 400);
    }

    // A receipt for a different app is a valid Apple signature over someone
    // else's purchase. Fail closed if we do not know which bundle to expect.
    const expectedBundleIds = this.expectedAppleBundleIds();
    if (expectedBundleIds.length === 0) {
      throw new SubscriptionError(
        'Apple receipt verification is not configured: APPLE_BUNDLE_ID is required',
        503
      );
    }
    if (!expectedBundleIds.includes(bundleId)) {
      throw new SubscriptionError(
        'Apple receipt was issued for a different application',
        400
      );
    }

    const receiptEnvironment = this.normalizeEnvironment(environment || validated.environment);
    const allowedEnvironments = this.allowedAppleIapEnvironments();
    if (!allowedEnvironments.includes(receiptEnvironment)) {
      throw new SubscriptionError(
        `Apple receipt environment ${receiptEnvironment} is not accepted by this server `
        + `(expected ${allowedEnvironments.join(' or ')})`,
        400
      );
    }

    // Disagreement means the client sent a receipt for a transaction other than
    // the one it described. Not necessarily an attack, but never something to
    // silently paper over.
    if (validated.transaction_id !== transactionId
      || validated.original_transaction_id !== originalTransactionId) {
      throw new SubscriptionError(
        'Apple receipt does not match the transaction identifiers supplied with it',
        400
      );
    }

    return {
      ...validated,
      product_id: productId,
      transaction_id: transactionId,
      original_transaction_id: originalTransactionId,
      expiration_date: expiresDate,
      purchase_date: typeof purchaseDate === 'number' && purchaseDate > 0
        ? purchaseDate
        : validated.purchase_date,
      environment: receiptEnvironment
    };
  }

  // Turns Google's SubscriptionPurchaseV2 into the fields we store. Pure: no
  // accept/reject decisions here, so the POST path and the renewal refresh
  // job share one reading of the resource.
  interpretGooglePlaySubscription(resource, { now = Date.now() } = {}) {
    const allowedProducts = this.allowedGooglePlayProductIds();
    const lineItems = Array.isArray(resource?.lineItems) ? resource.lineItems : [];
    const eligible = lineItems
      .filter((item) => item && allowedProducts.includes(item.productId))
      .map((item) => ({ item, expiry: parseRfc3339(item.expiryTime) }));
    // Several line items only happen with multi-item subscriptions; the one
    // that runs longest decides the entitlement.
    eligible.sort((a, b) => (b.expiry || 0) - (a.expiry || 0));
    const chosen = eligible[0] || null;

    const state = typeof resource?.subscriptionState === 'string'
      ? resource.subscriptionState
      : 'SUBSCRIPTION_STATE_UNSPECIFIED';
    let expirationDate = chosen ? chosen.expiry : null;
    // Users in a grace period keep access while Google retries the payment.
    // If Google already reports the period as ended, extend by a day; the
    // refresh job re-checks well before that runs out.
    if (state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' && expirationDate && expirationDate <= now) {
      expirationDate = now + DAY_MS;
    }
    const entitled = !!chosen
      && GOOGLE_ENTITLED_STATES.has(state)
      && typeof expirationDate === 'number'
      && expirationDate > now;

    return {
      lineItem: chosen ? chosen.item : null,
      unknownProductIds: lineItems.map((item) => item?.productId).filter(Boolean),
      product_id: chosen ? chosen.item.productId : null,
      expiration_date: expirationDate,
      order_id: chosen?.item?.latestSuccessfulOrderId || null,
      purchase_date: parseRfc3339(resource?.startTime),
      subscription_state: state,
      auto_renewing: chosen?.item?.autoRenewingPlan
        ? chosen.item.autoRenewingPlan.autoRenewEnabled === true
        : null,
      is_test_purchase: !!resource?.testPurchase,
      linked_purchase_token: typeof resource?.linkedPurchaseToken === 'string' && resource.linkedPurchaseToken
        ? resource.linkedPurchaseToken
        : null,
      acknowledged: resource?.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
      entitled
    };
  }

  mapGooglePlayError(error) {
    if (error instanceof SubscriptionError) {
      return error;
    }
    if (error instanceof GooglePlayReceiptError) {
      if (error.kind === 'invalid') {
        const notFound = error.googleStatus === 404 || error.googleStatus === 410;
        return new SubscriptionError(
          `Google Play receipt verification failed: ${error.message}`,
          400,
          notFound ? 'android_purchase_token_not_found' : 'android_receipt_invalid'
        );
      }
      if (error.kind === 'config') {
        return new SubscriptionError(
          `Google Play receipt verification is misconfigured: ${error.message}`,
          503,
          'android_verification_misconfigured'
        );
      }
      return new SubscriptionError(
        `Google Play receipt verification is temporarily unavailable: ${error.message}`,
        503,
        'android_verification_unavailable'
      );
    }
    return new SubscriptionError(
      `Google Play receipt verification is temporarily unavailable: ${error.message}`,
      503,
      'android_verification_unavailable'
    );
  }

  // Asks Google about the purchase token and returns a payload built from
  // Google's answer. The client's product_id, order_id, purchase_date and
  // expiration_date are not trusted; only purchase_token and package_name are
  // used, and only to know what to ask Google about.
  async verifyAndroidReceipt(validated, verifier) {
    const allowedPackages = this.allowedGooglePlayPackageNames();
    if (!allowedPackages.includes(validated.package_name)) {
      throw new SubscriptionError(
        'Google Play receipt was issued for a different application',
        400,
        'android_package_not_allowed'
      );
    }

    let resource;
    try {
      resource = await verifier.getSubscription(validated.package_name, validated.purchase_token);
    } catch (error) {
      throw this.mapGooglePlayError(error);
    }

    const now = Date.now();
    const info = this.interpretGooglePlaySubscription(resource, { now });

    if (!info.lineItem) {
      throw new SubscriptionError(
        `Google Play purchase is not for a known subscription product (got ${info.unknownProductIds.join(', ') || 'none'})`,
        400,
        'android_unknown_product'
      );
    }

    if (info.is_test_purchase && !this.allowsGooglePlayTestPurchases()) {
      throw new SubscriptionError(
        'Google Play test (license tester) purchases are not accepted by this server',
        400,
        'android_test_purchase_rejected'
      );
    }

    if (!GOOGLE_ENTITLED_STATES.has(info.subscription_state) && !GOOGLE_LAPSED_STATES.has(info.subscription_state)) {
      // PENDING / PENDING_PURCHASE_CANCELED / UNSPECIFIED: nothing was paid.
      throw new SubscriptionError(
        `Google Play purchase is not complete (${info.subscription_state})`,
        400,
        'android_purchase_not_completed'
      );
    }

    if (!info.entitled) {
      throw new SubscriptionError(
        `Google Play subscription is no longer active (${info.subscription_state})`,
        400,
        'android_subscription_not_active'
      );
    }

    if (info.product_id !== validated.product_id) {
      // Not fatal (an upgrade can race the client's view), but worth knowing.
      console.warn(
        `[google-play] client product_id ${validated.product_id} differs from Google's ${info.product_id}; using Google's`
      );
    }

    return {
      ...validated,
      product_id: info.product_id,
      order_id: info.order_id || validated.order_id,
      purchase_date: info.purchase_date || validated.purchase_date,
      expiration_date: info.expiration_date,
      subscription_state: info.subscription_state,
      auto_renewing: info.auto_renewing,
      is_test_purchase: info.is_test_purchase,
      linked_purchase_token: info.linked_purchase_token,
      last_verified_at: now
    };
  }

  async processAndroidReceipt(userId, payload, { trustClientPayload }) {
    let validated = this.validateAndroidPayload(payload);

    if (trustClientPayload) {
      if (validated.expiration_date === null) {
        validated = {
          ...validated,
          expiration_date: this.mockAndroidExpiration(validated.product_id, validated.purchase_date)
        };
      }
      const existing = await this.androidSubscriptionModel.getByOrderId(validated.order_id);
      const existingToken = await this.androidSubscriptionModel.getByPurchaseToken(
        validated.purchase_token
      );
      await this.ensureSubscriptionOwnership(existing, userId);
      await this.ensureSubscriptionOwnership(existingToken, userId);
      return this.upsertAndroidSubscription(userId, validated);
    }

    const verifier = this.getGooglePlayReceiptVerifier();
    if (!verifier.isConfigured()) {
      // Without a service account there is no way to tell a real purchase_token
      // from a fabricated one, so Android stays fail-closed.
      throw new SubscriptionError(
        'Google Play receipt verification is not configured. Set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON '
        + '(or TEST_MOCK_IAP=true for tests only).',
        503,
        'android_verification_not_configured'
      );
    }

    const verified = await this.verifyAndroidReceipt(validated, verifier);

    const existingToken = await this.androidSubscriptionModel.getByPurchaseToken(verified.purchase_token);
    const existingOrder = await this.androidSubscriptionModel.getByOrderId(verified.order_id);
    await this.ensureSubscriptionOwnership(existingToken, userId);
    await this.ensureSubscriptionOwnership(existingOrder, userId);

    const linkedRow = verified.linked_purchase_token
      ? await this.androidSubscriptionModel.getByPurchaseToken(verified.linked_purchase_token)
      : null;

    const result = await this.upsertAndroidSubscription(userId, verified);

    // An upgrade, downgrade or re-signup issues a new token that replaces the
    // old one. Google's guidance is to stop honouring the linked token, so the
    // old row stops granting premium. That holds even when the old row belongs
    // to a different account: the new token is a fresh, Google-verified payment
    // from the same Google account, and it replaces the old subscription.
    if (linkedRow && linkedRow.id !== result.id) {
      await this.androidSubscriptionModel.markLapsed(linkedRow.id, 'SUPERSEDED');
      if (linkedRow.user_id !== userId) {
        await this.reconcilePremiumStatus(linkedRow.user_id);
      }
    }

    return result;
  }

  // Google Play only tells the app about a purchase once (the app submits a
  // receipt while the purchase is unacknowledged and never resubmits it), so
  // renewals, cancellations, refunds and holds are picked up here instead:
  // re-ask Google about verified rows whose stored expiry is near or just past,
  // store the new expiry/state, then re-run premium reconciliation for each
  // affected user. Real-time developer notifications (RTDN) would make this
  // instant; this polling job is the no-extra-infrastructure safety net.
  async refreshAndroidSubscriptions({ limit = 50 } = {}) {
    if (process.env.TEST_MOCK_IAP === 'true') {
      return { skipped: true, reason: 'TEST_MOCK_IAP' };
    }
    let verifier;
    try {
      verifier = this.getGooglePlayReceiptVerifier();
    } catch (error) {
      return { skipped: true, reason: error.message };
    }
    if (!verifier.isConfigured()) {
      return { skipped: true, reason: 'not configured' };
    }

    const rows = await this.androidSubscriptionModel.getRefreshCandidates({ limit });
    const affectedUsers = new Set();
    let updated = 0;
    let lapsed = 0;
    let errors = 0;

    for (const row of rows) {
      try {
        const resource = await verifier.getSubscription(row.package_name, row.purchase_token);
        const now = Date.now();
        const info = this.interpretGooglePlaySubscription(resource, { now });
        if (!info.lineItem) {
          await this.androidSubscriptionModel.markLapsed(row.id, 'UNKNOWN_PRODUCT', now);
          lapsed += 1;
        } else {
          const expiration = info.entitled
            ? info.expiration_date
            : Math.min(info.expiration_date || now, now);
          await this.androidSubscriptionModel.updateVerifiedState(row.id, {
            product_id: info.product_id,
            order_id: info.order_id || row.order_id,
            expiration_date: expiration,
            subscription_state: info.subscription_state,
            auto_renewing: info.auto_renewing,
            is_test_purchase: info.is_test_purchase,
            last_verified_at: now
          });
          if (info.entitled) updated += 1;
          else lapsed += 1;
        }
        affectedUsers.add(row.user_id);
      } catch (error) {
        if (error instanceof GooglePlayReceiptError && error.kind === 'invalid') {
          await this.androidSubscriptionModel.markLapsed(row.id, 'TOKEN_INVALID');
          lapsed += 1;
          affectedUsers.add(row.user_id);
        } else {
          errors += 1;
          console.warn(`[google-play-refresh] could not refresh android subscription ${row.id}: ${error.message}`);
        }
      }
    }

    for (const userId of affectedUsers) {
      try {
        await this.reconcilePremiumStatus(userId);
      } catch (error) {
        errors += 1;
        console.warn(`[google-play-refresh] premium reconcile failed for user ${userId}: ${error.message}`);
      }
    }

    return { skipped: false, checked: rows.length, updated, lapsed, errors };
  }

  async processReceipt(userId, payload) {
    // TEST_MOCK_IAP trusts whatever the client sends. It exists for tests and
    // for dev environments running against a throwaway database — never enable
    // it anywhere production-adjacent, since it reopens the hole this gate was
    // added to close. Mirrors StripeBillingService's TEST_MOCK_STRIPE gate.
    const trustClientPayload = process.env.TEST_MOCK_IAP === 'true';
    const platform = this.normalizePlatform(payload.platform);
    let subscriptionResult;

    if (platform === 'ios') {
      let validated = this.validateIosPayload(payload, { requireExpiration: trustClientPayload });
      if (!trustClientPayload) {
        // Replaces the client's claims with Apple's own signed ones.
        validated = this.verifyIosReceipt(validated);
      }
      const existing = await this.iosSubscriptionModel.getByTransactionId(validated.transaction_id);
      const existingOriginal = await this.iosSubscriptionModel.getByOriginalTransactionId(
        validated.original_transaction_id
      );
      // Incoming environment, not the stored row's. A reset Xcode purchase is
      // Sandbox even when the stuck row was written as Production by an older build.
      const reuseSandboxReceipt = this.allowsRecycledSandboxReceipts(validated.environment);
      const previousOwnerId = reuseSandboxReceipt
        && existing
        && existing.user_id !== userId
        ? existing.user_id
        : null;
      if (!reuseSandboxReceipt) {
        await this.ensureSubscriptionOwnership(existing, userId);
        await this.ensureSubscriptionOwnership(existingOriginal, userId);
      }
      subscriptionResult = await this.iosSubscriptionModel.upsertSubscription(
        userId,
        validated,
        { reassignUser: reuseSandboxReceipt }
      );
      // The recycled id no longer entitles the previous account.
      if (previousOwnerId) {
        await this.reconcilePremiumStatus(previousOwnerId);
      }
    } else {
      subscriptionResult = await this.processAndroidReceipt(userId, payload, { trustClientPayload });
    }

    const expirationDate = subscriptionResult.expiration_date;
    const isActive = expirationDate > Date.now();
    const premiumUpdates = await this.reconcilePremiumStatus(userId);

    return {
      platform,
      subscription: subscriptionResult,
      isActive,
      premiumUpdates
    };
  }

  async getStatus(userId) {
    // Check if user has any premium pairings
    const hasPremiumPairing = await this.pairingModel.userHasPremiumPairing(userId);
    const iosSubscriptions = await this.iosSubscriptionModel.getActiveByUserId(userId);
    const androidSubscriptions = await this.androidSubscriptionModel.getActiveByUserId(userId);

    const allSubscriptions = [
      ...iosSubscriptions.map(subscription => ({ ...subscription, platform: 'ios' })),
      ...androidSubscriptions.map(subscription => ({ ...subscription, platform: 'android' }))
    ];

    let latestExpiration = null;
    if (allSubscriptions.length > 0) {
      latestExpiration = Math.max(...allSubscriptions.map(subscription => subscription.expiration_date));
    }

    return {
      premium: hasPremiumPairing,
      active_subscriptions: allSubscriptions.length,
      latest_expiration: latestExpiration,
      subscriptions: allSubscriptions.map(subscription => ({
        id: subscription.id,
        platform: subscription.platform,
        product_id: subscription.product_id,
        expiration_date: subscription.expiration_date,
        purchase_date: subscription.purchase_date
      }))
    };
  }

  async getReceipts(userId) {
    const iosSubscriptions = await this.iosSubscriptionModel.getByUserId(userId);
    const androidSubscriptions = await this.androidSubscriptionModel.getByUserId(userId);

    return {
      ios_receipts: iosSubscriptions,
      android_receipts: androidSubscriptions,
      total_receipts: iosSubscriptions.length + androidSubscriptions.length
    };
  }
}

module.exports = {
  SubscriptionError,
  SubscriptionService
};
