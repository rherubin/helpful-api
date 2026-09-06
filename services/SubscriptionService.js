const { AppleReceiptVerifier } = require('./AppleReceiptVerifier');

class SubscriptionError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

class SubscriptionService {
  constructor(
    iosSubscriptionModel,
    androidSubscriptionModel,
    userModel,
    pairingModel,
    stripeSubscriptionModel = null,
    appleReceiptVerifier = null
  ) {
    this.iosSubscriptionModel = iosSubscriptionModel;
    this.androidSubscriptionModel = androidSubscriptionModel;
    this.userModel = userModel;
    this.pairingModel = pairingModel;
    this.stripeSubscriptionModel = stripeSubscriptionModel;
    // Constructed lazily so the pinned root certificate is only read from disk
    // in deployments that actually verify receipts (and so tests can inject).
    this.appleReceiptVerifier = appleReceiptVerifier;
  }

  getAppleReceiptVerifier() {
    if (!this.appleReceiptVerifier) {
      this.appleReceiptVerifier = new AppleReceiptVerifier();
    }
    return this.appleReceiptVerifier;
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

    this.validateTimestamp('purchase_date', purchase_date);
    this.validateTimestamp('expiration_date', expiration_date);

    if (expiration_date <= purchase_date) {
      throw new SubscriptionError('expiration_date must be later than purchase_date', 400);
    }

    return {
      product_id,
      purchase_token,
      order_id,
      package_name,
      purchase_date,
      expiration_date
    };
  }

  async ensureSubscriptionOwnership(existingRecord, userId) {
    if (existingRecord && existingRecord.user_id !== userId) {
      throw new SubscriptionError('Subscription receipt already belongs to another user', 409);
    }
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
      bundleId
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

    // Xcode's local StoreKit testing signs with its own throwaway root, so a
    // receipt from it can never reach this point — but say so explicitly rather
    // than letting it fail as a generic chain error. Note the iOS client reports
    // environment purely from its build config (#if DEBUG -> "Sandbox"), so its
    // own value cannot distinguish this case; only Apple's claim can.
    if (typeof environment === 'string' && environment.trim().toLowerCase() === 'xcode') {
      throw new SubscriptionError(
        'Receipt came from Xcode local StoreKit testing, which Apple does not sign. '
        + 'Use an App Store sandbox purchase, or set TEST_MOCK_IAP=true for local testing only.',
        400
      );
    }

    // A receipt for a different app is a valid Apple signature over someone
    // else's purchase — check it when we know which bundle to expect.
    const expectedBundleId = process.env.APPLE_BUNDLE_ID;
    if (expectedBundleId && bundleId !== expectedBundleId) {
      throw new SubscriptionError(
        'Apple receipt was issued for a different application',
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
      environment: this.normalizeEnvironment(environment || validated.environment)
    };
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
      await this.ensureSubscriptionOwnership(existing, userId);
      await this.ensureSubscriptionOwnership(existingOriginal, userId);
      subscriptionResult = await this.iosSubscriptionModel.upsertSubscription(userId, validated);
    } else {
      // Google Play verification needs a service account calling
      // purchases.subscriptions.get; until those credentials exist there is no
      // way to tell a real purchase_token from a fabricated one, so Android
      // stays fail-closed rather than trusting the client.
      if (!trustClientPayload) {
        throw new SubscriptionError(
          'Google Play receipt verification is not configured. Set TEST_MOCK_IAP=true for tests only.',
          503
        );
      }
      const validated = this.validateAndroidPayload(payload);
      const existing = await this.androidSubscriptionModel.getByOrderId(validated.order_id);
      const existingToken = await this.androidSubscriptionModel.getByPurchaseToken(
        validated.purchase_token
      );
      await this.ensureSubscriptionOwnership(existing, userId);
      await this.ensureSubscriptionOwnership(existingToken, userId);
      subscriptionResult = await this.androidSubscriptionModel.upsertSubscription(userId, validated);
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
