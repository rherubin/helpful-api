class StripeSubscription {
  constructor(db) {
    this.db = db;
  }

  async query(sql, params = []) {
    const [results] = await this.db.execute(sql, params);
    return results;
  }

  async queryOne(sql, params = []) {
    const [results] = await this.db.execute(sql, params);
    return results[0] || null;
  }

  async initDatabase() {
    const createTable = `
      CREATE TABLE IF NOT EXISTS stripe_subscriptions (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        stripe_subscription_id VARCHAR(255) NOT NULL,
        stripe_price_id VARCHAR(255) DEFAULT NULL,
        plan VARCHAR(20) NOT NULL,
        status VARCHAR(50) NOT NULL,
        trial_end DATETIME DEFAULT NULL,
        current_period_end DATETIME DEFAULT NULL,
        cancel_at_period_end TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_stripe_subscription (stripe_subscription_id),
        INDEX idx_user_id (user_id),
        INDEX idx_status (status),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    try {
      await this.query(createTable);
      console.log('Stripe subscriptions table initialized successfully.');
    } catch (err) {
      console.error('Error creating stripe_subscriptions table:', err.message);
      throw err;
    }
  }

  generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  toMysqlDatetime(value) {
    if (value == null) return null;
    const date = value instanceof Date
      ? value
      : (typeof value === 'number' ? new Date(value * (value < 1e12 ? 1000 : 1)) : new Date(value));
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 19).replace('T', ' ');
  }

  async upsertByStripeSubscriptionId(userId, data) {
    const {
      stripe_subscription_id,
      stripe_price_id = null,
      plan,
      status,
      trial_end = null,
      current_period_end = null,
      cancel_at_period_end = false
    } = data;

    const existing = await this.getByStripeSubscriptionId(stripe_subscription_id);
    const trialEnd = this.toMysqlDatetime(trial_end);
    const periodEnd = this.toMysqlDatetime(current_period_end);
    const cancelFlag = cancel_at_period_end ? 1 : 0;

    if (existing) {
      await this.query(
        `UPDATE stripe_subscriptions
         SET user_id = ?, stripe_price_id = ?, plan = ?, status = ?,
             trial_end = ?, current_period_end = ?, cancel_at_period_end = ?,
             updated_at = NOW()
         WHERE stripe_subscription_id = ?`,
        [
          userId,
          stripe_price_id,
          plan,
          status,
          trialEnd,
          periodEnd,
          cancelFlag,
          stripe_subscription_id
        ]
      );
      return {
        ...existing,
        user_id: userId,
        stripe_price_id,
        plan,
        status,
        trial_end: trialEnd,
        current_period_end: periodEnd,
        cancel_at_period_end: !!cancel_at_period_end,
        updated: true
      };
    }

    const id = this.generateUniqueId();
    await this.query(
      `INSERT INTO stripe_subscriptions (
         id, user_id, stripe_subscription_id, stripe_price_id, plan, status,
         trial_end, current_period_end, cancel_at_period_end, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        id,
        userId,
        stripe_subscription_id,
        stripe_price_id,
        plan,
        status,
        trialEnd,
        periodEnd,
        cancelFlag
      ]
    );

    return {
      id,
      user_id: userId,
      stripe_subscription_id,
      stripe_price_id,
      plan,
      status,
      trial_end: trialEnd,
      current_period_end: periodEnd,
      cancel_at_period_end: !!cancel_at_period_end,
      created: true
    };
  }

  async getByStripeSubscriptionId(stripeSubscriptionId) {
    return this.queryOne(
      'SELECT * FROM stripe_subscriptions WHERE stripe_subscription_id = ?',
      [stripeSubscriptionId]
    );
  }

  async getLatestForUser(userId) {
    return this.queryOne(
      `SELECT * FROM stripe_subscriptions
       WHERE user_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId]
    );
  }

  async getActiveForUser(userId) {
    return this.queryOne(
      `SELECT * FROM stripe_subscriptions
       WHERE user_id = ?
         AND status IN ('trialing', 'active')
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId]
    );
  }

  async getAllActiveForUser(userId) {
    return this.query(
      `SELECT * FROM stripe_subscriptions
       WHERE user_id = ?
         AND status IN ('trialing', 'active')
       ORDER BY updated_at DESC`,
      [userId]
    );
  }

  /**
   * Rows the reconcile cron should re-check against Stripe.
   * Includes past_due/unpaid/incomplete so failed renewals clear premium.
   */
  async listForReconcile(limit = 100) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.query(
      `SELECT * FROM stripe_subscriptions
       WHERE status IN ('trialing', 'active', 'past_due', 'unpaid', 'incomplete')
       ORDER BY updated_at ASC
       LIMIT ${safeLimit}`
    );
  }

  /**
   * Candidates for the orphaned-trial cleanup cron: subscriptions still sitting
   * in trialing/incomplete status whose owning account is still the throwaway
   * placeholder created silently at the start of checkout (see helpful-web
   * generateDevEmail('trial') in lib/api/passwordPolicy.js) and that were created
   * more than `olderThanHours` ago. Age gate keeps this from touching someone
   * mid-checkout who just hasn't finished yet.
   *
   * This is a first-pass local filter only — the service re-verifies each
   * candidate against live Stripe (status + default_payment_method) before
   * canceling anything, since local status can lag a few hours behind Stripe.
   */
  async listOrphanedTrialsForCleanup({ olderThanHours = 48, limit = 50 } = {}) {
    const safeHours = Math.min(Math.max(Number(olderThanHours) || 48, 1), 24 * 30);
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return this.query(
      `SELECT s.*, u.email AS user_email
       FROM stripe_subscriptions s
       JOIN users u ON u.id = s.user_id
       WHERE s.status IN ('trialing', 'incomplete')
         AND u.deleted_at IS NULL
         AND u.email LIKE 'trial.%@sit-together.local'
         AND s.created_at < (NOW() - INTERVAL ? HOUR)
       ORDER BY s.created_at ASC
       LIMIT ${safeLimit}`,
      [safeHours]
    );
  }
}

module.exports = StripeSubscription;
