class AndroidSubscription {
  constructor(db) {
    this.db = db; // MySQL pool
  }

  // Helper method to execute queries
  async query(sql, params = []) {
    const [results] = await this.db.execute(sql, params);
    return results;
  }

  async queryOne(sql, params = []) {
    const [results] = await this.db.execute(sql, params);
    return results[0] || null;
  }

  // Initialize database table
  async initDatabase() {
    const createTable = `
      CREATE TABLE IF NOT EXISTS android_subscriptions (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        product_id VARCHAR(255) NOT NULL,
        purchase_token VARCHAR(255) NOT NULL,
        order_id VARCHAR(255) NOT NULL,
        package_name VARCHAR(255) NOT NULL,
        purchase_date BIGINT NOT NULL,
        expiration_date BIGINT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_order (order_id),
        INDEX idx_user_id (user_id),
        INDEX idx_purchase_token (purchase_token),
        INDEX idx_expiration_date (expiration_date),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    try {
      await this.query(createTable);
      await this.migrateVerificationColumns();
      console.log('Android subscriptions table initialized successfully.');
    } catch (err) {
      console.error('Error creating android_subscriptions table:', err.message);
      throw err;
    }
  }

  // Columns written when a purchase is verified with the Google Play Developer
  // API. All nullable: rows written by the TEST_MOCK_IAP path leave them NULL.
  //   subscription_state    - Google's SubscriptionState, e.g. SUBSCRIPTION_STATE_ACTIVE
  //   auto_renewing         - lineItem autoRenewingPlan.autoRenewEnabled
  //   is_test_purchase      - Google marked it a license-tester purchase (like Apple Sandbox)
  //   linked_purchase_token - the token this purchase replaced (upgrade / resubscribe)
  //   last_verified_at      - epoch ms of the last successful Google lookup
  static VERIFICATION_COLUMNS = [
    { name: 'subscription_state', type: 'VARCHAR(64) DEFAULT NULL' },
    { name: 'auto_renewing', type: 'TINYINT(1) DEFAULT NULL' },
    { name: 'is_test_purchase', type: 'TINYINT(1) DEFAULT NULL' },
    { name: 'linked_purchase_token', type: 'VARCHAR(255) DEFAULT NULL' },
    { name: 'last_verified_at', type: 'BIGINT DEFAULT NULL' }
  ];

  async migrateVerificationColumns() {
    for (const column of AndroidSubscription.VERIFICATION_COLUMNS) {
      const exists = await this.queryOne(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'android_subscriptions' AND COLUMN_NAME = ?`,
        [column.name]
      );
      if (exists) {
        continue;
      }
      try {
        await this.query(`ALTER TABLE android_subscriptions ADD COLUMN ${column.name} ${column.type}`);
        console.log(`Added ${column.name} column to android_subscriptions table`);
      } catch (err) {
        // Another instance booting at the same moment may have added it first.
        if (err.errno === 1060 || err.code === 'ER_DUP_FIELDNAME') {
          continue;
        }
        throw err;
      }
    }
  }

  // Generate unique ID
  generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Create or update an Android subscription. Looks the row up by order_id
  // first, then by purchase_token: a verified renewal keeps the same token but
  // Google reports a new latest order id (GPA.xxxx..0, ..1), and that must
  // update the existing row rather than add a second one.
  async upsertSubscription(userId, subscriptionData) {
    const {
      product_id,
      purchase_token,
      order_id,
      package_name,
      purchase_date,
      expiration_date
    } = subscriptionData;
    const verification = {
      subscription_state: subscriptionData.subscription_state ?? null,
      auto_renewing: subscriptionData.auto_renewing === undefined || subscriptionData.auto_renewing === null
        ? null
        : (subscriptionData.auto_renewing ? 1 : 0),
      is_test_purchase: subscriptionData.is_test_purchase === undefined || subscriptionData.is_test_purchase === null
        ? null
        : (subscriptionData.is_test_purchase ? 1 : 0),
      linked_purchase_token: subscriptionData.linked_purchase_token ?? null,
      last_verified_at: subscriptionData.last_verified_at ?? null
    };

    const existing = (await this.getByOrderId(order_id))
      || (await this.getByPurchaseToken(purchase_token));

    if (existing) {
      const updateQuery = `
        UPDATE android_subscriptions 
        SET product_id = ?, 
            purchase_token = ?,
            order_id = ?,
            package_name = ?,
            purchase_date = ?,
            expiration_date = ?,
            subscription_state = ?,
            auto_renewing = ?,
            is_test_purchase = ?,
            linked_purchase_token = ?,
            last_verified_at = ?,
            updated_at = NOW()
        WHERE id = ?
      `;
      
      await this.query(updateQuery, [
        product_id,
        purchase_token,
        order_id,
        package_name,
        purchase_date,
        expiration_date,
        verification.subscription_state,
        verification.auto_renewing,
        verification.is_test_purchase,
        verification.linked_purchase_token,
        verification.last_verified_at,
        existing.id
      ]);
      
      return {
        ...existing,
        product_id,
        purchase_token,
        order_id,
        package_name,
        purchase_date,
        expiration_date,
        ...verification,
        updated: true
      };
    }

    // Insert new subscription
    const id = this.generateUniqueId();
    const insertQuery = `
      INSERT INTO android_subscriptions (
        id, user_id, product_id, purchase_token, order_id,
        package_name, purchase_date, expiration_date,
        subscription_state, auto_renewing, is_test_purchase, linked_purchase_token, last_verified_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;

    await this.query(insertQuery, [
      id,
      userId,
      product_id,
      purchase_token,
      order_id,
      package_name,
      purchase_date,
      expiration_date,
      verification.subscription_state,
      verification.auto_renewing,
      verification.is_test_purchase,
      verification.linked_purchase_token,
      verification.last_verified_at
    ]);

    return {
      id,
      user_id: userId,
      product_id,
      purchase_token,
      order_id,
      package_name,
      purchase_date,
      expiration_date,
      ...verification,
      created: true
    };
  }

  // Applies a fresh Google Play lookup to an existing row (renewal refresh).
  async updateVerifiedState(id, fields) {
    await this.query(
      `UPDATE android_subscriptions
       SET product_id = ?, order_id = ?, expiration_date = ?, subscription_state = ?,
           auto_renewing = ?, is_test_purchase = ?, last_verified_at = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        fields.product_id,
        fields.order_id,
        fields.expiration_date,
        fields.subscription_state ?? null,
        fields.auto_renewing === null || fields.auto_renewing === undefined ? null : (fields.auto_renewing ? 1 : 0),
        fields.is_test_purchase === null || fields.is_test_purchase === undefined ? null : (fields.is_test_purchase ? 1 : 0),
        fields.last_verified_at ?? null,
        id
      ]
    );
  }

  // Ends the entitlement of a row Google has told us is gone or replaced.
  // Leaves expiration_date alone when it is already in the past.
  async markLapsed(id, state, now = Date.now()) {
    await this.query(
      `UPDATE android_subscriptions
       SET subscription_state = ?, expiration_date = LEAST(expiration_date, ?),
           last_verified_at = ?, updated_at = NOW()
       WHERE id = ?`,
      [state, now, now, id]
    );
  }

  // Rows whose stored expiry is near or recently past and may have renewed
  // (or been canceled/refunded) since we last asked Google. Rows expired for
  // more than `maxExpiredAgeMs` are skipped: Google returns 410 for
  // subscriptions expired over 60 days, and nothing renews that late. Only
  // rows that were verified with Google in the first place are considered, so
  // rows written by the TEST_MOCK_IAP path are never sent to Google.
  async getRefreshCandidates({
    now = Date.now(),
    lookaheadMs = 24 * 60 * 60 * 1000,
    maxExpiredAgeMs = 30 * 24 * 60 * 60 * 1000,
    minRecheckMs = 60 * 60 * 1000,
    limit = 50
  } = {}) {
    const safeLimit = Math.max(1, Math.min(500, parseInt(limit, 10) || 50));
    return this.query(
      `SELECT * FROM android_subscriptions
       WHERE expiration_date <= ?
         AND expiration_date > ?
         AND (subscription_state IS NULL OR subscription_state NOT IN (
           'SUBSCRIPTION_STATE_EXPIRED', 'SUPERSEDED', 'TOKEN_INVALID'))
         AND last_verified_at IS NOT NULL
         AND last_verified_at < ?
       ORDER BY expiration_date ASC
       LIMIT ${safeLimit}`,
      [now + lookaheadMs, now - maxExpiredAgeMs, now - minRecheckMs]
    );
  }

  // Get subscription by order_id
  async getByOrderId(orderId) {
    try {
      return await this.queryOne(
        'SELECT * FROM android_subscriptions WHERE order_id = ?',
        [orderId]
      );
    } catch (err) {
      throw new Error('Failed to fetch Android subscription');
    }
  }

  // Get subscription by purchase_token
  async getByPurchaseToken(purchaseToken) {
    try {
      return await this.queryOne(
        'SELECT * FROM android_subscriptions WHERE purchase_token = ?',
        [purchaseToken]
      );
    } catch (err) {
      throw new Error('Failed to fetch Android subscription');
    }
  }

  // Get all subscriptions for a user
  async getByUserId(userId) {
    try {
      return await this.query(
        'SELECT * FROM android_subscriptions WHERE user_id = ? ORDER BY created_at DESC',
        [userId]
      );
    } catch (err) {
      throw new Error('Failed to fetch user Android subscriptions');
    }
  }

  // Get active subscriptions for a user (not expired)
  async getActiveByUserId(userId) {
    const now = Date.now();
    try {
      return await this.query(
        'SELECT * FROM android_subscriptions WHERE user_id = ? AND expiration_date > ? ORDER BY expiration_date DESC',
        [userId, now]
      );
    } catch (err) {
      throw new Error('Failed to fetch active Android subscriptions');
    }
  }

  // Check if user has an active subscription
  async hasActiveSubscription(userId) {
    const now = Date.now();
    try {
      const result = await this.queryOne(
        'SELECT id FROM android_subscriptions WHERE user_id = ? AND expiration_date > ? LIMIT 1',
        [userId, now]
      );
      return !!result;
    } catch (err) {
      throw new Error('Failed to check Android subscription status');
    }
  }

  // Delete subscription by ID (for testing purposes)
  async deleteById(id) {
    try {
      const result = await this.query('DELETE FROM android_subscriptions WHERE id = ?', [id]);
      return result.affectedRows > 0;
    } catch (err) {
      throw new Error('Failed to delete Android subscription');
    }
  }

  // Delete subscriptions by user ID (for testing purposes)
  async deleteByUserId(userId) {
    try {
      const result = await this.query('DELETE FROM android_subscriptions WHERE user_id = ?', [userId]);
      return result.affectedRows;
    } catch (err) {
      throw new Error('Failed to delete user Android subscriptions');
    }
  }
}

module.exports = AndroidSubscription;
