class Program {
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
    const createProgramsTable = `
      CREATE TABLE IF NOT EXISTS programs (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        user_input TEXT NOT NULL,
        pairing_id VARCHAR(50) DEFAULT NULL,
        therapy_response LONGTEXT DEFAULT NULL,
        deleted_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_pairing_id (pairing_id),
        INDEX idx_deleted_at (deleted_at),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (pairing_id) REFERENCES pairings (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    try {
      await this.query(createProgramsTable);
      console.log('Programs table initialized successfully.');
    } catch (err) {
      console.error('Error creating programs table:', err.message);
      throw err;
    }
  }

  // Parse therapy response from JSON string if possible
  parseTherapyResponse(therapyResponse) {
    if (!therapyResponse) return null;
    
    try {
      return JSON.parse(therapyResponse);
    } catch (error) {
      // Return as string if not valid JSON
      return therapyResponse;
    }
  }

  // Generate unique ID
  generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Create a program
  async createProgram(userId, programData) {
    const { user_input, pairing_id } = programData;
    const programId = this.generateUniqueId();

    try {
      const insertProgram = `
        INSERT INTO programs (id, user_id, user_input, pairing_id, therapy_response, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NOW(), NOW())
      `;

      await this.query(insertProgram, [programId, userId, user_input, pairing_id || null, programData.therapy_response || null]);
      
      return {
        id: programId,
        user_id: userId,
        user_input,
        pairing_id,
        therapy_response: programData.therapy_response || null,
        created_at: new Date().toISOString()
      };
    } catch (err) {
      console.error('Error creating program:', err);
      throw new Error('Failed to create program');
    }
  }

  // Get all programs for a user and their pairings (excluding soft deleted)
  async getUserPrograms(userId) {
    try {
      const query = `
        SELECT p.id, p.user_id, p.user_input, p.pairing_id,
               p.created_at, p.updated_at,
               pair.user1_id, pair.user2_id 
        FROM programs p
        LEFT JOIN pairings pair ON p.pairing_id = pair.id
        WHERE (
          p.user_id = ? 
          OR (p.pairing_id IS NOT NULL AND (pair.user1_id = ? OR pair.user2_id = ?) AND pair.status = 'accepted')
        )
        AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC
      `;

      const programs = await this.query(query, [userId, userId, userId]);
      
      // Return programs without therapy_response
      return programs;
    } catch (err) {
      throw new Error('Failed to fetch programs');
    }
  }

  // Check if user has access to a program (either owner or paired user)
  async checkProgramAccess(userId, programId) {
    try {
      const query = `
        SELECT COUNT(*) as count
        FROM programs p
        LEFT JOIN pairings pair ON p.pairing_id = pair.id
        WHERE p.id = ?
          AND p.deleted_at IS NULL
          AND (
            p.user_id = ?
            OR (p.pairing_id IS NOT NULL AND pair.status = 'accepted' AND (pair.user1_id = ? OR pair.user2_id = ?))
          )
      `;

      const result = await this.queryOne(query, [programId, userId, userId, userId]);
      return result.count > 0;
    } catch (err) {
      throw new Error('Failed to check program access');
    }
  }

  // Get program by ID (excluding soft deleted)
  async getProgramById(programId) {
    try {
      const query = `
        SELECT id, user_id, user_input, pairing_id, 
               created_at, updated_at
        FROM programs 
        WHERE id = ? AND deleted_at IS NULL
      `;

      const program = await this.queryOne(query, [programId]);
      if (!program) {
        throw new Error('Program not found');
      }
      
      // Return program without therapy_response
      return program;
    } catch (err) {
      throw new Error('Failed to fetch program');
    }
  }

  // Update therapy response for a program
  async updateTherapyResponse(programId, therapyResponse) {
    try {
      const updateQuery = `
        UPDATE programs 
        SET therapy_response = ?, updated_at = NOW()
        WHERE id = ? AND deleted_at IS NULL
      `;

      const result = await this.query(updateQuery, [therapyResponse, programId]);
      if (result.affectedRows === 0) {
        throw new Error('Program not found or already deleted');
      }
      return { message: 'Therapy response updated successfully' };
    } catch (err) {
      throw new Error('Failed to update therapy response');
    }
  }

  // Soft delete a program
  async softDeleteProgram(programId) {
    try {
      const updateQuery = `
        UPDATE programs 
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = ? AND deleted_at IS NULL
      `;

      const result = await this.query(updateQuery, [programId]);
      if (result.affectedRows === 0) {
        throw new Error('Program not found or already deleted');
      }
      return { message: 'Program deleted successfully', deleted_at: new Date().toISOString() };
    } catch (err) {
      throw new Error('Failed to delete program');
    }
  }
}

module.exports = Program;
