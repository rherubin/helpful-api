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
          resolve();
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
    const { email, first_name, last_name, password, max_pairings = 1 } = userData;
    
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

  // Get all users
  async getAllUsers() {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM users ORDER BY created_at DESC';
      
      this.db.all(query, [], (err, rows) => {
        if (err) {
          reject(new Error('Failed to fetch users'));
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Get user by ID
  async getUserById(id) {
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

  // Get user by email
  async getUserByEmail(email) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
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

  // Get user by pairing code
  async getUserByPairingCode(pairingCode) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM users WHERE pairing_code = ?', [pairingCode], (err, row) => {
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
}

module.exports = User; 