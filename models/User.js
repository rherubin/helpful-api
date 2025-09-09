const bcrypt = require('bcrypt');

class User {
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

  allAsync(query, params = []) {
    return new Promise((resolve, reject) => {
      try {
        const stmt = this.db.prepare(query);
        const result = stmt.all(params);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  }

  // Initialize database tables
  async initDatabase() {
    const createUsersTable = `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        first_name TEXT,
        last_name TEXT,
        password_hash TEXT NOT NULL,
        max_pairings INTEGER DEFAULT 1,
        deleted_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    try {
      await this.runAsync(createUsersTable);
      console.log('Users table initialized successfully.');
      
      // Add deleted_at column if it doesn't exist (for existing databases)
      try {
        await this.runAsync("ALTER TABLE users ADD COLUMN deleted_at DATETIME DEFAULT NULL");
      } catch (alterErr) {
        // Ignore error if column already exists
        if (!alterErr.message.includes('duplicate column name')) {
          console.error('Error adding deleted_at column:', alterErr.message);
        }
      }

      // Migrate first_name/last_name to be nullable if existing DB has NOT NULL constraint
      try {
        const columns = await this.allAsync('PRAGMA table_info(users)');
        const firstNameCol = columns.find(c => c.name === 'first_name');
        const lastNameCol = columns.find(c => c.name === 'last_name');
        const needsMigration = (firstNameCol && firstNameCol.notnull === 1) || (lastNameCol && lastNameCol.notnull === 1);
        if (needsMigration) {
          await this.runAsync('BEGIN');
          const createUsersTableNullable = `
            CREATE TABLE users_new (
              id TEXT PRIMARY KEY,
              email TEXT UNIQUE NOT NULL,
              first_name TEXT,
              last_name TEXT,
              password_hash TEXT NOT NULL,
              max_pairings INTEGER DEFAULT 1,
              deleted_at DATETIME DEFAULT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          `;
          await this.runAsync(createUsersTableNullable);
          await this.runAsync(`
            INSERT INTO users_new (id, email, first_name, last_name, password_hash, max_pairings, deleted_at, created_at, updated_at)
            SELECT id, email, first_name, last_name, password_hash, max_pairings, deleted_at, created_at, updated_at FROM users
          `);
          await this.runAsync('DROP TABLE users');
          await this.runAsync('ALTER TABLE users_new RENAME TO users');
          await this.runAsync('COMMIT');
          console.log('Migrated users table to allow NULL first_name and last_name.');
        }
      } catch (migErr) {
        try { await this.runAsync('ROLLBACK'); } catch (_) {}
        console.warn('Migration check/operation failed (first_name/last_name nullability). Proceeding:', migErr.message);
      }

      // Remove pairing_code column if it exists (migration)
      try {
        const checkQuery = "PRAGMA table_info(users)";
        const columns = await this.allAsync(checkQuery);
        const pairingCodeColumn = columns.find(col => col.name === 'pairing_code');
        
        if (pairingCodeColumn) {
          // Need to migrate - recreate table without pairing_code
          await this.runAsync('BEGIN');
          
          const createNewTable = `
            CREATE TABLE users_new (
              id TEXT PRIMARY KEY,
              email TEXT UNIQUE NOT NULL,
              first_name TEXT,
              last_name TEXT,
              password_hash TEXT NOT NULL,
              max_pairings INTEGER DEFAULT 1,
              deleted_at DATETIME DEFAULT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          `;
          
          await this.runAsync(createNewTable);
          
          // Copy existing data (excluding pairing_code)
          await this.runAsync(`
            INSERT INTO users_new (id, email, first_name, last_name, password_hash, max_pairings, deleted_at, created_at, updated_at)
            SELECT id, email, first_name, last_name, password_hash, max_pairings, deleted_at, created_at, updated_at FROM users
          `);
          
          await this.runAsync('DROP TABLE users');
          await this.runAsync('ALTER TABLE users_new RENAME TO users');
          await this.runAsync('COMMIT');
          
          console.log('Migrated users table to remove pairing_code column.');
        }
      } catch (migErr) {
        try { await this.runAsync('ROLLBACK'); } catch (_) {}
        console.warn('Migration check/operation failed (pairing_code removal). Proceeding:', migErr.message);
      }
    } catch (err) {
      console.error('Error creating users table:', err.message);
      throw err;
    }
  }



  // Generate unique ID
  generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Password validation function (back to 8 chars for easier account creation)
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
    const { email, first_name = null, last_name = null, password } = userData;
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
      INSERT INTO users (id, email, first_name, last_name, password_hash, max_pairings, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;

    try {
      await this.runAsync(insertUser, [userId, email, first_name, last_name, hash, max_pairings]);
      
      return {
        id: userId,
        email,
        first_name,
        last_name,
        max_pairings: max_pairings,
        created_at: new Date().toISOString()
      };
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        if (err.message.includes('email')) {
          throw new Error('Email already exists');
        } else {
          throw new Error('Failed to create user');
        }
      } else {
        throw new Error('Failed to create user');
      }
    }
  }

  // Get user by ID (excluding soft deleted)
  async getUserById(id) {
    try {
      const row = await this.getAsync('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [id]);
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
      const row = await this.getAsync('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL', [email]);
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
    const { first_name, last_name, email, max_pairings } = updateData;

    // Build update query dynamically
    const updateFields = [];
    const updateValues = [];
    
    if (first_name) {
      updateFields.push('first_name = ?');
      updateValues.push(first_name);
    }
    if (last_name) {
      updateFields.push('last_name = ?');
      updateValues.push(last_name);
    }
    if (email) {
      updateFields.push('email = ?');
      updateValues.push(email);
    }
    if (max_pairings !== undefined) {
      updateFields.push('max_pairings = ?');
      updateValues.push(max_pairings);
    }
    
    // Always update the updated_at timestamp
    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    
    const updateQuery = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
    updateValues.push(id);

    try {
      const result = await this.runAsync(updateQuery, updateValues);
      if (result.changes === 0) {
        throw new Error('User not found');
      }
      // Get updated user data
      return await this.getUserById(id);
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed') && err.message.includes('email')) {
        throw new Error('Email already exists');
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
    return new Promise(async (resolve, reject) => {
      try {
        // First, soft delete the user
        const updateUserQuery = `
          UPDATE users 
          SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
          WHERE id = ? AND deleted_at IS NULL
        `;

        const result = await this.runAsync(updateUserQuery, [id]);
        if (result.changes === 0) {
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

        resolve({ 
          message: 'User deleted successfully', 
          deleted_at: new Date().toISOString(),
          cascade_result: pairingResult
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  // Restore a soft deleted user
  async restoreUser(id) {
    try {
      const updateQuery = `
        UPDATE users 
        SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ? AND deleted_at IS NOT NULL
      `;

      const result = await this.runAsync(updateQuery, [id]);
      if (result.changes === 0) {
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
      const row = await this.getAsync('SELECT * FROM users WHERE id = ?', [id]);
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
      const rows = await this.allAsync(query);
      return rows;
    } catch (err) {
      throw new Error('Failed to fetch deleted users');
    }
  }
}

module.exports = User; 