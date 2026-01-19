class SubscriptionError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

class SubscriptionService {
  constructor(iosSubscriptionModel, androidSubscriptionModel, userModel, pairingModel) {
    this.iosSubscriptionModel = iosSubscriptionModel;
    this.androidSubscriptionModel = androidSubscriptionModel;
    this.userModel = userModel;
    this.pairingModel = pairingModel;
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

  validateIosPayload(payload) {
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
    this.validateTimestamp('expiration_date', expiration_date);

    if (expiration_date <= purchase_date) {
      throw new SubscriptionError('expiration_date must be later than purchase_date', 400);
    }

    return {
      product_id,
      transaction_id,
      original_transaction_id,
      jws_receipt,
      environment: normalizedEnvironment,
      purchase_date,
      expiration_date
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

  async getAcceptedPartnerIds(userId) {
    try {
      const userPairings = await this.pairingModel.getAcceptedPairings(userId);
      const partnerIds = [];
      for (const pairing of userPairings) {
        const partnerId = pairing.user1_id === userId ? pairing.user2_id : pairing.user1_id;
        if (partnerId && !partnerIds.includes(partnerId)) {
          partnerIds.push(partnerId);
        }
      }
      return partnerIds;
    } catch (error) {
      console.error('Error fetching accepted pairings for premium reconciliation:', error.message);
      return [];
    }
  }

  async hasActiveSubscription(userId) {
    const [iosActive, androidActive] = await Promise.all([
      this.iosSubscriptionModel.hasActiveSubscription(userId),
      this.androidSubscriptionModel.hasActiveSubscription(userId)
    ]);
    return iosActive || androidActive;
  }

  async computePremiumStatus(userId) {
    const hasActive = await this.hasActiveSubscription(userId);
    if (hasActive) {
      return true;
    }

    const partnerIds = await this.getAcceptedPartnerIds(userId);
    for (const partnerId of partnerIds) {
      if (await this.hasActiveSubscription(partnerId)) {
        return true;
      }
    }

    return false;
  }

  async reconcilePremiumStatus(userId) {
    const partnerIds = await this.getAcceptedPartnerIds(userId);
    const userIds = Array.from(new Set([userId, ...partnerIds]));
    const premiumUpdates = [];

    for (const id of userIds) {
      const shouldBePremium = await this.computePremiumStatus(id);
      await this.userModel.setPremiumStatus(id, shouldBePremium);
      if (shouldBePremium) {
        premiumUpdates.push(id);
      }
    }

    return premiumUpdates;
  }

  async processReceipt(userId, payload) {
    const platform = this.normalizePlatform(payload.platform);
    let subscriptionResult;

    if (platform === 'ios') {
      const validated = this.validateIosPayload(payload);
      const existing = await this.iosSubscriptionModel.getByTransactionId(validated.transaction_id);
      const existingOriginal = await this.iosSubscriptionModel.getByOriginalTransactionId(
        validated.original_transaction_id
      );
      await this.ensureSubscriptionOwnership(existing, userId);
      await this.ensureSubscriptionOwnership(existingOriginal, userId);
      subscriptionResult = await this.iosSubscriptionModel.upsertSubscription(userId, validated);
    } else {
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
    const isPremium = await this.userModel.getPremiumStatus(userId);
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
      premium: isPremium,
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
