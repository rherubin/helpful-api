class Pairing {
  constructor(db) {
    this.db = db;
  }

  // Initialize database tables
  initDatabase() {
    const createPairingsTable = `
      CREATE TABLE IF NOT EXISTS pairings (
        id TEXT PRIMARY KEY,
        user1_id TEXT NOT NULL,
        user2_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user1_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (user2_id) REFERENCES users (id) ON DELETE CASCADE,
        UNIQUE(user1_id, user2_id)
      )
    `;

    return new Promise((resolve, reject) => {
      this.db.run(createPairingsTable, (err) => {
        if (err) {
          console.error('Error creating pairings table:', err.message);
          reject(err);
        } else {
          console.log('Pairings table initialized successfully.');
          resolve();
        }
      });
    });
  }

  // Generate unique ID
  generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Create a pairing request
  async createPairing(user1Id, user2Id) {
    const pairingId = this.generateUniqueId();

    return new Promise((resolve, reject) => {
      const insertPairing = `
        INSERT INTO pairings (id, user1_id, user2_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;

      this.db.run(insertPairing, [pairingId, user1Id, user2Id], function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            reject(new Error('Pairing already exists'));
          } else {
            reject(new Error('Failed to create pairing'));
          }
        } else {
          resolve({
            id: pairingId,
            user1_id: user1Id,
            user2_id: user2Id,
            status: 'pending',
            created_at: new Date().toISOString()
          });
        }
      });
    });
  }

  // Accept a pairing request
  async acceptPairing(pairingId) {
    return new Promise((resolve, reject) => {
      const updatePairing = `
        UPDATE pairings 
        SET status = 'accepted', updated_at = CURRENT_TIMESTAMP 
        WHERE id = ? AND status = 'pending'
      `;

      this.db.run(updatePairing, [pairingId], function(err) {
        if (err) {
          reject(new Error('Failed to accept pairing'));
        } else if (this.changes === 0) {
          reject(new Error('Pairing not found or already processed'));
        } else {
          resolve({ message: 'Pairing accepted successfully' });
        }
      });
    });
  }

  // Reject a pairing request
  async rejectPairing(pairingId) {
    return new Promise((resolve, reject) => {
      const updatePairing = `
        UPDATE pairings 
        SET status = 'rejected', updated_at = CURRENT_TIMESTAMP 
        WHERE id = ? AND status = 'pending'
      `;

      this.db.run(updatePairing, [pairingId], function(err) {
        if (err) {
          reject(new Error('Failed to reject pairing'));
        } else if (this.changes === 0) {
          reject(new Error('Pairing not found or already processed'));
        } else {
          resolve({ message: 'Pairing rejected successfully' });
        }
      });
    });
  }

  // Get pairings for a user
  async getUserPairings(userId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT p.*, 
               u1.first_name as user1_first_name, u1.last_name as user1_last_name, u1.email as user1_email,
               u2.first_name as user2_first_name, u2.last_name as user2_last_name, u2.email as user2_email
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id
        JOIN users u2 ON p.user2_id = u2.id
        WHERE p.user1_id = ? OR p.user2_id = ?
        ORDER BY p.created_at DESC
      `;

      this.db.all(query, [userId, userId], (err, rows) => {
        if (err) {
          reject(new Error('Failed to fetch pairings'));
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Get pending pairings for a user
  async getPendingPairings(userId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT p.*, 
               u1.first_name as user1_first_name, u1.last_name as user1_last_name, u1.email as user1_email,
               u2.first_name as user2_first_name, u2.last_name as user2_last_name, u2.email as user2_email
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id
        JOIN users u2 ON p.user2_id = u2.id
        WHERE (p.user1_id = ? OR p.user2_id = ?) AND p.status = 'pending'
        ORDER BY p.created_at DESC
      `;

      this.db.all(query, [userId, userId], (err, rows) => {
        if (err) {
          reject(new Error('Failed to fetch pending pairings'));
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Get accepted pairings for a user
  async getAcceptedPairings(userId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT p.*, 
               u1.first_name as user1_first_name, u1.last_name as user1_last_name, u1.email as user1_email,
               u2.first_name as user2_first_name, u2.last_name as user2_last_name, u2.email as user2_email
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id
        JOIN users u2 ON p.user2_id = u2.id
        WHERE (p.user1_id = ? OR p.user2_id = ?) AND p.status = 'accepted'
        ORDER BY p.created_at DESC
      `;

      this.db.all(query, [userId, userId], (err, rows) => {
        if (err) {
          reject(new Error('Failed to fetch accepted pairings'));
        } else {
          resolve(rows);
        }
      });
    });
  }

  // Check if users are already paired
  async checkExistingPairing(user1Id, user2Id) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM pairings 
        WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)
      `;

      this.db.get(query, [user1Id, user2Id, user2Id, user1Id], (err, row) => {
        if (err) {
          reject(new Error('Failed to check existing pairing'));
        } else {
          resolve(row);
        }
      });
    });
  }

  // Get pairing by ID
  async getPairingById(pairingId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT p.*, 
               u1.first_name as user1_first_name, u1.last_name as user1_last_name, u1.email as user1_email,
               u2.first_name as user2_first_name, u2.last_name as user2_last_name, u2.email as user2_email
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id
        JOIN users u2 ON p.user2_id = u2.id
        WHERE p.id = ?
      `;

      this.db.get(query, [pairingId], (err, row) => {
        if (err) {
          reject(new Error('Failed to fetch pairing'));
        } else if (!row) {
          reject(new Error('Pairing not found'));
        } else {
          resolve(row);
        }
      });
    });
  }

  // Count accepted pairings for a user
  async countAcceptedPairings(userId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT COUNT(*) as count 
        FROM pairings 
        WHERE (user1_id = ? OR user2_id = ?) AND status = 'accepted'
      `;

      this.db.get(query, [userId, userId], (err, row) => {
        if (err) {
          reject(new Error('Failed to count pairings'));
        } else {
          resolve(row.count);
        }
      });
    });
  }
}

module.exports = Pairing; 