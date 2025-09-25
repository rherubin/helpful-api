class Program {
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
    const createProgramsTable = `
      CREATE TABLE IF NOT EXISTS programs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_input TEXT NOT NULL,
        pairing_id TEXT,
        therapy_response TEXT,
        deleted_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (pairing_id) REFERENCES pairings (id) ON DELETE CASCADE
      )
    `;

    try {
      await this.runAsync(createProgramsTable);
      console.log('Programs table initialized successfully.');
      
      // Add deleted_at column if it doesn't exist (for existing databases)
      try {
        await this.runAsync("ALTER TABLE programs ADD COLUMN deleted_at DATETIME DEFAULT NULL");
      } catch (alterErr) {
        if (!alterErr.message.includes('duplicate column name')) {
          console.error('Error adding deleted_at column to programs:', alterErr.message);
        }
      }
      
      // Migration logic for removing user_name, partner_name, children columns
      try {
        const tableInfo = await this.allAsync("PRAGMA table_info(programs)");
        const hasUserName = tableInfo.some(col => col.name === 'user_name');
        const hasPartnerName = tableInfo.some(col => col.name === 'partner_name');
        const hasChildren = tableInfo.some(col => col.name === 'children');
        
        if (hasUserName || hasPartnerName || hasChildren) {
          console.log('Migrating programs table to remove user_name, partner_name, children columns...');
          
          // Create new table without user_name, partner_name, children
          const createNewTable = `
            CREATE TABLE programs_new (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              user_input TEXT NOT NULL,
              pairing_id TEXT,
              therapy_response TEXT,
              deleted_at DATETIME DEFAULT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
              FOREIGN KEY (pairing_id) REFERENCES pairings (id) ON DELETE CASCADE
            )
          `;
          
          await this.runAsync(createNewTable);
          
          // Copy data from old table to new table (excluding user_name, partner_name, children)
          await this.runAsync(`
            INSERT INTO programs_new (id, user_id, user_input, pairing_id, therapy_response, deleted_at, created_at, updated_at)
            SELECT id, user_id, user_input, pairing_id, therapy_response, deleted_at, created_at, updated_at
            FROM programs
          `);
          
          // Drop old table and rename new table
          await this.runAsync("DROP TABLE programs");
          await this.runAsync("ALTER TABLE programs_new RENAME TO programs");
          
          console.log('Programs table migration completed successfully.');
        }
      } catch (migrationErr) {
        console.error('Error migrating programs table:', migrationErr.message);
        // Don't throw here as the table might already be correct
      }

      // Make pairing_id nullable for existing databases
      try {
        // SQLite doesn't support ALTER COLUMN directly, so we need to check if we need to recreate the table
        const tableInfo = await this.allAsync("PRAGMA table_info(programs)");
        const pairingIdColumn = tableInfo.find(col => col.name === 'pairing_id');
        
        if (pairingIdColumn && pairingIdColumn.notnull === 1) {
          console.log('Migrating programs table to make pairing_id nullable...');
          
          // Create new table with nullable pairing_id
          const createNewTable = `
            CREATE TABLE programs_new (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              user_name TEXT NOT NULL,
              partner_name TEXT NOT NULL,
              children INTEGER NOT NULL,
              user_input TEXT NOT NULL,
              pairing_id TEXT,
              therapy_response TEXT,
              deleted_at DATETIME DEFAULT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
              FOREIGN KEY (pairing_id) REFERENCES pairings (id) ON DELETE CASCADE
            )
          `;
          
          await this.runAsync(createNewTable);
          
          // Copy data from old table to new table
          await this.runAsync(`
            INSERT INTO programs_new 
            SELECT * FROM programs
          `);
          
          // Drop old table and rename new table
          await this.runAsync("DROP TABLE programs");
          await this.runAsync("ALTER TABLE programs_new RENAME TO programs");
          
          console.log('Programs table migration completed successfully.');
        }
      } catch (migrationErr) {
        console.error('Error migrating programs table:', migrationErr.message);
        // Don't throw here as the table might already be correct
      }
    } catch (err) {
      console.error('Error creating programs table:', err.message);
      throw err;
    }
  }

  // Generate unique ID
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
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;

      await this.runAsync(insertProgram, [programId, userId, user_input, pairing_id, programData.therapy_response || null]);
      
      return {
        id: programId,
        user_id: userId,
        user_input,
        pairing_id,
        therapy_response: programData.therapy_response || null,
        created_at: new Date().toISOString()
      };
    } catch (err) {
      throw new Error('Failed to create program');
    }
  }

  // Get all programs for a user and their pairings (excluding soft deleted)
  async getUserPrograms(userId) {
    try {
      const query = `
        SELECT p.id, p.user_id, p.user_input, p.pairing_id,
               p.therapy_response, p.created_at, p.updated_at,
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

      const programs = await this.allAsync(query, [userId, userId, userId]);
      
      // Parse therapy responses
      return programs.map(program => ({
        ...program,
        therapy_response: this.parseTherapyResponse(program.therapy_response)
      }));
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

      const result = await this.getAsync(query, [programId, userId, userId, userId]);
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
               therapy_response, created_at, updated_at
        FROM programs 
        WHERE id = ? AND deleted_at IS NULL
      `;

      const program = await this.getAsync(query, [programId]);
      if (!program) {
        throw new Error('Program not found');
      }
      
      // Parse therapy response
      return {
        ...program,
        therapy_response: this.parseTherapyResponse(program.therapy_response)
      };
    } catch (err) {
      throw new Error('Failed to fetch program');
    }
  }

  // Update therapy response for a program
  async updateTherapyResponse(programId, therapyResponse) {
    try {
      const updateQuery = `
        UPDATE programs 
        SET therapy_response = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ? AND deleted_at IS NULL
      `;

      const result = await this.runAsync(updateQuery, [therapyResponse, programId]);
      if (result.changes === 0) {
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
        SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ? AND deleted_at IS NULL
      `;

      const result = await this.runAsync(updateQuery, [programId]);
      if (result.changes === 0) {
        throw new Error('Program not found or already deleted');
      }
      return { message: 'Program deleted successfully', deleted_at: new Date().toISOString() };
    } catch (err) {
      throw new Error('Failed to delete program');
    }
  }
}

module.exports = Program;
