class ProgramStep {
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
    const createProgramStepsTable = `
      CREATE TABLE IF NOT EXISTS program_steps (
        id VARCHAR(50) PRIMARY KEY,
        program_id VARCHAR(50) NOT NULL,
        day INT NOT NULL,
        theme VARCHAR(255) NOT NULL,
        conversation_starter TEXT DEFAULT NULL,
        science_behind_it TEXT DEFAULT NULL,
        started BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_program_id (program_id),
        INDEX idx_day (day),
        INDEX idx_program_day (program_id, day),
        INDEX idx_started (started),
        FOREIGN KEY (program_id) REFERENCES programs (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    const createContributionsTable = `
      CREATE TABLE IF NOT EXISTS program_step_user_contribution (
        id VARCHAR(50) PRIMARY KEY,
        step_id VARCHAR(50) NOT NULL,
        user_id VARCHAR(50) NOT NULL,
        contributed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_step_user (step_id, user_id),
        INDEX idx_step_id (step_id),
        INDEX idx_user_id (user_id),
        FOREIGN KEY (step_id) REFERENCES program_steps (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    try {
      await this.query(createProgramStepsTable);
      console.log('Program steps table initialized successfully.');
      
      await this.query(createContributionsTable);
      console.log('Program step user contribution table initialized successfully.');
      
      // Add migration support for existing databases
      await this.migrateStartedField();
      await this.migrateExistingContributions();
    } catch (err) {
      console.error('Error creating program_steps table:', err.message);
      throw err;
    }
  }

  // Migration method to add started field to existing databases
  async migrateStartedField() {
    try {
      // Check if column exists
      const checkColumn = `
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'program_steps' 
        AND COLUMN_NAME = 'started'
      `;
      
      const existingColumns = await this.query(checkColumn);
      
      // Add started if it doesn't exist
      if (existingColumns.length === 0) {
        await this.query(`
          ALTER TABLE program_steps 
          ADD COLUMN started BOOLEAN DEFAULT FALSE 
          AFTER science_behind_it
        `);
        await this.query(`
          CREATE INDEX idx_started 
          ON program_steps (started)
        `);
        console.log('Added started column to program_steps table.');
        
        // Update existing steps that have messages to set started = TRUE
        await this.query(`
          UPDATE program_steps ps
          SET started = TRUE
          WHERE EXISTS (
            SELECT 1 FROM messages m 
            WHERE m.step_id = ps.id
          )
        `);
        console.log('Updated existing program steps with messages to started = TRUE.');
      }
    } catch (err) {
      // Ignore errors if column already exists
      console.log('Migration check completed (started column may already exist).');
    }
  }

  // Migration method to populate contributions from existing messages
  async migrateExistingContributions() {
    try {
      // Check if the contributions table has any data
      const existingContributions = await this.queryOne(`
        SELECT COUNT(*) as count FROM program_step_user_contribution
      `);

      // Only migrate if table is empty (first time setup)
      if (existingContributions.count === 0) {
        // Insert first contribution for each user in each step based on their first message
        await this.query(`
          INSERT INTO program_step_user_contribution (id, step_id, user_id, contributed_at)
          SELECT 
            CONCAT(CONV(UNIX_TIMESTAMP(MIN(m.created_at)), 10, 36), SUBSTRING(MD5(RAND()), 1, 8)) as id,
            m.step_id,
            m.sender_id,
            MIN(m.created_at) as contributed_at
          FROM messages m
          WHERE m.sender_id IS NOT NULL AND m.message_type = 'user_message'
          GROUP BY m.step_id, m.sender_id
          ON DUPLICATE KEY UPDATE contributed_at = contributed_at
        `);
        console.log('Migrated existing message contributions to program_step_user_contribution table.');
      }
    } catch (err) {
      // Ignore errors during migration
      console.log('Migration check completed for contributions (may already exist or table empty).');
    }
  }

  // Generate unique ID
  generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Parse metadata from JSON string if possible
  parseMetadata(metadata) {
    if (!metadata) return null;
    
    try {
      return JSON.parse(metadata);
    } catch (error) {
      return metadata;
    }
  }

  // Create a program step
  async createProgramStep(programId, day, theme, conversationStarter, scienceBehindIt) {
    const stepId = this.generateUniqueId();

    try {
      const insertQuery = `
        INSERT INTO program_steps (id, program_id, day, theme, conversation_starter, science_behind_it, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;

      await this.query(insertQuery, [stepId, programId, day, theme, conversationStarter, scienceBehindIt]);
      
      return {
        id: stepId,
        program_id: programId,
        day,
        theme,
        conversation_starter: conversationStarter,
        science_behind_it: scienceBehindIt,
        created_at: new Date().toISOString()
      };
    } catch (err) {
      console.error('Error creating program step:', err.message);
      throw new Error('Failed to create program step');
    }
  }

  // Parse therapy response and create individual program steps
  async createProgramSteps(programId, therapyResponse) {
    try {
      let programData;
      
      // Parse the therapy response
      try {
        programData = typeof therapyResponse === 'string' 
          ? JSON.parse(therapyResponse) 
          : therapyResponse;
      } catch (parseError) {
        console.error('Error parsing therapy response:', parseError.message);
        throw new Error('Invalid therapy response format');
      }

      const programSteps = [];
      
      if (programData.program && programData.program.days && Array.isArray(programData.program.days)) {
        // Create a program step for each day
        for (const dayData of programData.program.days) {
          const step = await this.createProgramStep(
            programId,
            dayData.day,
            dayData.theme,
            dayData.conversation_starter,
            dayData.science_behind_it
          );

          programSteps.push(step);
        }

        console.log(`Created ${programSteps.length} program steps for program ${programId}`);
        return programSteps;
      } else {
        console.log('No structured days found in therapy response');
        return [];
      }
    } catch (err) {
      console.error('Error creating program steps:', err.message);
      throw new Error('Failed to create program steps');
    }
  }

  // Get all program steps for a program
  async getProgramSteps(programId) {
    try {
      const query = `
        SELECT s.id, s.program_id, s.day, s.theme, s.conversation_starter, 
               s.science_behind_it, s.started, s.created_at, s.updated_at
        FROM program_steps s
        WHERE s.program_id = ?
        ORDER BY s.day ASC
      `;

      const programSteps = await this.query(query, [programId]);
      
      // Convert started field from 0/1 to true/false boolean
      return programSteps.map(step => ({
        ...step,
        started: Boolean(step.started)
      }));
    } catch (err) {
      console.error('Error fetching program steps:', err.message);
      throw new Error('Failed to fetch program steps');
    }
  }

  // Get program step for a specific day
  async getDayStep(programId, day) {
    try {
      const query = `
        SELECT s.id, s.program_id, s.day, s.theme, s.conversation_starter, 
               s.science_behind_it, s.started, s.created_at, s.updated_at
        FROM program_steps s
        WHERE s.program_id = ? AND s.day = ?
      `;

      const step = await this.queryOne(query, [programId, day]);
      if (!step) {
        throw new Error('Program step not found');
      }
      
      // Convert started field from 0/1 to true/false boolean
      return {
        ...step,
        started: Boolean(step.started)
      };
    } catch (err) {
      if (err.message === 'Program step not found') {
        throw err;
      }
      console.error('Error fetching program step:', err.message);
      throw new Error('Failed to fetch program step');
    }
  }

  // Get all days with program steps for a program
  async getProgramDays(programId) {
    try {
      const query = `
        SELECT s.day, s.theme, s.started, s.created_at, s.id as step_id
        FROM program_steps s
        WHERE s.program_id = ? 
        ORDER BY s.day ASC
      `;

      const days = await this.query(query, [programId]);
      
      return days.map(day => ({
        day: day.day,
        theme: day.theme,
        step_id: day.step_id,
        started: Boolean(day.started),
        created_at: day.created_at
      }));
    } catch (err) {
      console.error('Error fetching program days:', err.message);
      throw new Error('Failed to fetch program days');
    }
  }

  // Get program step by ID
  async getStepById(stepId) {
    try {
      const query = `
        SELECT s.id, s.program_id, s.day, s.theme, s.conversation_starter, 
               s.science_behind_it, s.started, s.created_at, s.updated_at
        FROM program_steps s
        WHERE s.id = ?
      `;

      const step = await this.queryOne(query, [stepId]);
      if (!step) {
        throw new Error('Program step not found');
      }
      
      // Convert started field from 0/1 to true/false boolean
      return {
        ...step,
        started: Boolean(step.started)
      };
    } catch (err) {
      if (err.message === 'Program step not found') {
        throw err;
      }
      console.error('Error fetching program step:', err.message);
      throw new Error('Failed to fetch program step');
    }
  }

  // Mark a program step as started
  async markStepAsStarted(stepId) {
    try {
      const updateQuery = `
        UPDATE program_steps 
        SET started = TRUE, updated_at = NOW()
        WHERE id = ? AND started = FALSE
      `;

      await this.query(updateQuery, [stepId]);
      console.log(`Program step ${stepId} marked as started.`);
      return true;
    } catch (err) {
      console.error('Error marking step as started:', err.message);
      throw new Error('Failed to mark step as started');
    }
  }

  // Check if user has access to program steps
  async checkStepAccess(userId, programId) {
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
      console.error('Error checking program step access:', err.message);
      throw new Error('Failed to check program step access');
    }
  }

  // Record a user's first contribution to a program step (idempotent)
  async recordUserContribution(stepId, userId) {
    const contributionId = this.generateUniqueId();

    try {
      const insertQuery = `
        INSERT IGNORE INTO program_step_user_contribution (id, step_id, user_id, contributed_at)
        VALUES (?, ?, ?, NOW())
      `;

      await this.query(insertQuery, [contributionId, stepId, userId]);
      return true;
    } catch (err) {
      console.error('Error recording user contribution:', err.message);
      throw new Error('Failed to record user contribution');
    }
  }

  // Get all contributions for a program step
  async getStepContributions(stepId) {
    try {
      const query = `
        SELECT c.user_id, c.contributed_at
        FROM program_step_user_contribution c
        WHERE c.step_id = ?
        ORDER BY c.contributed_at ASC
      `;

      const contributions = await this.query(query, [stepId]);
      return contributions;
    } catch (err) {
      console.error('Error fetching step contributions:', err.message);
      throw new Error('Failed to fetch step contributions');
    }
  }

  // Get contribution status for a program step with pairing context
  async getStepContributionStatus(stepId, pairingId) {
    try {
      // Get the pairing users
      const pairingQuery = `
        SELECT user1_id, user2_id FROM pairings WHERE id = ?
      `;
      const pairing = await this.queryOne(pairingQuery, [pairingId]);
      
      if (!pairing) {
        return [];
      }

      // Get contributions for this step
      const contributions = await this.getStepContributions(stepId);
      
      // Build contribution status array for each user in the pairing
      const userIds = [pairing.user1_id, pairing.user2_id].filter(Boolean);
      
      return userIds.map(userId => {
        const contribution = contributions.find(c => c.user_id === userId);
        return {
          user_id: userId,
          contributed_at: contribution ? contribution.contributed_at : null
        };
      });
    } catch (err) {
      console.error('Error fetching step contribution status:', err.message);
      throw new Error('Failed to fetch step contribution status');
    }
  }
}

module.exports = ProgramStep;
