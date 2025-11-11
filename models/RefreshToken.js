const bcrypt = require('bcrypt');

class RefreshToken {
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

  // Initialize database tables
  async initDatabase() {
    const createRefreshTokensTable = `
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        token VARCHAR(500) UNIQUE NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_token (token),
        INDEX idx_expires_at (expires_at),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    try {
      await this.query(createRefreshTokensTable);
      console.log('Refresh tokens table initialized successfully.');
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
      return await bcrypt.hash(token, 12); // Use cost factor of 12 for security
    } catch (err) {
      throw new Error('Failed to hash refresh token');
    }
  }

  // Verify a token against its hash
  async verifyToken(token, hashedToken) {
    try {
      return await bcrypt.compare(token, hashedToken);
    } catch (err) {
      return false;
    }
  }

  // Create refresh token
  async createRefreshToken(userId, token, expiresAt) {
    const tokenId = this.generateUniqueId();

    try {
      // Hash the token for secure storage
      const hashedToken = await this.hashToken(token);

      const insertToken = `
        INSERT INTO refresh_tokens (id, user_id, token, expires_at)
        VALUES (?, ?, ?, ?)
      `;

      await this.query(insertToken, [tokenId, userId, hashedToken, expiresAt]);
      return tokenId;
    } catch (err) {
      console.error('Error creating refresh token:', err);
      throw new Error('Failed to create refresh token');
    }
  }

  // Get refresh token by token value
  async getRefreshToken(token) {
    try {
      // Get all non-expired tokens and verify against the provided token
      const rows = await this.query(
        "SELECT * FROM refresh_tokens WHERE expires_at > NOW()"
      );

      // Find the token that matches by comparing hashes
      for (const row of rows) {
        const isValid = await this.verifyToken(token, row.token);
        if (isValid) {
          return row;
        }
      }

      throw new Error('Refresh token not found or expired');
    } catch (err) {
      // If it's our specific error message, preserve it
      if (err.message === 'Refresh token not found or expired') {
        throw err;
      }
      // Otherwise, it's a database error
      throw new Error('Failed to fetch refresh token');
    }
  }

  // Delete refresh token (logout)
  async deleteRefreshToken(token) {
    try {
      // Get all non-expired tokens to find the one that matches
      const rows = await this.query(
        "SELECT id, token FROM refresh_tokens WHERE expires_at > NOW()"
      );

      // Find the token that matches by comparing hashes
      for (const row of rows) {
        const isValid = await this.verifyToken(token, row.token);
        if (isValid) {
          // Delete the matching token
          const result = await this.query('DELETE FROM refresh_tokens WHERE id = ?', [row.id]);
          return result.affectedRows > 0;
        }
      }

      return false; // Token not found
    } catch (err) {
      throw new Error('Failed to delete refresh token');
    }
  }

  // Delete all refresh tokens for a user
  async deleteRefreshTokensByUserId(userId) {
    try {
      const result = await this.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
      return result.affectedRows > 0;
    } catch (err) {
      throw new Error('Failed to delete refresh tokens for user');
    }
  }

  // Update refresh token (for rotation)
  async updateRefreshToken(oldToken, newToken, expiresAt) {
    try {
      // Get all non-expired tokens to find the one that matches the old token
      const rows = await this.query(
        "SELECT id, token FROM refresh_tokens WHERE expires_at > NOW()"
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
