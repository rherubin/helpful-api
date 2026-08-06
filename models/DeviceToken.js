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
        last_used_at DATETIME NULL,
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

        // Migration: add last_used_at column (used for push token activity tracking + smarter cleanup)
        try {
          const lastUsedCol = await this.queryOne(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'device_tokens'
              AND COLUMN_NAME = 'last_used_at'
          `);

          if (!lastUsedCol) {
            await this.query('ALTER TABLE device_tokens ADD COLUMN last_used_at DATETIME NULL AFTER updated_at');
            // Backfill for existing rows so they are not immediately eligible for cleanup
            await this.query(`
              UPDATE device_tokens
              SET last_used_at = COALESCE(updated_at, created_at)
              WHERE last_used_at IS NULL
            `);
            console.log('Migrated device_tokens table: added last_used_at column (backfilled from updated_at)');
          }
        } catch (luErr) {
          console.warn('Migration warning for device_tokens last_used_at column:', luErr.message);
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
   *
   * FCM tokens identify a device/app install, not an account. Before upserting,
   * any rows for the same token owned by *other* users are deleted so an
   * account switch on the same phone cannot leave the token subscribed to
   * multiple users (which would leak push payloads across accounts).
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
      // Reclaim token from any other account first (UNIQUE is per-user today).
      await this.query(
        'DELETE FROM device_tokens WHERE device_token = ? AND user_id <> ?',
        [deviceToken, userId]
      );

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

      // Single atomic upsert — no race between check and write.
      // last_used_at is set on registration (device is actively being used) and on push success.
      await this.query(`
        INSERT INTO device_tokens (id, user_id, device_token, platform, created_at, updated_at, last_used_at)
        VALUES (?, ?, ?, ?, NOW(), NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          platform = VALUES(platform),
          last_used_at = NOW()
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
        `SELECT id, user_id, platform, created_at, updated_at, last_used_at
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
   * Server-side variant that DOES include the raw device_token string.
   * For use by PushNotificationService only — never expose this output to
   * HTTP clients. The HTTP-facing getUserDeviceTokens deliberately omits
   * the token string so it can never leak through the API surface.
   */
  async getUserDeviceTokensWithStrings(userId) {
    try {
      return await this.query(
        `SELECT id, user_id, device_token, platform, created_at, updated_at, last_used_at
         FROM device_tokens
         WHERE user_id = ?
         ORDER BY updated_at DESC, created_at DESC`,
        [userId]
      );
    } catch (err) {
      throw new Error('Failed to fetch user device tokens (with strings)');
    }
  }

  /**
   * Server-side bulk variant: returns rows for many users in one query.
   * Returns an empty array for an empty userIds list. For internal push
   * fan-out only — never expose token strings to HTTP clients.
   */
  async getDeviceTokensForUsers(userIds) {
    if (!Array.isArray(userIds) || userIds.length === 0) return [];
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return [];

    const placeholders = unique.map(() => '?').join(',');
    try {
      return await this.query(
        `SELECT id, user_id, device_token, platform, created_at, updated_at, last_used_at
         FROM device_tokens
         WHERE user_id IN (${placeholders})
         ORDER BY updated_at DESC, created_at DESC`,
        unique
      );
    } catch (err) {
      throw new Error('Failed to fetch device tokens for users');
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

  /**
   * Remove ALL rows for a given raw device_token string (regardless of user).
   * Used by PushNotificationService when FCM reports a token as
   * unregistered/invalid so we can prune it before the next send.
   * Returns the number of rows deleted.
   */
  async removeDeviceTokenByString(deviceToken) {
    if (typeof deviceToken !== 'string' || deviceToken.length === 0) return 0;
    try {
      const result = await this.query(
        'DELETE FROM device_tokens WHERE device_token = ?',
        [deviceToken]
      );
      return result.affectedRows || 0;
    } catch (err) {
      throw new Error('Failed to remove device token by string');
    }
  }

  /**
   * Mark one or more device tokens as recently used (updates last_used_at = NOW()).
   * Used by PushNotificationService after successful deliveries so cleanup
   * doesn't evict tokens that are demonstrably still working.
   * Silently ignores tokens that no longer exist.
   */
  async markDeviceTokensUsed(deviceTokens) {
    if (!Array.isArray(deviceTokens) || deviceTokens.length === 0) return 0;
    const unique = [...new Set(deviceTokens.filter(t => typeof t === 'string' && t.length > 0))];
    if (unique.length === 0) return 0;

    const placeholders = unique.map(() => '?').join(',');
    try {
      const result = await this.query(
        `UPDATE device_tokens SET last_used_at = NOW() WHERE device_token IN (${placeholders})`,
        unique
      );
      return result.affectedRows || 0;
    } catch (err) {
      // Non-fatal — last_used_at is best-effort hygiene, not critical path
      console.warn('Failed to mark device tokens used:', err.message);
      return 0;
    }
  }

  async cleanupOldTokens(daysOld = 180) {
    try {
      const result = await this.query(`
        DELETE FROM device_tokens
        WHERE COALESCE(last_used_at, updated_at) < DATE_SUB(NOW(), INTERVAL ? DAY)
      `, [daysOld]);
      return result.affectedRows;
    } catch (err) {
      throw new Error('Failed to cleanup old device tokens');
    }
  }
}

module.exports = DeviceToken;
