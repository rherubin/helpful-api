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
        steps_required_for_unlock INT DEFAULT 7,
        next_program_unlocked BOOLEAN DEFAULT FALSE,
        deleted_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_pairing_id (pairing_id),
        INDEX idx_deleted_at (deleted_at),
        INDEX idx_next_program_unlocked (next_program_unlocked),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (pairing_id) REFERENCES pairings (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    try {
      await this.query(createProgramsTable);
      console.log('Programs table initialized successfully.');
      
      // Add migration support for existing databases
      await this.migrateUnlockFields();
    } catch (err) {
      console.error('Error creating programs table:', err.message);
      throw err;
    }
  }

  // Migration method to add unlock fields to existing databases
  async migrateUnlockFields() {
    try {
      // Check if columns exist
      const checkColumns = `
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'programs' 
        AND COLUMN_NAME IN ('steps_required_for_unlock', 'next_program_unlocked', 'previous_program_id')
      `;
      
      const existingColumns = await this.query(checkColumns);
      const columnNames = existingColumns.map(col => col.COLUMN_NAME);
      
      // Add steps_required_for_unlock if it doesn't exist
      if (!columnNames.includes('steps_required_for_unlock')) {
        await this.query(`
          ALTER TABLE programs 
          ADD COLUMN steps_required_for_unlock INT DEFAULT 7 
          AFTER therapy_response
        `);
        console.log('Added steps_required_for_unlock column to programs table.');
      }
      
      // Add next_program_unlocked if it doesn't exist
      if (!columnNames.includes('next_program_unlocked')) {
        await this.query(`
          ALTER TABLE programs 
          ADD COLUMN next_program_unlocked BOOLEAN DEFAULT FALSE 
          AFTER steps_required_for_unlock
        `);
        await this.query(`
          CREATE INDEX idx_next_program_unlocked 
          ON programs (next_program_unlocked)
        `);
        console.log('Added next_program_unlocked column to programs table.');
      }
      
      // Add previous_program_id if it doesn't exist
      if (!columnNames.includes('previous_program_id')) {
        await this.query(`
          ALTER TABLE programs 
          ADD COLUMN previous_program_id VARCHAR(50) DEFAULT NULL 
          AFTER pairing_id
        `);
        await this.query(`
          CREATE INDEX idx_previous_program_id 
          ON programs (previous_program_id)
        `);
        // Add foreign key constraint
        try {
          await this.query(`
            ALTER TABLE programs 
            ADD CONSTRAINT fk_previous_program 
            FOREIGN KEY (previous_program_id) REFERENCES programs (id) ON DELETE SET NULL
          `);
        } catch (fkErr) {
          // Ignore if foreign key already exists
          console.log('Foreign key constraint may already exist.');
        }
        console.log('Added previous_program_id column to programs table.');
      }
    } catch (err) {
      // Ignore errors if columns already exist or other migration issues
      console.log('Migration check completed (columns may already exist).');
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
    const { user_input, pairing_id, previous_program_id, steps_required_for_unlock = 7 } = programData;
    const programId = this.generateUniqueId();

    try {
      const insertProgram = `
        INSERT INTO programs (id, user_id, user_input, pairing_id, previous_program_id, therapy_response, steps_required_for_unlock, next_program_unlocked, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, NOW(), NOW())
      `;

      await this.query(insertProgram, [
        programId, 
        userId, 
        user_input, 
        pairing_id || null,
        previous_program_id || null,
        programData.therapy_response || null,
        steps_required_for_unlock
      ]);
      
      return {
        id: programId,
        user_id: userId,
        user_input,
        pairing_id,
        previous_program_id,
        therapy_response: programData.therapy_response || null,
        steps_required_for_unlock,
        next_program_unlocked: false,
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
               p.steps_required_for_unlock, p.next_program_unlocked,
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
               steps_required_for_unlock, next_program_unlocked,
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

  // Get count of program steps that have been started
  async getStartedStepsCount(programId) {
    try {
      const query = `
        SELECT COUNT(*) as count
        FROM program_steps
        WHERE program_id = ? AND started = TRUE
      `;

      const result = await this.queryOne(query, [programId]);
      return result.count || 0;
    } catch (err) {
      console.error('Error getting started steps count:', err.message);
      throw new Error('Failed to get started steps count');
    }
  }

  // Get count of program steps that have at least one message (legacy method for backward compatibility)
  async getStepsWithMessages(programId) {
    try {
      const query = `
        SELECT COUNT(DISTINCT ps.id) as count
        FROM program_steps ps
        INNER JOIN messages m ON ps.id = m.step_id
        WHERE ps.program_id = ?
      `;

      const result = await this.queryOne(query, [programId]);
      return result.count || 0;
    } catch (err) {
      console.error('Error getting steps with messages:', err.message);
      throw new Error('Failed to get steps with messages');
    }
  }

  // Check if unlock threshold is met and update status
  async checkAndUpdateUnlockStatus(programId) {
    try {
      // Get the program to check current status and threshold
      const program = await this.getProgramById(programId);
      
      // If already unlocked, no need to check again
      if (program.next_program_unlocked) {
        return {
          already_unlocked: true,
          next_program_unlocked: true,
          started_steps: null,
          steps_required: program.steps_required_for_unlock
        };
      }

      // Get count of started steps
      const startedSteps = await this.getStartedStepsCount(programId);
      
      // Check if threshold is met
      const thresholdMet = startedSteps >= program.steps_required_for_unlock;
      
      if (thresholdMet) {
        // Update the unlock status
        const updateQuery = `
          UPDATE programs 
          SET next_program_unlocked = TRUE, updated_at = NOW()
          WHERE id = ? AND deleted_at IS NULL
        `;
        
        await this.query(updateQuery, [programId]);
        
        console.log(`Program ${programId} unlocked! ${startedSteps}/${program.steps_required_for_unlock} steps started.`);
        
        return {
          unlocked: true,
          next_program_unlocked: true,
          started_steps: startedSteps,
          steps_required: program.steps_required_for_unlock
        };
      }
      
      return {
        unlocked: false,
        next_program_unlocked: false,
        started_steps: startedSteps,
        steps_required: program.steps_required_for_unlock
      };
    } catch (err) {
      console.error('Error checking unlock status:', err.message);
      throw new Error('Failed to check unlock status');
    }
  }

  // Get conversation starters from program steps that have at least one user message
  async getConversationStartersWithMessages(programId) {
    try {
      const query = `
        SELECT DISTINCT ps.conversation_starter
        FROM program_steps ps
        INNER JOIN messages m ON ps.id = m.step_id
        WHERE ps.program_id = ?
          AND m.message_type = 'user_message'
        ORDER BY ps.day ASC
      `;

      const results = await this.query(query, [programId]);
      return results.map(row => row.conversation_starter).filter(starter => starter);
    } catch (err) {
      console.error('Error getting conversation starters with messages:', err.message);
      throw new Error('Failed to get conversation starters with messages');
    }
  }
}

module.exports = Program;
