const bcrypt = require('bcrypt');

class User {
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
    const createUsersTable = `
      CREATE TABLE IF NOT EXISTS users (
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
      await this.query(createUsersTable);
      console.log('Users table initialized successfully.');
    } catch (err) {
      console.error('Error creating users table:', err.message);
      throw err;
    }
  }

  // Generate unique ID
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

  // Create a new user
  async createUser(userData) {
    const { email, password } = userData;
    const max_pairings = 1; // Always set to 1 - constraint enforced
    
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
      INSERT INTO users (id, email, password_hash, max_pairings, created_at, updated_at)
      VALUES (?, ?, ?, ?, NOW(), NOW())
    `;

    try {
      await this.query(insertUser, [userId, email, hash, max_pairings]);
      
      return {
        id: userId,
        email,
        max_pairings: max_pairings,
        created_at: new Date().toISOString()
      };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw new Error('Email already exists');
      } else {
        console.error('Database error:', err);
        throw new Error('Failed to create user');
      }
    }
  }

  // Get user by ID (excluding soft deleted)
  async getUserById(id) {
    try {
      const row = await this.queryOne('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [id]);
      if (!row) {
        throw new Error('User not found');
      }
      return row;
    } catch (err) {
      // If it's already a "User not found" error, re-throw it
      if (err.message === 'User not found') {
        throw err;
      }
      // Otherwise, it's a database error
      throw new Error('Failed to fetch user');
    }
  }

  // Get user by email (excluding soft deleted)
  async getUserByEmail(email) {
    try {
      const row = await this.queryOne('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL', [email]);
      if (!row) {
        throw new Error('User not found');
      }
      return row;
    } catch (err) {
      // If it's already a "User not found" error, re-throw it
      if (err.message === 'User not found') {
        throw err;
      }
      // Otherwise, it's a database error
      throw new Error('Failed to fetch user');
    }
  }

  // Update user
  async updateUser(id, updateData) {
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
    
    const updateQuery = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
    updateValues.push(id);

    try {
      const result = await this.query(updateQuery, updateValues);
      if (result.affectedRows === 0) {
        throw new Error('User not found');
      }
      // Get updated user data
      return await this.getUserById(id);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw new Error('Email already exists');
      } else if (err.message === 'User not found') {
        throw err;
      } else {
        throw new Error('Failed to update user');
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

  // Soft delete a user and cascade delete their pairings
  async softDeleteUser(id, pairingModel = null) {
    try {
      // First, soft delete the user
      const updateUserQuery = `
        UPDATE users 
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = ? AND deleted_at IS NULL
      `;

      const result = await this.query(updateUserQuery, [id]);
      if (result.affectedRows === 0) {
        throw new Error('User not found or already deleted');
      }

      // Then, cascade soft delete their pairings if pairingModel is provided
      let pairingResult = null;
      if (pairingModel) {
        try {
          pairingResult = await pairingModel.softDeleteUserPairings(id);
        } catch (pairingError) {
          console.warn('Warning: Failed to cascade delete user pairings:', pairingError.message);
        }
      }

      return { 
        message: 'User deleted successfully', 
        deleted_at: new Date().toISOString(),
        cascade_result: pairingResult
      };
    } catch (error) {
      throw error;
    }
  }

  // Restore a soft deleted user
  async restoreUser(id) {
    try {
      const updateQuery = `
        UPDATE users 
        SET deleted_at = NULL, updated_at = NOW()
        WHERE id = ? AND deleted_at IS NOT NULL
      `;

      const result = await this.query(updateQuery, [id]);
      if (result.affectedRows === 0) {
        throw new Error('User not found or not deleted');
      }
      return { message: 'User restored successfully' };
    } catch (err) {
      throw new Error('Failed to restore user');
    }
  }

  // Get user by ID including soft deleted (for admin purposes)
  async getUserByIdIncludingDeleted(id) {
    try {
      const row = await this.queryOne('SELECT * FROM users WHERE id = ?', [id]);
      if (!row) {
        throw new Error('User not found');
      }
      return row;
    } catch (err) {
      throw new Error('Failed to fetch user');
    }
  }

  // Get all soft deleted users
  async getDeletedUsers() {
    try {
      const query = 'SELECT * FROM users WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC';
      const rows = await this.query(query);
      return rows;
    } catch (err) {
      throw new Error('Failed to fetch deleted users');
    }
  }
}

module.exports = User;
