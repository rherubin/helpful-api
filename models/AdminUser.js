const bcrypt = require('bcrypt');

class AdminUser {
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

  async query(sql, params = []) {
    const [results] = await this.db.execute(sql, params);
    return results;
  }

  async queryOne(sql, params = []) {
    const [results] = await this.db.execute(sql, params);
    return results[0] || null;
  }

  async initDatabase() {
    const createAdminUsersTable = `
      CREATE TABLE IF NOT EXISTS admin_users (
        id VARCHAR(50) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        user_name VARCHAR(255) DEFAULT NULL,
        partner_name VARCHAR(255) DEFAULT NULL,
        children INT DEFAULT NULL,
        max_pairings INT DEFAULT 1,
        deleted_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_deleted_at (deleted_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    try {
      await this.query(createAdminUsersTable);
      console.log('AdminUsers table initialized successfully.');
    } catch (err) {
      console.error('Error creating admin_users table:', err.message);
      throw err;
    }
  }

  generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Password validation function
  validatePassword(password) {
    // Minimum 8 characters for balance of security and usability
    if (password.length < 8) {
      return { valid: false, error: 'Password must be at least 8 characters long' };
    }

    // Maximum length to prevent DoS attacks
    if (password.length > 128) {
      return { valid: false, error: 'Password must not exceed 128 characters' };
    }

    const hasNumber = /\d/.test(password);
    const hasSymbol = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    const hasCapital = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);

    if (!hasNumber) {
      return { valid: false, error: 'Password must contain at least one number' };
    }
    if (!hasSymbol) {
      return { valid: false, error: 'Password must contain at least one symbol (!@#$%^&*()_+-=[]{};\':"|,.<>/?)' };
    }
    if (!hasCapital) {
      return { valid: false, error: 'Password must contain at least one capital letter' };
    }
    if (!hasLowercase) {
      return { valid: false, error: 'Password must contain at least one lowercase letter' };
    }

    // Check for common weak patterns
    const commonPatterns = [
      /(.)\1{2,}/, // 3+ repeated characters
      /123456|654321/, // Sequential numbers
      /password|admin|login|user/i, // Common words
      /qwerty|asdf|zxcv/i // Keyboard patterns
    ];

    for (const pattern of commonPatterns) {
      if (pattern.test(password)) {
        return { valid: false, error: 'Password contains weak patterns. Avoid repeated characters, sequences, or common words' };
      }
    }

    return { valid: true };
  }

  // Create a new admin user
  async createAdminUser(userData) {
    const { email, password } = userData;

    // Validate password
    const passwordValidation = this.validatePassword(password);
    if (!passwordValidation.valid) {
      throw new Error(passwordValidation.error);
    }

    const userId = this.generateUniqueId();

    // Hash the password
    const hash = await new Promise((resolve, reject) => {
      bcrypt.hash(password, 10, (err, hash) => {
        if (err) {
          reject(new Error('Failed to hash password'));
        } else {
          resolve(hash);
        }
      });
    });

    const insertUser = `
      INSERT INTO admin_users (id, email, password_hash, max_pairings, created_at, updated_at)
      VALUES (?, ?, ?, ?, NOW(), NOW())
    `;

    try {
      await this.query(insertUser, [userId, email, hash, 1]);

      return {
        id: userId,
        email,
        max_pairings: 1,
        created_at: new Date().toISOString()
      };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw new Error('Email already exists');
      } else {
        console.error('Database error:', err);
        throw new Error('Failed to create admin user');
      }
    }
  }

  // Get admin user by ID (excluding soft deleted)
  async getAdminUserById(id) {
    try {
      const row = await this.queryOne('SELECT * FROM admin_users WHERE id = ? AND deleted_at IS NULL', [id]);
      if (!row) {
        throw new Error('Admin user not found');
      }
      return row;
    } catch (err) {
      if (err.message === 'Admin user not found') {
        throw err;
      }
      throw new Error('Failed to fetch admin user');
    }
  }

  // Get admin user by email (excluding soft deleted)
  async getAdminUserByEmail(email) {
    try {
      const row = await this.queryOne('SELECT * FROM admin_users WHERE email = ? AND deleted_at IS NULL', [email]);
      if (!row) {
        throw new Error('Admin user not found');
      }
      return row;
    } catch (err) {
      if (err.message === 'Admin user not found') {
        throw err;
      }
      throw new Error('Failed to fetch admin user');
    }
  }

  // Update admin user
  async updateAdminUser(id, updateData) {
    const { email, max_pairings, user_name, partner_name, children } = updateData;

    // Build update query dynamically
    const updateFields = [];
    const updateValues = [];

    if (email) {
      updateFields.push('email = ?');
      updateValues.push(email);
    }
    if (max_pairings !== undefined) {
      updateFields.push('max_pairings = ?');
      updateValues.push(max_pairings);
    }
    if (user_name !== undefined) {
      updateFields.push('user_name = ?');
      updateValues.push(user_name);
    }
    if (partner_name !== undefined) {
      updateFields.push('partner_name = ?');
      updateValues.push(partner_name);
    }
    if (children !== undefined) {
      // Validate children is a number if provided
      if (children !== null && (!Number.isInteger(children) || children < 0)) {
        throw new Error('Children must be a non-negative integer');
      }
      updateFields.push('children = ?');
      updateValues.push(children);
    }

    // Check if at least one field is being updated
    if (updateFields.length === 0) {
      throw new Error('At least one field must be provided for update');
    }

    // updated_at is automatically handled by ON UPDATE CURRENT_TIMESTAMP

    const updateQuery = `UPDATE admin_users SET ${updateFields.join(', ')} WHERE id = ?`;
    updateValues.push(id);

    try {
      const result = await this.query(updateQuery, updateValues);
      if (result.affectedRows === 0) {
        throw new Error('Admin user not found');
      }
      // Get updated user data
      return await this.getAdminUserById(id);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw new Error('Email already exists');
      } else if (err.message === 'Admin user not found') {
        throw err;
      } else {
        throw new Error('Failed to update admin user');
      }
    }
  }

  // Verify password
  async verifyPassword(user, password) {
    return new Promise((resolve, reject) => {
      bcrypt.compare(password, user.password_hash, (err, isMatch) => {
        if (err) {
          reject(new Error('Failed to verify password'));
        } else {
          resolve(isMatch);
        }
      });
    });
  }

  // Soft delete an admin user
  async softDeleteAdminUser(id) {
    try {
      const updateQuery = `
        UPDATE admin_users
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = ? AND deleted_at IS NULL
      `;

      const result = await this.query(updateQuery, [id]);
      if (result.affectedRows === 0) {
        throw new Error('Admin user not found or already deleted');
      }

      return {
        message: 'Admin user deleted successfully',
        deleted_at: new Date().toISOString()
      };
    } catch (error) {
      throw error;
    }
  }

  // Get admin user by ID including soft deleted (for admin purposes)
  async getAdminUserByIdIncludingDeleted(id) {
    try {
      const row = await this.queryOne('SELECT * FROM admin_users WHERE id = ?', [id]);
      if (!row) {
        throw new Error('Admin user not found');
      }
      return row;
    } catch (err) {
      throw new Error('Failed to fetch admin user');
    }
  }

  // Get all soft deleted admin users
  async getDeletedAdminUsers() {
    try {
      const query = 'SELECT * FROM admin_users WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC';
      const rows = await this.query(query);
      return rows;
    } catch (err) {
      throw new Error('Failed to fetch deleted admin users');
    }
  }
}

module.exports = AdminUser;