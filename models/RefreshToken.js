class RefreshToken {
  constructor(db) {
    this.db = db;
  }

  // Initialize database tables
  initDatabase() {
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

    return new Promise((resolve, reject) => {
      this.db.run(createRefreshTokensTable, (err) => {
        if (err) {
          console.error('Error creating refresh_tokens table:', err.message);
          reject(err);
        } else {
          console.log('Refresh tokens table initialized successfully.');
          resolve();
        }
      });
    });
  }

  // Generate unique ID
  generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Create refresh token
  async createRefreshToken(userId, token, expiresAt) {
    const tokenId = this.generateUniqueId();

    return new Promise((resolve, reject) => {
      const insertToken = `
        INSERT INTO refresh_tokens (id, user_id, token, expires_at)
        VALUES (?, ?, ?, ?)
      `;

      this.db.run(insertToken, [tokenId, userId, token, expiresAt.toISOString()], (err) => {
        if (err) {
          reject(new Error('Failed to create refresh token'));
        } else {
          resolve(tokenId);
        }
      });
    });
  }

  // Get refresh token by token value
  async getRefreshToken(token) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > datetime("now")', [token], (err, row) => {
        if (err) {
          reject(new Error('Failed to fetch refresh token'));
        } else if (!row) {
          reject(new Error('Refresh token not found or expired'));
        } else {
          resolve(row);
        }
      });
    });
  }

  // Delete refresh token (logout)
  async deleteRefreshToken(token) {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM refresh_tokens WHERE token = ?', [token], function(err) {
        if (err) {
          reject(new Error('Failed to delete refresh token'));
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  // Clean up expired tokens
  async cleanupExpiredTokens() {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM refresh_tokens WHERE expires_at <= datetime("now")', (err) => {
        if (err) {
          reject(new Error('Failed to cleanup expired tokens'));
        } else {
          resolve();
        }
      });
    });
  }
}

module.exports = RefreshToken; 