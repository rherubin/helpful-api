class Conversation {
  constructor(db) {
    this.db = db;
  }

  // Helper method to promisify better-sqlite3 operations
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
    const createConversationsTable = `
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        program_id TEXT NOT NULL,
        day INTEGER NOT NULL,
        theme TEXT NOT NULL,
        conversation_starter TEXT,
        science_behind_it TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (program_id) REFERENCES programs (id) ON DELETE CASCADE
      )
    `;

    try {
      await this.runAsync(createConversationsTable);
      console.log('Conversations table initialized successfully.');
      
      // Create indexes for better query performance
      try {
        await this.runAsync("CREATE INDEX IF NOT EXISTS idx_conversations_program_id ON conversations(program_id)");
        await this.runAsync("CREATE INDEX IF NOT EXISTS idx_conversations_day ON conversations(day)");
        await this.runAsync("CREATE INDEX IF NOT EXISTS idx_conversations_program_day ON conversations(program_id, day)");
      } catch (indexErr) {
        console.error('Error creating conversation indexes:', indexErr.message);
      }

      // Migrate existing conversations table if needed
      try {
        // Check if old structure exists
        const tableInfo = await this.allAsync("PRAGMA table_info(conversations)");
        const hasOldStructure = tableInfo.some(col => col.name === 'message_type');
        
        if (hasOldStructure) {
          console.log('Migrating conversations table to new structure...');
          
          // Create new table
          const createNewTable = `
            CREATE TABLE conversations_new (
              id TEXT PRIMARY KEY,
              program_id TEXT NOT NULL,
              day INTEGER NOT NULL,
              theme TEXT NOT NULL,
              conversation_starter TEXT,
              science_behind_it TEXT,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (program_id) REFERENCES programs (id) ON DELETE CASCADE
            )
          `;
          
          await this.runAsync(createNewTable);
          
          // Migrate data - only keep day conversations, user messages will be handled separately
          await this.runAsync(`
            INSERT INTO conversations_new (id, program_id, day, theme, conversation_starter, science_behind_it, created_at, updated_at)
            SELECT 
              id, 
              program_id, 
              CAST(JSON_EXTRACT(metadata, '$.day') AS INTEGER) as day,
              JSON_EXTRACT(metadata, '$.theme') as theme,
              JSON_EXTRACT(content, '$.conversation_starter') as conversation_starter,
              JSON_EXTRACT(content, '$.science_behind_it') as science_behind_it,
              created_at,
              updated_at
            FROM conversations 
            WHERE message_type = 'openai_response' 
              AND JSON_EXTRACT(metadata, '$.type') = 'day_conversation'
              AND JSON_EXTRACT(metadata, '$.day') IS NOT NULL
          `);
          
          // Drop old table and rename new table
          await this.runAsync("DROP TABLE conversations");
          await this.runAsync("ALTER TABLE conversations_new RENAME TO conversations");
          
          console.log('Conversations table migration completed successfully.');
        }
      } catch (migrationErr) {
        console.error('Error migrating conversations table:', migrationErr.message);
        // Don't throw here as the table might already be correct
      }
    } catch (err) {
      console.error('Error creating conversations table:', err.message);
      throw err;
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

  // Add OpenAI response to conversation
  async addOpenAIResponse(programId, content, metadata = null) {
    const conversationId = this.generateUniqueId();

    try {
      const insertQuery = `
        INSERT INTO conversations (id, program_id, message_type, sender_id, content, metadata, created_at, updated_at)
        VALUES (?, ?, 'openai_response', NULL, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;

      const metadataString = metadata ? JSON.stringify(metadata) : null;
      await this.runAsync(insertQuery, [conversationId, programId, content, metadataString]);
      
      return {
        id: conversationId,
        program_id: programId,
        message_type: 'openai_response',
        sender_id: null,
        content,
        metadata,
        created_at: new Date().toISOString()
      };
    } catch (err) {
      console.error('Error adding OpenAI response:', err.message);
      throw new Error('Failed to add OpenAI response to conversation');
    }
  }

  // Create a day conversation
  async createDayConversation(programId, day, theme, conversationStarter, scienceBehindIt) {
    const conversationId = this.generateUniqueId();

    try {
      const insertQuery = `
        INSERT INTO conversations (id, program_id, day, theme, conversation_starter, science_behind_it, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;

      await this.runAsync(insertQuery, [conversationId, programId, day, theme, conversationStarter, scienceBehindIt]);
      
      return {
        id: conversationId,
        program_id: programId,
        day,
        theme,
        conversation_starter: conversationStarter,
        science_behind_it: scienceBehindIt,
        created_at: new Date().toISOString()
      };
    } catch (err) {
      console.error('Error creating day conversation:', err.message);
      throw new Error('Failed to create day conversation');
    }
  }

  // Parse therapy response and create individual day conversations
  async createDayConversations(programId, therapyResponse) {
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

      const conversations = [];
      
      if (programData.program && programData.program.days && Array.isArray(programData.program.days)) {
        // Create a conversation for each day
        for (const dayData of programData.program.days) {
          const conversation = await this.createDayConversation(
            programId,
            dayData.day,
            dayData.theme,
            dayData.conversation_starter,
            dayData.science_behind_it
          );

          conversations.push(conversation);
        }

        console.log(`Created ${conversations.length} day conversations for program ${programId}`);
        return conversations;
      } else {
        console.log('No structured days found in therapy response');
        return [];
      }
    } catch (err) {
      console.error('Error creating day conversations:', err.message);
      throw new Error('Failed to create day conversations');
    }
  }

  // Add user message to conversation
  async addUserMessage(programId, senderId, content, metadata = null) {
    const conversationId = this.generateUniqueId();

    try {
      const insertQuery = `
        INSERT INTO conversations (id, program_id, message_type, sender_id, content, metadata, created_at, updated_at)
        VALUES (?, ?, 'user_message', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;

      const metadataString = metadata ? JSON.stringify(metadata) : null;
      await this.runAsync(insertQuery, [conversationId, programId, senderId, content, metadataString]);
      
      return {
        id: conversationId,
        program_id: programId,
        message_type: 'user_message',
        sender_id: senderId,
        content,
        metadata,
        created_at: new Date().toISOString()
      };
    } catch (err) {
      console.error('Error adding user message:', err.message);
      throw new Error('Failed to add user message to conversation');
    }
  }

  // Get all conversations for a program
  async getProgramConversations(programId) {
    try {
      const query = `
        SELECT c.id, c.program_id, c.day, c.theme, c.conversation_starter, 
               c.science_behind_it, c.created_at, c.updated_at
        FROM conversations c
        WHERE c.program_id = ?
        ORDER BY c.day ASC
      `;

      const conversations = await this.allAsync(query, [programId]);
      return conversations;
    } catch (err) {
      console.error('Error fetching program conversations:', err.message);
      throw new Error('Failed to fetch program conversations');
    }
  }

  // Get conversation for a specific day
  async getDayConversation(programId, day) {
    try {
      const query = `
        SELECT c.id, c.program_id, c.day, c.theme, c.conversation_starter, 
               c.science_behind_it, c.created_at, c.updated_at
        FROM conversations c
        WHERE c.program_id = ? AND c.day = ?
      `;

      const conversation = await this.getAsync(query, [programId, day]);
      if (!conversation) {
        throw new Error('Day conversation not found');
      }
      
      return conversation;
    } catch (err) {
      if (err.message === 'Day conversation not found') {
        throw err;
      }
      console.error('Error fetching day conversation:', err.message);
      throw new Error('Failed to fetch day conversation');
    }
  }

  // Get all days with conversations for a program
  async getProgramDays(programId) {
    try {
      const query = `
        SELECT c.day, c.theme, c.created_at, c.id as conversation_id
        FROM conversations c
        WHERE c.program_id = ? 
        ORDER BY c.day ASC
      `;

      const days = await this.allAsync(query, [programId]);
      
      return days.map(day => ({
        day: day.day,
        theme: day.theme,
        conversation_id: day.conversation_id,
        created_at: day.created_at
      }));
    } catch (err) {
      console.error('Error fetching program days:', err.message);
      throw new Error('Failed to fetch program days');
    }
  }

  // Get conversation by ID
  async getConversationById(conversationId) {
    try {
      const query = `
        SELECT c.id, c.program_id, c.day, c.theme, c.conversation_starter, 
               c.science_behind_it, c.created_at, c.updated_at
        FROM conversations c
        WHERE c.id = ?
      `;

      const conversation = await this.getAsync(query, [conversationId]);
      if (!conversation) {
        throw new Error('Conversation not found');
      }
      
      return conversation;
    } catch (err) {
      if (err.message === 'Conversation not found') {
        throw err;
      }
      console.error('Error fetching conversation:', err.message);
      throw new Error('Failed to fetch conversation');
    }
  }

  // Update conversation content (for editing messages)
  async updateConversation(conversationId, content, metadata = null) {
    try {
      const updateQuery = `
        UPDATE conversations 
        SET content = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `;

      const metadataString = metadata ? JSON.stringify(metadata) : null;
      const result = await this.runAsync(updateQuery, [content, metadataString, conversationId]);
      
      if (result.changes === 0) {
        throw new Error('Conversation not found');
      }
      
      return { message: 'Conversation updated successfully' };
    } catch (err) {
      if (err.message === 'Conversation not found') {
        throw err;
      }
      console.error('Error updating conversation:', err.message);
      throw new Error('Failed to update conversation');
    }
  }

  // Delete conversation
  async deleteConversation(conversationId) {
    try {
      const deleteQuery = `DELETE FROM conversations WHERE id = ?`;
      const result = await this.runAsync(deleteQuery, [conversationId]);
      
      if (result.changes === 0) {
        throw new Error('Conversation not found');
      }
      
      return { message: 'Conversation deleted successfully' };
    } catch (err) {
      if (err.message === 'Conversation not found') {
        throw err;
      }
      console.error('Error deleting conversation:', err.message);
      throw new Error('Failed to delete conversation');
    }
  }

  // Check if user has access to program conversations
  async checkConversationAccess(userId, programId) {
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
      console.error('Error checking conversation access:', err.message);
      throw new Error('Failed to check conversation access');
    }
  }
}

module.exports = Conversation;
