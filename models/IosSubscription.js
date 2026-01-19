class IosSubscription {
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
      CREATE TABLE IF NOT EXISTS ios_subscriptions (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        product_id VARCHAR(255) NOT NULL,
        transaction_id VARCHAR(255) NOT NULL,
        original_transaction_id VARCHAR(255) NOT NULL,
        jws_receipt TEXT NOT NULL,
        environment VARCHAR(50) NOT NULL,
        purchase_date BIGINT NOT NULL,
        expiration_date BIGINT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_transaction (transaction_id),
        INDEX idx_user_id (user_id),
        INDEX idx_original_transaction_id (original_transaction_id),
        INDEX idx_expiration_date (expiration_date),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    try {
      await this.query(createTable);
      console.log('iOS subscriptions table initialized successfully.');
    } catch (err) {
      console.error('Error creating ios_subscriptions table:', err.message);
      throw err;
    }
  }

  // Generate unique ID
  generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Create or update iOS subscription
  async upsertSubscription(userId, subscriptionData) {
    const {
      product_id,
      transaction_id,
      original_transaction_id,
      jws_receipt,
      environment,
      purchase_date,
      expiration_date
    } = subscriptionData;

    // Check if this transaction already exists
    const existing = await this.getByTransactionId(transaction_id);
    
    if (existing) {
      // Update existing subscription
      const updateQuery = `
        UPDATE ios_subscriptions 
        SET product_id = ?, 
            original_transaction_id = ?,
            jws_receipt = ?,
            environment = ?,
            purchase_date = ?,
            expiration_date = ?,
            updated_at = NOW()
        WHERE transaction_id = ?
      `;
      
      await this.query(updateQuery, [
        product_id,
        original_transaction_id,
        jws_receipt,
        environment,
        purchase_date,
        expiration_date,
        transaction_id
      ]);
      
      return {
        ...existing,
        product_id,
        original_transaction_id,
        jws_receipt,
        environment,
        purchase_date,
        expiration_date,
        updated: true
      };
    }

    // Insert new subscription
    const id = this.generateUniqueId();
    const insertQuery = `
      INSERT INTO ios_subscriptions (
        id, user_id, product_id, transaction_id, original_transaction_id,
        jws_receipt, environment, purchase_date, expiration_date, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;

    await this.query(insertQuery, [
      id,
      userId,
      product_id,
      transaction_id,
      original_transaction_id,
      jws_receipt,
      environment,
      purchase_date,
      expiration_date
    ]);

    return {
      id,
      user_id: userId,
      product_id,
      transaction_id,
      original_transaction_id,
      jws_receipt,
      environment,
      purchase_date,
      expiration_date,
      created: true
    };
  }

  // Get subscription by transaction_id
  async getByTransactionId(transactionId) {
    try {
      return await this.queryOne(
        'SELECT * FROM ios_subscriptions WHERE transaction_id = ?',
        [transactionId]
      );
    } catch (err) {
      throw new Error('Failed to fetch iOS subscription');
    }
  }

  // Get subscription by original_transaction_id
  async getByOriginalTransactionId(originalTransactionId) {
    try {
      return await this.queryOne(
        'SELECT * FROM ios_subscriptions WHERE original_transaction_id = ?',
        [originalTransactionId]
      );
    } catch (err) {
      throw new Error('Failed to fetch iOS subscription');
    }
  }

  // Get all subscriptions for a user
  async getByUserId(userId) {
    try {
      return await this.query(
        'SELECT * FROM ios_subscriptions WHERE user_id = ? ORDER BY created_at DESC',
        [userId]
      );
    } catch (err) {
      throw new Error('Failed to fetch user iOS subscriptions');
    }
  }

  // Get active subscriptions for a user (not expired)
  async getActiveByUserId(userId) {
    const now = Date.now();
    try {
      return await this.query(
        'SELECT * FROM ios_subscriptions WHERE user_id = ? AND expiration_date > ? ORDER BY expiration_date DESC',
        [userId, now]
      );
    } catch (err) {
      throw new Error('Failed to fetch active iOS subscriptions');
    }
  }

  // Check if user has an active subscription
  async hasActiveSubscription(userId) {
    const now = Date.now();
    try {
      const result = await this.queryOne(
        'SELECT id FROM ios_subscriptions WHERE user_id = ? AND expiration_date > ? LIMIT 1',
        [userId, now]
      );
      return !!result;
    } catch (err) {
      throw new Error('Failed to check iOS subscription status');
    }
  }

  // Delete subscription by ID (for testing purposes)
  async deleteById(id) {
    try {
      const result = await this.query('DELETE FROM ios_subscriptions WHERE id = ?', [id]);
      return result.affectedRows > 0;
    } catch (err) {
      throw new Error('Failed to delete iOS subscription');
    }
  }

  // Delete subscriptions by user ID (for testing purposes)
  async deleteByUserId(userId) {
    try {
      const result = await this.query('DELETE FROM ios_subscriptions WHERE user_id = ?', [userId]);
      return result.affectedRows;
    } catch (err) {
      throw new Error('Failed to delete user iOS subscriptions');
    }
  }
}

module.exports = IosSubscription;
