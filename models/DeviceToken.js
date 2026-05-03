const MAX_TOKENS_PER_USER = 25;

class DeviceToken {
  constructor(db) {
    this.db = db; // MySQL pool
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
      CREATE TABLE IF NOT EXISTS device_tokens (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        device_token VARCHAR(512) NOT NULL,
        platform ENUM('ios', 'android', 'web') NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_device (user_id, device_token),
        INDEX idx_user_id (user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    try {
      await this.query(createTable);
      console.log('Device tokens table initialized successfully.');

      // Migration: make platform NOT NULL for any table created before platform was required
      try {
        const colMeta = await this.queryOne(`
          SELECT IS_NULLABLE, COLUMN_DEFAULT
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'device_tokens'
            AND COLUMN_NAME = 'platform'
        `);

        if (colMeta && colMeta.IS_NULLABLE === 'YES') {
          // Backfill nulls before tightening the constraint (safe default)
          await this.query(`UPDATE device_tokens SET platform = 'ios' WHERE platform IS NULL`);
          await this.query(`ALTER TABLE device_tokens MODIFY COLUMN platform ENUM('ios', 'android', 'web') NOT NULL`);
          console.log('Migrated device_tokens table: platform is now NOT NULL');
        }

        // Migration: drop the now-redundant standalone device_token index if it exists
        try {
          const idxExists = await this.queryOne(`
            SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'device_tokens'
              AND INDEX_NAME = 'idx_device_token'
          `);
          if (idxExists) {
            await this.query('ALTER TABLE device_tokens DROP INDEX idx_device_token');
            console.log('Migrated device_tokens table: dropped redundant idx_device_token index');
          }
        } catch (idxErr) {
          console.warn('Migration warning (drop idx_device_token):', idxErr.message);
        }
      } catch (migrationErr) {
        console.warn('Migration warning for device_tokens platform column:', migrationErr.message);
      }
    } catch (err) {
      console.error('Error creating device_tokens table:', err.message);
      throw err;
    }
  }

  generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Register or update a device token for a user.
   * Uses INSERT ... ON DUPLICATE KEY UPDATE to avoid SELECT→INSERT races.
   * Enforces a per-user cap of MAX_TOKENS_PER_USER before inserting new rows.
   */
  async registerDeviceToken(userId, deviceToken, platform) {
    const validPlatforms = ['ios', 'android', 'web'];
    if (!validPlatforms.includes(platform)) {
      throw new Error(`Invalid platform. Must be one of: ${validPlatforms.join(', ')}`);
    }

    if (typeof deviceToken !== 'string' || deviceToken.length < 10 || deviceToken.length > 512) {
      throw new Error('Invalid device token: must be a string between 10 and 512 characters');
    }

    try {
      // Check per-user cap only when this would be a new token (not an update to existing)
      const existing = await this.queryOne(
        'SELECT id FROM device_tokens WHERE user_id = ? AND device_token = ?',
        [userId, deviceToken]
      );

      if (!existing) {
        const countRow = await this.queryOne(
          'SELECT COUNT(*) AS cnt FROM device_tokens WHERE user_id = ?',
          [userId]
        );
        if (countRow && countRow.cnt >= MAX_TOKENS_PER_USER) {
          throw new Error(`Device token limit reached. A user may have at most ${MAX_TOKENS_PER_USER} registered devices`);
        }
      }

      const id = existing ? existing.id : this.generateUniqueId();

      // Single atomic upsert — no race between check and write
      await this.query(`
        INSERT INTO device_tokens (id, user_id, device_token, platform, created_at, updated_at)
        VALUES (?, ?, ?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          platform = VALUES(platform)
      `, [id, userId, deviceToken, platform]);

      return { id, isNew: !existing };
    } catch (err) {
      if (err.message.includes('Device token limit') || err.message.includes('Invalid')) {
        throw err;
      }
      if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        throw new Error('User not found');
      }
      console.error('Error registering device token:', err);
      throw new Error('Failed to register device token');
    }
  }

  async getUserDeviceTokens(userId) {
    try {
      return await this.query(
        `SELECT id, user_id, platform, created_at, updated_at
         FROM device_tokens
         WHERE user_id = ?
         ORDER BY updated_at DESC, created_at DESC`,
        [userId]
      );
    } catch (err) {
      throw new Error('Failed to fetch user device tokens');
    }
  }

  /**
   * Remove a device token by its record ID, scoped to the given user.
   * Returns true if a row was deleted, false if not found.
   */
  async removeDeviceToken(userId, tokenId) {
    try {
      const result = await this.query(
        'DELETE FROM device_tokens WHERE id = ? AND user_id = ?',
        [tokenId, userId]
      );
      return result.affectedRows > 0;
    } catch (err) {
      throw new Error('Failed to remove device token');
    }
  }

  async cleanupOldTokens(daysOld = 180) {
    try {
      const result = await this.query(`
        DELETE FROM device_tokens
        WHERE updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)
      `, [daysOld]);
      return result.affectedRows;
    } catch (err) {
      throw new Error('Failed to cleanup old device tokens');
    }
  }
}

module.exports = DeviceToken;
