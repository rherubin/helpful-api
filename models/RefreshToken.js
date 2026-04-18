const bcrypt = require('bcrypt');
const crypto = require('crypto');

class RefreshToken {
  constructor(db) {
    this.db = db; // MySQL pool
  }

  // JWT refresh tokens are well over bcrypt's 72-byte input limit, which causes
  // bcrypt to silently compare only the common prefix and accept rotated tokens
  // as valid. Pre-hashing with SHA-256 collapses the token to a fixed-size
  // high-entropy digest that stays inside bcrypt's limits.
  _condenseForBcrypt(token) {
    return crypto.createHash('sha256').update(String(token)).digest('base64');
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

  // Initialize database tables
  async initDatabase() {
    const createRefreshTokensTable = `
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        user_type ENUM('user', 'admin') DEFAULT 'user',
        token VARCHAR(500) UNIQUE NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_user_type (user_type),
        INDEX idx_token (token),
        INDEX idx_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    try {
      await this.query(createRefreshTokensTable);
      console.log('Refresh tokens table initialized successfully.');

      // Migration: Add user_type column and drop old foreign key if it exists
      try {
        // Drop old foreign key constraint if it exists (references users table)
        try {
          await this.query('ALTER TABLE refresh_tokens DROP FOREIGN KEY refresh_tokens_ibfk_1');
          console.log('Dropped old foreign key constraint from refresh_tokens');
        } catch (fkErr) {
          // Constraint might not exist, continue
        }

        // Check if user_type column exists
        const columnExists = await this.queryOne(`
          SELECT COLUMN_NAME
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'refresh_tokens'
            AND COLUMN_NAME = 'user_type'
        `);

        if (!columnExists) {
          await this.query(`
            ALTER TABLE refresh_tokens
            ADD COLUMN user_type ENUM('user', 'admin') DEFAULT 'user'
          `);
          await this.query('ALTER TABLE refresh_tokens ADD INDEX idx_user_type (user_type)');
          console.log('Migrated refresh_tokens table: added user_type column');
        } else {
          console.log('Refresh tokens table already has user_type column');
        }
      } catch (migrationErr) {
        console.warn('Migration warning for refresh_tokens table:', migrationErr.message);
      }
    } catch (err) {
      console.error('Error creating refresh_tokens table:', err.message);
      throw err;
    }
  }

  // Generate unique ID
  generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Hash a token for secure storage
  async hashToken(token) {
    try {
      return await bcrypt.hash(this._condenseForBcrypt(token), 12);
    } catch (err) {
      throw new Error('Failed to hash refresh token');
    }
  }

  // Verify a token against its hash. Falls back to raw comparison to keep
  // tokens minted before the SHA-256 pre-hash change working until users
  // naturally rotate them.
  async verifyToken(token, hashedToken) {
    try {
      const condensed = this._condenseForBcrypt(token);
      if (await bcrypt.compare(condensed, hashedToken)) {
        return true;
      }
      return await bcrypt.compare(String(token), hashedToken);
    } catch (err) {
      return false;
    }
  }

  // Create refresh token
  async createRefreshToken(userId, token, expiresAt, userType = 'user') {
    const tokenId = this.generateUniqueId();

    try {
      // Hash the token for secure storage
      const hashedToken = await this.hashToken(token);

      const insertToken = `
        INSERT INTO refresh_tokens (id, user_id, user_type, token, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `;

      await this.query(insertToken, [tokenId, userId, userType, hashedToken, expiresAt]);
      return tokenId;
    } catch (err) {
      console.error('Error creating refresh token:', err);
      throw new Error('Failed to create refresh token');
    }
  }

  // Get refresh token by token value.
  // When userId is provided, the scan is scoped to that user (O(1) in practice
  // since each user has at most one refresh token). Without userId we fall back
  // to the legacy full-table scan.
  async getRefreshToken(token, userId = null) {
    try {
      const rows = userId
        ? await this.query(
            'SELECT * FROM refresh_tokens WHERE user_id = ? AND expires_at > NOW()',
            [userId]
          )
        : await this.query(
            'SELECT * FROM refresh_tokens WHERE expires_at > NOW()'
          );

      for (const row of rows) {
        const isValid = await this.verifyToken(token, row.token);
        if (isValid) {
          return row;
        }
      }

      throw new Error('Refresh token not found or expired');
    } catch (err) {
      if (err.message === 'Refresh token not found or expired') {
        throw err;
      }
      throw new Error('Failed to fetch refresh token');
    }
  }

  // Delete refresh token (logout). Accepts an optional userId to scope the scan.
  async deleteRefreshToken(token, userId = null) {
    try {
      const rows = userId
        ? await this.query(
            'SELECT id, token FROM refresh_tokens WHERE user_id = ? AND expires_at > NOW()',
            [userId]
          )
        : await this.query(
            'SELECT id, token FROM refresh_tokens WHERE expires_at > NOW()'
          );

      for (const row of rows) {
        const isValid = await this.verifyToken(token, row.token);
        if (isValid) {
          const result = await this.query('DELETE FROM refresh_tokens WHERE id = ?', [row.id]);
          return result.affectedRows > 0;
        }
      }

      return false;
    } catch (err) {
      throw new Error('Failed to delete refresh token');
    }
  }

  // Get refresh token by user ID and type
  async getTokenByUserId(userId, userType = 'user') {
    try {
      const row = await this.queryOne(
        'SELECT * FROM refresh_tokens WHERE user_id = ? AND user_type = ? AND expires_at > NOW()',
        [userId, userType]
      );
      return row;
    } catch (err) {
      throw new Error('Failed to get refresh token for user');
    }
  }

  // Delete all refresh tokens for a user by type
  async deleteRefreshTokensByUserId(userId, userType = 'user') {
    try {
      const result = await this.query('DELETE FROM refresh_tokens WHERE user_id = ? AND user_type = ?', [userId, userType]);
      return result.affectedRows > 0;
    } catch (err) {
      throw new Error('Failed to delete refresh tokens for user');
    }
  }

  // Update refresh token (for rotation). Accepts an optional userId to scope the scan.
  async updateRefreshToken(oldToken, newToken, expiresAt, userId = null) {
    try {
      const rows = userId
        ? await this.query(
            'SELECT id, token FROM refresh_tokens WHERE user_id = ? AND expires_at > NOW()',
            [userId]
          )
        : await this.query(
            'SELECT id, token FROM refresh_tokens WHERE expires_at > NOW()'
          );

      // Find the token that matches the old token by comparing hashes
      for (const row of rows) {
        const isValid = await this.verifyToken(oldToken, row.token);
        if (isValid) {
          // Hash the new token
          const hashedNewToken = await this.hashToken(newToken);

          // Update with the new hashed token
          const result = await this.query(
            'UPDATE refresh_tokens SET token = ?, expires_at = ? WHERE id = ?',
            [hashedNewToken, expiresAt, row.id]
          );
          if (result.affectedRows === 0) {
            throw new Error('Refresh token not found');
          }
          return true;
        }
      }

      throw new Error('Refresh token not found');
    } catch (err) {
      if (err.message === 'Refresh token not found') {
        throw err;
      }
      throw new Error('Failed to update refresh token');
    }
  }

  // Reset refresh token expiration to 14 days from now for a user
  async resetRefreshTokenExpiration(userId) {
    try {
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days from now
      const result = await this.query(
        'UPDATE refresh_tokens SET expires_at = ? WHERE user_id = ? AND expires_at > NOW()',
        [expiresAt, userId]
      );
      return result.affectedRows > 0;
    } catch (err) {
      throw new Error('Failed to reset refresh token expiration');
    }
  }

  // Clean up expired tokens
  async cleanupExpiredTokens() {
    try {
      await this.query('DELETE FROM refresh_tokens WHERE expires_at <= NOW()');
    } catch (err) {
      throw new Error('Failed to cleanup expired tokens');
    }
  }
}

module.exports = RefreshToken;
