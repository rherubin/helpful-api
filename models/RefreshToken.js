class RefreshToken {
  constructor(db) {
    this.db = db;
  }

  // Helper method to promisify better-sqlite3 operations for compatibility
  runAsync(query, params = []) {
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare(query);
        const result = stmt.run(params);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  }

  getAsync(query, params = []) {
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare(query);
        const result = stmt.get(params);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  }

  // Initialize database tables
  async initDatabase() {
    const createRefreshTokensTable = `
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `;

    try {
      await this.runAsync(createRefreshTokensTable);
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

  // Create refresh token
  async createRefreshToken(userId, token, expiresAt) {
    const tokenId = this.generateUniqueId();

    try {
      const insertToken = `
        INSERT INTO refresh_tokens (id, user_id, token, expires_at)
        VALUES (?, ?, ?, ?)
      `;

      await this.runAsync(insertToken, [tokenId, userId, token, expiresAt.toISOString()]);
      return tokenId;
    } catch (err) {
      throw new Error('Failed to create refresh token');
    }
  }

  // Get refresh token by token value
  async getRefreshToken(token) {
    try {
      const row = await this.getAsync("SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > datetime('now')", [token]);
      if (!row) {
        throw new Error('Refresh token not found or expired');
      }
      return row;
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
      const result = await this.runAsync('DELETE FROM refresh_tokens WHERE token = ?', [token]);
      return result.changes > 0;
    } catch (err) {
      throw new Error('Failed to delete refresh token');
    }
  }

  // Delete all refresh tokens for a user
  async deleteRefreshTokensByUserId(userId) {
    try {
      const result = await this.runAsync('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
      return result.changes > 0;
    } catch (err) {
      throw new Error('Failed to delete refresh tokens for user');
    }
  }

  // Clean up expired tokens
  async cleanupExpiredTokens() {
    try {
      await this.runAsync('DELETE FROM refresh_tokens WHERE expires_at <= datetime("now")');
    } catch (err) {
      throw new Error('Failed to cleanup expired tokens');
    }
  }
}

module.exports = RefreshToken; 