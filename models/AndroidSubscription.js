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
      console.log('Android subscriptions table initialized successfully.');
    } catch (err) {
      console.error('Error creating android_subscriptions table:', err.message);
      throw err;
    }
  }

  // Generate unique ID
  generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Create or update Android subscription
  async upsertSubscription(userId, subscriptionData) {
    const {
      product_id,
      purchase_token,
      order_id,
      package_name,
      purchase_date,
      expiration_date
    } = subscriptionData;

    // Check if this order already exists
    const existing = await this.getByOrderId(order_id);
    
    if (existing) {
      // Update existing subscription
      const updateQuery = `
        UPDATE android_subscriptions 
        SET product_id = ?, 
            purchase_token = ?,
            package_name = ?,
            purchase_date = ?,
            expiration_date = ?,
            updated_at = NOW()
        WHERE order_id = ?
      `;
      
      await this.query(updateQuery, [
        product_id,
        purchase_token,
        package_name,
        purchase_date,
        expiration_date,
        order_id
      ]);
      
      return {
        ...existing,
        product_id,
        purchase_token,
        package_name,
        purchase_date,
        expiration_date,
        updated: true
      };
    }

    // Insert new subscription
    const id = this.generateUniqueId();
    const insertQuery = `
      INSERT INTO android_subscriptions (
        id, user_id, product_id, purchase_token, order_id,
        package_name, purchase_date, expiration_date, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;

    await this.query(insertQuery, [
      id,
      userId,
      product_id,
      purchase_token,
      order_id,
      package_name,
      purchase_date,
      expiration_date
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
      created: true
    };
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
