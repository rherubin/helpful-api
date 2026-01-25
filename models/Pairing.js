class Pairing {
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
    const createPairingsTable = `
      CREATE TABLE IF NOT EXISTS pairings (
        id VARCHAR(50) PRIMARY KEY,
        user1_id VARCHAR(50) NOT NULL,
        user2_id VARCHAR(50) DEFAULT NULL,
        partner_code VARCHAR(10) DEFAULT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        premium TINYINT(1) NOT NULL DEFAULT 0,
        deleted_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user1_id (user1_id),
        INDEX idx_user2_id (user2_id),
        INDEX idx_partner_code (partner_code),
        INDEX idx_status (status),
        INDEX idx_premium (premium),
        INDEX idx_deleted_at (deleted_at),
        FOREIGN KEY (user1_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (user2_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    try {
      await this.query(createPairingsTable);
      console.log('Pairings table initialized successfully.');
      
      // Migration: Add premium column if it doesn't exist (for existing databases)
      await this.migratePremiumField();
    } catch (err) {
      console.error('Error creating pairings table:', err.message);
      throw err;
    }
  }

  // Migration to add premium field to existing tables
  async migratePremiumField() {
    try {
      const [columns] = await this.db.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'pairings' AND COLUMN_NAME = 'premium'"
      );
      if (columns.length === 0) {
        await this.query('ALTER TABLE pairings ADD COLUMN premium TINYINT(1) NOT NULL DEFAULT 0');
        await this.query('ALTER TABLE pairings ADD INDEX idx_premium (premium)');
        console.log('Added premium column to pairings table.');
      }
    } catch (err) {
      // Column might already exist, ignore
      if (!err.message.includes('Duplicate')) {
        console.warn('Warning during premium migration:', err.message);
      }
    }
  }

  // Generate unique ID
  generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Generate unique partner code (6 characters, alphanumeric)
  generatePartnerCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // Create a pairing request (legacy method for existing pairings)
  async createPairing(user1Id, user2Id) {
    const pairingId = this.generateUniqueId();

    try {
      const insertPairing = `
        INSERT INTO pairings (id, user1_id, user2_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', NOW(), NOW())
      `;

      await this.query(insertPairing, [pairingId, user1Id, user2Id]);
      
      return {
        id: pairingId,
        user1_id: user1Id,
        user2_id: user2Id,
        status: 'pending',
        created_at: new Date().toISOString()
      };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw new Error('Pairing already exists');
      } else {
        throw new Error('Failed to create pairing');
      }
    }
  }

  // Create a pairing request with partner code (new flow)
  async createPairingWithPartnerCode(userId) {
    const pairingId = this.generateUniqueId();
    let partnerCode;
    let attempts = 0;
    const maxAttempts = 10;

    // Generate a unique partner code
    while (attempts < maxAttempts) {
      partnerCode = this.generatePartnerCode();
      
      // Check if this partner code already exists and is active
      try {
        const existingPairing = await this.queryOne(
          "SELECT id FROM pairings WHERE partner_code = ? AND status = 'pending' AND deleted_at IS NULL",
          [partnerCode]
        );
        
        if (!existingPairing) {
          break; // Unique code found
        }
        attempts++;
      } catch (err) {
        attempts++;
      }
    }

    if (attempts >= maxAttempts) {
      throw new Error('Failed to generate unique partner code');
    }

    try {
      const insertPairing = `
        INSERT INTO pairings (id, user1_id, user2_id, partner_code, status, created_at, updated_at)
        VALUES (?, ?, NULL, ?, 'pending', NOW(), NOW())
      `;

      await this.query(insertPairing, [pairingId, userId, partnerCode]);
      
      return {
        id: pairingId,
        user1_id: userId,
        user2_id: null,
        partner_code: partnerCode,
        status: 'pending',
        created_at: new Date().toISOString()
      };
    } catch (err) {
      throw new Error('Failed to create pairing request');
    }
  }

  // Accept a pairing request
  async acceptPairing(pairingId) {
    try {
      const updatePairing = `
        UPDATE pairings 
        SET status = 'accepted', updated_at = NOW()
        WHERE id = ? AND status = 'pending'
      `;

      const result = await this.query(updatePairing, [pairingId]);
      if (result.affectedRows === 0) {
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
        SET status = 'rejected', updated_at = NOW()
        WHERE id = ? AND status = 'pending'
      `;

      const result = await this.query(updatePairing, [pairingId]);
      if (result.affectedRows === 0) {
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
               u1.user_name as user1_user_name, u1.email as user1_email,
               u2.user_name as user2_user_name, u2.email as user2_email
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id AND u1.deleted_at IS NULL
        LEFT JOIN users u2 ON p.user2_id = u2.id AND u2.deleted_at IS NULL
        WHERE (p.user1_id = ? OR p.user2_id = ?) AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC
      `;

      const rows = await this.query(query, [userId, userId]);
      return rows.map(row => {
        row.premium = !!row.premium;
        return row;
      });
    } catch (err) {
      throw new Error('Failed to fetch pairings');
    }
  }

  // Get pending pairings for a user (excluding soft deleted)
  async getPendingPairings(userId) {
    try {
      const query = `
        SELECT p.*, 
               u1.user_name as user1_user_name, u1.email as user1_email,
               u2.user_name as user2_user_name, u2.email as user2_email
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id AND u1.deleted_at IS NULL
        LEFT JOIN users u2 ON p.user2_id = u2.id AND u2.deleted_at IS NULL
        WHERE (p.user1_id = ? OR p.user2_id = ?) AND p.status = 'pending' AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC
      `;

      const rows = await this.query(query, [userId, userId]);
      return rows.map(row => {
        row.premium = !!row.premium;
        return row;
      });
    } catch (err) {
      throw new Error('Failed to fetch pending pairings');
    }
  }

  // Get accepted pairings for a user (excluding soft deleted)
  async getAcceptedPairings(userId) {
    try {
      const query = `
        SELECT p.*, 
               u1.user_name as user1_user_name, u1.email as user1_email,
               u2.user_name as user2_user_name, u2.email as user2_email
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id AND u1.deleted_at IS NULL
        JOIN users u2 ON p.user2_id = u2.id AND u2.deleted_at IS NULL
        WHERE (p.user1_id = ? OR p.user2_id = ?) AND p.status = 'accepted' AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC
      `;

      const rows = await this.query(query, [userId, userId]);
      return rows.map(row => {
        row.premium = !!row.premium;
        return row;
      });
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

      const row = await this.queryOne(query, [user1Id, user2Id, user2Id, user1Id]);
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
               u1.user_name as user1_user_name, u1.email as user1_email,
               u2.user_name as user2_user_name, u2.email as user2_email
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id AND u1.deleted_at IS NULL
        JOIN users u2 ON p.user2_id = u2.id AND u2.deleted_at IS NULL
        WHERE p.id = ? AND p.deleted_at IS NULL
      `;

      const row = await this.queryOne(query, [pairingId]);
      if (!row) {
        throw new Error('Pairing not found');
      }
      row.premium = !!row.premium;
      return row;
    } catch (err) {
      throw new Error('Failed to fetch pairing');
    }
  }

  // Get pending pairing by partner code (new flow)
  async getPendingPairingByPartnerCode(partnerCode) {
    try {
      const query = `
        SELECT p.*, 
               u1.user_name as user1_user_name, u1.email as user1_email
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id AND u1.deleted_at IS NULL
        WHERE p.partner_code = ? AND p.status = 'pending' AND p.deleted_at IS NULL AND p.user2_id IS NULL
      `;

      const row = await this.queryOne(query, [partnerCode]);
      if (row) {
        row.premium = !!row.premium;
      }
      return row; // Returns null if not found, which is fine
    } catch (err) {
      throw new Error('Failed to fetch pairing by partner code');
    }
  }

  // Accept a pairing by partner code (new flow)
  async acceptPairingByPartnerCode(partnerCode, acceptingUserId) {
    try {
      const updatePairing = `
        UPDATE pairings 
        SET user2_id = ?, status = 'accepted', updated_at = NOW()
        WHERE partner_code = ? AND status = 'pending' AND user2_id IS NULL AND deleted_at IS NULL
      `;

      const result = await this.query(updatePairing, [acceptingUserId, partnerCode]);
      if (result.affectedRows === 0) {
        throw new Error('Pairing not found or already processed');
      }
      return { message: 'Pairing accepted successfully' };
    } catch (err) {
      throw new Error('Failed to accept pairing');
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

      const row = await this.queryOne(query, [userId, userId]);
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
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = ? AND deleted_at IS NULL
      `;

      const result = await this.query(updateQuery, [pairingId]);
      if (result.affectedRows === 0) {
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
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE (user1_id = ? OR user2_id = ?) AND deleted_at IS NULL
      `;

      const result = await this.query(updateQuery, [userId, userId]);
      return { 
        message: 'User pairings deleted successfully', 
        deleted_count: result.affectedRows,
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
        SET deleted_at = NULL, updated_at = NOW()
        WHERE id = ? AND deleted_at IS NOT NULL
      `;

      const result = await this.query(updateQuery, [pairingId]);
      if (result.affectedRows === 0) {
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
               u1.user_name as user1_user_name, u1.email as user1_email,
               u2.user_name as user2_user_name, u2.email as user2_email
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id
        JOIN users u2 ON p.user2_id = u2.id
        WHERE p.id = ?
      `;

      const row = await this.queryOne(query, [pairingId]);
      if (!row) {
        throw new Error('Pairing not found');
      }
      row.premium = !!row.premium;
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
               u1.user_name as user1_user_name, u1.email as user1_email,
               u2.user_name as user2_user_name, u2.email as user2_email
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id
        JOIN users u2 ON p.user2_id = u2.id
        WHERE p.deleted_at IS NOT NULL 
        ORDER BY p.deleted_at DESC
      `;
      
      const rows = await this.query(query);
      return rows.map(row => {
        row.premium = !!row.premium;
        return row;
      });
    } catch (err) {
      throw new Error('Failed to fetch deleted pairings');
    }
  }

  // Set premium status for a pairing
  async setPremiumStatus(pairingId, isPremium) {
    try {
      const updateQuery = `
        UPDATE pairings
        SET premium = ?, updated_at = NOW()
        WHERE id = ? AND deleted_at IS NULL
      `;

      const result = await this.query(updateQuery, [isPremium ? 1 : 0, pairingId]);
      if (result.affectedRows === 0) {
        throw new Error('Pairing not found');
      }
      return { id: pairingId, premium: isPremium };
    } catch (err) {
      if (err.message === 'Pairing not found') {
        throw err;
      }
      throw new Error('Failed to update premium status');
    }
  }

  // Get premium status for a pairing
  async getPremiumStatus(pairingId) {
    try {
      const row = await this.queryOne(
        'SELECT premium FROM pairings WHERE id = ? AND deleted_at IS NULL',
        [pairingId]
      );
      if (!row) {
        throw new Error('Pairing not found');
      }
      return !!row.premium;
    } catch (err) {
      if (err.message === 'Pairing not found') {
        throw err;
      }
      throw new Error('Failed to fetch premium status');
    }
  }

  // Check if a user has any premium pairings
  async userHasPremiumPairing(userId) {
    try {
      const row = await this.queryOne(
        `SELECT id FROM pairings
         WHERE (user1_id = ? OR user2_id = ?)
         AND status = 'accepted'
         AND premium = 1
         AND deleted_at IS NULL
         LIMIT 1`,
        [userId, userId]
      );
      return !!row;
    } catch (err) {
      throw new Error('Failed to check premium pairing status');
    }
  }

  // Get accepted pairings for a user with premium status
  async getAcceptedPairingsWithPremium(userId) {
    try {
      const query = `
        SELECT p.*, 
               u1.user_name as user1_user_name, u1.email as user1_email,
               u2.user_name as user2_user_name, u2.email as user2_email
        FROM pairings p
        JOIN users u1 ON p.user1_id = u1.id AND u1.deleted_at IS NULL
        JOIN users u2 ON p.user2_id = u2.id AND u2.deleted_at IS NULL
        WHERE (p.user1_id = ? OR p.user2_id = ?) AND p.status = 'accepted' AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC
      `;

      const rows = await this.query(query, [userId, userId]);
      return rows.map(row => {
        row.premium = !!row.premium;
        return row;
      });
    } catch (err) {
      throw new Error('Failed to fetch accepted pairings');
    }
  }
}

module.exports = Pairing;
