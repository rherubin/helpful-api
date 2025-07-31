const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

class User {
  constructor(db) {
    this.db = db;
  }

  // Initialize database tables
  initDatabase() {
    const createUsersTable = `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        pairing_code TEXT UNIQUE NOT NULL,
        max_pairings INTEGER DEFAULT 1,
        deleted_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    return new Promise((resolve, reject) => {
      this.db.run(createUsersTable, (err) => {
        if (err) {
          console.error('Error creating users table:', err.message);
          reject(err);
        } else {
          console.log('Users table initialized successfully.');
          // Add deleted_at column if it doesn't exist (for existing databases)
          this.db.run("ALTER TABLE users ADD COLUMN deleted_at DATETIME DEFAULT NULL", (alterErr) => {
            // Ignore error if column already exists
            if (alterErr && !alterErr.message.includes('duplicate column name')) {
              console.error('Error adding deleted_at column:', alterErr.message);
            }
            resolve();
          });
        }
      });
    });
  }

  // Generate pairing code (6 digit alpha string)
  generatePairingCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return Array.from({length: 6}, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
  }

  // Generate unique ID
  generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Password validation function
  validatePassword(password) {
    if (password.length !== 8) {
      return { valid: false, error: 'Password must be exactly 8 characters long' };
    }
    
    const hasNumber = /\d/.test(password);
    const hasSymbol = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    const hasCapital = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    
    if (!hasNumber) {
      return { valid: false, error: 'Password must contain at least one number' };
    }
    if (!hasSymbol) {
      return { valid: false, error: 'Password must contain at least one symbol' };
    }
    if (!hasCapital) {
      return { valid: false, error: 'Password must contain at least one capital letter' };
    }
    if (!hasLowercase) {
      return { valid: false, error: 'Password must contain at least one lowercase letter' };
    }
    
    return { valid: true };
  }

  // Create a new user
  async createUser(userData) {
    const { email, first_name, last_name, password } = userData;
    const max_pairings = 1; // Always set to 1 - constraint enforced
    
    // Validate password
    const passwordValidation = this.validatePassword(password);
    if (!passwordValidation.valid) {
      throw new Error(passwordValidation.error);
    }

    const userId = this.generateUniqueId();
    const pairingCode = this.generatePairingCode();

    return new Promise((resolve, reject) => {
      // Hash the password
      bcrypt.hash(password, 10, (err, hash) => {
        if (err) {
          reject(new Error('Failed to hash password'));
          return;
        }

        const insertUser = `
          INSERT INTO users (id, email, first_name, last_name, password_hash, pairing_code, max_pairings, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `;

        const userModel = this;
        this.db.run(insertUser, [userId, email, first_name, last_name, hash, pairingCode, max_pairings], function(err) {
          if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
              if (err.message.includes('email')) {
                reject(new Error('Email already exists'));
              } else if (err.message.includes('pairing_code')) {
                // Retry with a new pairing code
                const newPairingCode = userModel.generatePairingCode();
                userModel.db.run(insertUser, [userId, email, first_name, last_name, hash, newPairingCode, max_pairings], function(retryErr) {
                  if (retryErr) {
                    reject(new Error('Failed to create user'));
                  } else {
                    resolve({
                      id: userId,
                      email,
                      first_name,
                      last_name,
                      pairing_code: newPairingCode,
                      max_pairings: max_pairings,
                      created_at: new Date().toISOString()
                    });
                  }
                });
              }
            } else {
              reject(new Error('Failed to create user'));
            }
            return;
          }

          resolve({
            id: userId,
            email,
            first_name,
            last_name,
            pairing_code: pairingCode,
            max_pairings: max_pairings,
            created_at: new Date().toISOString()
          });
        });
      });
    });
  }

  // Get all users (excluding soft deleted)
  async getAllUsers() {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC';
      
      this.db.all(query, [], (err, rows) => {
        if (err) {
          reject(new Error('Failed to fetch users'));
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Get user by ID (excluding soft deleted)
  async getUserById(id) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [id], (err, row) => {
        if (err) {
          reject(new Error('Failed to fetch user'));
        } else if (!row) {
          reject(new Error('User not found'));
        } else {
          resolve(row);
        }
      });
    });
  }

  // Get user by email (excluding soft deleted)
  async getUserByEmail(email) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL', [email], (err, row) => {
        if (err) {
          reject(new Error('Failed to fetch user'));
        } else if (!row) {
          reject(new Error('User not found'));
        } else {
          resolve(row);
        }
      });
    });
  }

  // Get user by pairing code (excluding soft deleted)
  async getUserByPairingCode(pairingCode) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM users WHERE pairing_code = ? AND deleted_at IS NULL', [pairingCode], (err, row) => {
        if (err) {
          reject(new Error('Failed to fetch user'));
        } else if (!row) {
          reject(new Error('User not found'));
        } else {
          resolve(row);
        }
      });
    });
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

    return new Promise((resolve, reject) => {
      const userModel = this;
      this.db.run(updateQuery, updateValues, function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed') && err.message.includes('email')) {
            reject(new Error('Email already exists'));
          } else {
            reject(new Error('Failed to update user'));
          }
        } else {
          // Get updated user data
          userModel.getUserById(id).then(resolve).catch(reject);
        }
      });
    });
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

        await new Promise((userResolve, userReject) => {
          this.db.run(updateUserQuery, [id], function(err) {
            if (err) {
              userReject(new Error('Failed to delete user'));
            } else if (this.changes === 0) {
              userReject(new Error('User not found or already deleted'));
            } else {
              userResolve();
            }
          });
        });

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
    return new Promise((resolve, reject) => {
      const updateQuery = `
        UPDATE users 
        SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ? AND deleted_at IS NOT NULL
      `;

      this.db.run(updateQuery, [id], function(err) {
        if (err) {
          reject(new Error('Failed to restore user'));
        } else if (this.changes === 0) {
          reject(new Error('User not found or not deleted'));
        } else {
          resolve({ message: 'User restored successfully' });
        }
      });
    });
  }

  // Get user by ID including soft deleted (for admin purposes)
  async getUserByIdIncludingDeleted(id) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
        if (err) {
          reject(new Error('Failed to fetch user'));
        } else if (!row) {
          reject(new Error('User not found'));
        } else {
          resolve(row);
        }
      });
    });
  }

  // Get all soft deleted users
  async getDeletedUsers() {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM users WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC';
      
      this.db.all(query, [], (err, rows) => {
        if (err) {
          reject(new Error('Failed to fetch deleted users'));
        } else {
          resolve(rows);
        }
      });
    });
  }
}

module.exports = User; 