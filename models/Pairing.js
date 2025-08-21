class Pairing {
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
    const createPairingsTable = `
      CREATE TABLE IF NOT EXISTS pairings (
        id TEXT PRIMARY KEY,
        user1_id TEXT NOT NULL,
        user2_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        deleted_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user1_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (user2_id) REFERENCES users (id) ON DELETE CASCADE,
        UNIQUE(user1_id, user2_id)
      )
    `;

    try {
      await this.runAsync(createPairingsTable);
      console.log('Pairings table initialized successfully.');
      
      // Add deleted_at column if it doesn't exist (for existing databases)
      try {
        await this.runAsync("ALTER TABLE pairings ADD COLUMN deleted_at DATETIME DEFAULT NULL");
      } catch (alterErr) {
        // Ignore error if column already exists
        if (!alterErr.message.includes('duplicate column name')) {
          console.error('Error adding deleted_at column to pairings:', alterErr.message);
        }
      }
    } catch (err) {
      console.error('Error creating pairings table:', err.message);
      throw err;
    }
  }

  // Generate unique ID
  generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Create a pairing request
  async createPairing(user1Id, user2Id) {
    const pairingId = this.generateUniqueId();

    try {
      const insertPairing = `
        INSERT INTO pairings (id, user1_id, user2_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;

      await this.runAsync(insertPairing, [pairingId, user1Id, user2Id]);
      
      return {
        id: pairingId,
        user1_id: user1Id,
        user2_id: user2Id,
        status: 'pending',
        created_at: new Date().toISOString()
      };
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        throw new Error('Pairing already exists');
      } else {
        throw new Error('Failed to create pairing');
      }
    }
  }

  // Accept a pairing request
  async acceptPairing(pairingId) {
    try {
      const updatePairing = `
        UPDATE pairings 
        SET status = 'accepted', updated_at = CURRENT_TIMESTAMP 
        WHERE id = ? AND status = 'pending'
      `;

      const result = await this.runAsync(updatePairing, [pairingId]);
      if (result.changes === 0) {
        throw new Error('Pairing not found or already processed');
      }
      return { message: 'Pairing accepted successfully' };
    } catch (err) {
      throw new Error('Failed to accept pairing');
    }
  }

  // Reject a pairing request
  async rejectPairing(pairingId) {
    try {
      const updatePairing = `
        UPDATE pairings 
        SET status = 'rejected', updated_at = CURRENT_TIMESTAMP 
        WHERE id = ? AND status = 'pending'
      `;

      const result = await this.runAsync(updatePairing, [pairingId]);
      if (result.changes === 0) {
        throw new Error('Pairing not found or already processed');
      }
      return { message: 'Pairing rejected successfully' };
    } catch (err) {
      throw new Error('Failed to reject pairing');
    }
  }

  // Get pairings for a user (excluding soft deleted)
  async getUserPairings(userId) {
    try {
      const query = `
        SELECT p.*, 
               u1.first_name as user1_first_name, u1.last_name as user1_last_name, u1.email as user1_email,
               u2.first_name as user2_first_name, u2.last_name as user2_last_name, u2.email as user2_email
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id AND u1.deleted_at IS NULL
        JOIN users u2 ON p.user2_id = u2.id AND u2.deleted_at IS NULL
        WHERE (p.user1_id = ? OR p.user2_id = ?) AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC
      `;

      const rows = await this.allAsync(query, [userId, userId]);
      return rows;
    } catch (err) {
      throw new Error('Failed to fetch pairings');
    }
  }

  // Get pending pairings for a user (excluding soft deleted)
  async getPendingPairings(userId) {
    try {
      const query = `
        SELECT p.*, 
               u1.first_name as user1_first_name, u1.last_name as user1_last_name, u1.email as user1_email,
               u2.first_name as user2_first_name, u2.last_name as user2_last_name, u2.email as user2_email
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id AND u1.deleted_at IS NULL
        JOIN users u2 ON p.user2_id = u2.id AND u2.deleted_at IS NULL
        WHERE (p.user1_id = ? OR p.user2_id = ?) AND p.status = 'pending' AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC
      `;

      const rows = await this.allAsync(query, [userId, userId]);
      return rows;
    } catch (err) {
      throw new Error('Failed to fetch pending pairings');
    }
  }

  // Get accepted pairings for a user (excluding soft deleted)
  async getAcceptedPairings(userId) {
    try {
      const query = `
        SELECT p.*, 
               u1.first_name as user1_first_name, u1.last_name as user1_last_name, u1.email as user1_email,
               u2.first_name as user2_first_name, u2.last_name as user2_last_name, u2.email as user2_email
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id AND u1.deleted_at IS NULL
        JOIN users u2 ON p.user2_id = u2.id AND u2.deleted_at IS NULL
        WHERE (p.user1_id = ? OR p.user2_id = ?) AND p.status = 'accepted' AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC
      `;

      const rows = await this.allAsync(query, [userId, userId]);
      return rows;
    } catch (err) {
      throw new Error('Failed to fetch accepted pairings');
    }
  }

  // Check if users are already paired (excluding soft deleted)
  async checkExistingPairing(user1Id, user2Id) {
    try {
      const query = `
        SELECT * FROM pairings 
        WHERE ((user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)) AND deleted_at IS NULL
      `;

      const row = await this.getAsync(query, [user1Id, user2Id, user2Id, user1Id]);
      return row;
    } catch (err) {
      throw new Error('Failed to check existing pairing');
    }
  }

  // Get pairing by ID (excluding soft deleted)
  async getPairingById(pairingId) {
    try {
      const query = `
        SELECT p.*, 
               u1.first_name as user1_first_name, u1.last_name as user1_last_name, u1.email as user1_email,
               u2.first_name as user2_first_name, u2.last_name as user2_last_name, u2.email as user2_email
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id AND u1.deleted_at IS NULL
        JOIN users u2 ON p.user2_id = u2.id AND u2.deleted_at IS NULL
        WHERE p.id = ? AND p.deleted_at IS NULL
      `;

      const row = await this.getAsync(query, [pairingId]);
      if (!row) {
        throw new Error('Pairing not found');
      }
      return row;
    } catch (err) {
      throw new Error('Failed to fetch pairing');
    }
  }

  // Get pending pairing by requester's pairing code (the person who made the request)
  async getPendingPairingByRequesterCode(targetUserId, requesterPairingCode) {
    try {
      const query = `
        SELECT p.*, 
               u1.first_name as user1_first_name, u1.last_name as user1_last_name, u1.email as user1_email, u1.pairing_code as user1_pairing_code,
               u2.first_name as user2_first_name, u2.last_name as user2_last_name, u2.email as user2_email, u2.pairing_code as user2_pairing_code
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id AND u1.deleted_at IS NULL
        JOIN users u2 ON p.user2_id = u2.id AND u2.deleted_at IS NULL
        WHERE p.user2_id = ? AND u1.pairing_code = ? AND p.status = 'pending' AND p.deleted_at IS NULL
      `;

      const row = await this.getAsync(query, [targetUserId, requesterPairingCode]);
      return row; // Returns null if not found, which is fine
    } catch (err) {
      throw new Error('Failed to fetch pairing by requester code');
    }
  }

  // Count accepted pairings for a user (excluding soft deleted)
  async countAcceptedPairings(userId) {
    try {
      const query = `
        SELECT COUNT(*) as count 
        FROM pairings 
        WHERE (user1_id = ? OR user2_id = ?) AND status = 'accepted' AND deleted_at IS NULL
      `;

      const row = await this.getAsync(query, [userId, userId]);
      return row.count;
    } catch (err) {
      throw new Error('Failed to count pairings');
    }
  }

  // Soft delete a pairing
  async softDeletePairing(pairingId) {
    try {
      const updateQuery = `
        UPDATE pairings 
        SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ? AND deleted_at IS NULL
      `;

      const result = await this.runAsync(updateQuery, [pairingId]);
      if (result.changes === 0) {
        throw new Error('Pairing not found or already deleted');
      }
      return { message: 'Pairing deleted successfully', deleted_at: new Date().toISOString() };
    } catch (err) {
      throw new Error('Failed to delete pairing');
    }
  }

  // Soft delete all pairings for a user (cascade delete)
  async softDeleteUserPairings(userId) {
    try {
      const updateQuery = `
        UPDATE pairings 
        SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
        WHERE (user1_id = ? OR user2_id = ?) AND deleted_at IS NULL
      `;

      const result = await this.runAsync(updateQuery, [userId, userId]);
      return { 
        message: 'User pairings deleted successfully', 
        deleted_count: result.changes,
        deleted_at: new Date().toISOString() 
      };
    } catch (err) {
      throw new Error('Failed to delete user pairings');
    }
  }

  // Restore a soft deleted pairing
  async restorePairing(pairingId) {
    try {
      const updateQuery = `
        UPDATE pairings 
        SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ? AND deleted_at IS NOT NULL
      `;

      const result = await this.runAsync(updateQuery, [pairingId]);
      if (result.changes === 0) {
        throw new Error('Pairing not found or not deleted');
      }
      return { message: 'Pairing restored successfully' };
    } catch (err) {
      throw new Error('Failed to restore pairing');
    }
  }

  // Get pairing by ID including soft deleted (for admin purposes)
  async getPairingByIdIncludingDeleted(pairingId) {
    try {
      const query = `
        SELECT p.*, 
               u1.first_name as user1_first_name, u1.last_name as user1_last_name, u1.email as user1_email,
               u2.first_name as user2_first_name, u2.last_name as user2_last_name, u2.email as user2_email
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id
        JOIN users u2 ON p.user2_id = u2.id
        WHERE p.id = ?
      `;

      const row = await this.getAsync(query, [pairingId]);
      if (!row) {
        throw new Error('Pairing not found');
      }
      return row;
    } catch (err) {
      throw new Error('Failed to fetch pairing');
    }
  }

  // Get all soft deleted pairings
  async getDeletedPairings() {
    try {
      const query = `
        SELECT p.*, 
               u1.first_name as user1_first_name, u1.last_name as user1_last_name, u1.email as user1_email,
               u2.first_name as user2_first_name, u2.last_name as user2_last_name, u2.email as user2_email
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id
        JOIN users u2 ON p.user2_id = u2.id
        WHERE p.deleted_at IS NOT NULL 
        ORDER BY p.deleted_at DESC
      `;
      
      const rows = await this.allAsync(query);
      return rows;
    } catch (err) {
      throw new Error('Failed to fetch deleted pairings');
    }
  }
}

module.exports = Pairing;