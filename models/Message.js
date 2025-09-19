class Message {
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
    const createMessagesTable = `
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        step_id TEXT NOT NULL,
        message_type TEXT NOT NULL CHECK (message_type IN ('openai_response', 'user_message', 'system')),
        sender_id TEXT,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (step_id) REFERENCES program_steps (id) ON DELETE CASCADE,
        FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE SET NULL
      )
    `;

    try {
      await this.runAsync(createMessagesTable);
      console.log('Messages table initialized successfully.');
      
      // Migrate existing messages table if needed
      try {
        // Check if old messages table with conversation_id exists
        const tableInfo = await this.allAsync("PRAGMA table_info(messages)");
        const hasConversationId = tableInfo.some(col => col.name === 'conversation_id');
        
        if (hasConversationId && !tableInfo.some(col => col.name === 'step_id')) {
          console.log('Migrating messages table from conversation_id to step_id...');
          
          // Add step_id column
          await this.runAsync("ALTER TABLE messages ADD COLUMN step_id TEXT");
          
          // Update step_id to match conversation_id (assuming 1:1 mapping)
          await this.runAsync("UPDATE messages SET step_id = conversation_id");
          
          console.log('Messages table migration completed successfully.');
        }
      } catch (migrationErr) {
        console.error('Error migrating messages table:', migrationErr.message);
      }
      
      // Create indexes for better query performance
      try {
        await this.runAsync("CREATE INDEX IF NOT EXISTS idx_messages_step_id ON messages(step_id)");
        await this.runAsync("CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id)");
        await this.runAsync("CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type)");
        await this.runAsync("CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)");
        // Keep old index for backward compatibility during transition
        await this.runAsync("CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)");
      } catch (indexErr) {
        console.error('Error creating message indexes:', indexErr.message);
      }
    } catch (err) {
      console.error('Error creating messages table:', err.message);
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

  // Add a message to a conversation
  async addMessage(conversationId, messageType, senderId, content, metadata = null) {
    const messageId = this.generateUniqueId();

    try {
      const insertQuery = `
        INSERT INTO messages (id, conversation_id, message_type, sender_id, content, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;

      const metadataString = metadata ? JSON.stringify(metadata) : null;
      await this.runAsync(insertQuery, [messageId, conversationId, messageType, senderId, content, metadataString]);
      
      return {
        id: messageId,
        conversation_id: conversationId,
        message_type: messageType,
        sender_id: senderId,
        content,
        metadata,
        created_at: new Date().toISOString()
      };
    } catch (err) {
      console.error('Error adding message:', err.message);
      throw new Error('Failed to add message');
    }
  }

  // Get all messages for a conversation
  async getConversationMessages(conversationId) {
    try {
      const query = `
        SELECT m.id, m.conversation_id, m.message_type, m.sender_id, m.content, 
               m.created_at, m.updated_at
        FROM messages m
        WHERE m.conversation_id = ?
        ORDER BY m.created_at ASC
      `;

      const messages = await this.allAsync(query, [conversationId]);
      
      return messages.map(message => ({
        id: message.id,
        conversation_id: message.conversation_id,
        message_type: message.message_type,
        sender_id: message.sender_id,
        content: message.content,
        created_at: message.created_at,
        updated_at: message.updated_at
      }));
    } catch (err) {
      console.error('Error fetching conversation messages:', err.message);
      throw new Error('Failed to fetch conversation messages');
    }
  }

  // Get messages for a specific day across all conversations in a program
  async getDayMessages(programId, day) {
    try {
      const query = `
        SELECT m.id, m.conversation_id, m.message_type, m.sender_id, m.content, 
               m.metadata, m.created_at, m.updated_at,
               u.first_name, u.last_name, u.email,
               c.day, c.theme
        FROM messages m
        LEFT JOIN users u ON m.sender_id = u.id
        JOIN conversations c ON m.conversation_id = c.id
        WHERE c.program_id = ? AND c.day = ?
        ORDER BY m.created_at ASC
      `;

      const messages = await this.allAsync(query, [programId, day]);
      
      // Parse metadata for each message
      return messages.map(msg => ({
        ...msg,
        metadata: this.parseMetadata(msg.metadata),
        sender: msg.sender_id ? {
          id: msg.sender_id,
          first_name: msg.first_name,
          last_name: msg.last_name,
          email: msg.email
        } : null
      }));
    } catch (err) {
      console.error('Error fetching day messages:', err.message);
      throw new Error('Failed to fetch day messages');
    }
  }

  // Get message by ID
  async getMessageById(messageId) {
    try {
      const query = `
        SELECT m.id, m.conversation_id, m.message_type, m.sender_id, m.content, 
               m.metadata, m.created_at, m.updated_at,
               u.first_name, u.last_name, u.email
        FROM messages m
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `;

      const message = await this.getAsync(query, [messageId]);
      if (!message) {
        throw new Error('Message not found');
      }
      
      return {
        ...message,
        metadata: this.parseMetadata(message.metadata),
        sender: message.sender_id ? {
          id: message.sender_id,
          first_name: message.first_name,
          last_name: message.last_name,
          email: message.email
        } : null
      };
    } catch (err) {
      if (err.message === 'Message not found') {
        throw err;
      }
      console.error('Error fetching message:', err.message);
      throw new Error('Failed to fetch message');
    }
  }

  // Update message content
  async updateMessage(messageId, content, metadata = null) {
    try {
      const updateQuery = `
        UPDATE messages 
        SET content = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `;

      const metadataString = metadata ? JSON.stringify(metadata) : null;
      const result = await this.runAsync(updateQuery, [content, metadataString, messageId]);
      
      if (result.changes === 0) {
        throw new Error('Message not found');
      }
      
      return { message: 'Message updated successfully' };
    } catch (err) {
      if (err.message === 'Message not found') {
        throw err;
      }
      console.error('Error updating message:', err.message);
      throw new Error('Failed to update message');
    }
  }

  // Delete message
  async deleteMessage(messageId) {
    try {
      const deleteQuery = `DELETE FROM messages WHERE id = ?`;
      const result = await this.runAsync(deleteQuery, [messageId]);
      
      if (result.changes === 0) {
        throw new Error('Message not found');
      }
      
      return { message: 'Message deleted successfully' };
    } catch (err) {
      if (err.message === 'Message not found') {
        throw err;
      }
      console.error('Error deleting message:', err.message);
      throw new Error('Failed to delete message');
    }
  }

  // Get message count for a conversation
  async getMessageCount(conversationId) {
    try {
      const query = `SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?`;
      const result = await this.getAsync(query, [conversationId]);
      return result.count;
    } catch (err) {
      console.error('Error getting message count:', err.message);
      throw new Error('Failed to get message count');
    }
  }

  // Check if user has access to a message (through program access)
  async checkMessageAccess(userId, messageId) {
    try {
      const query = `
        SELECT COUNT(*) as count
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        JOIN programs p ON c.program_id = p.id
        LEFT JOIN pairings pair ON p.pairing_id = pair.id
        WHERE m.id = ?
          AND p.deleted_at IS NULL
          AND (
            p.user_id = ?
            OR (p.pairing_id IS NOT NULL AND pair.status = 'accepted' AND (pair.user1_id = ? OR pair.user2_id = ?))
          )
      `;

      const result = await this.getAsync(query, [messageId, userId, userId, userId]);
      return result.count > 0;
    } catch (err) {
      console.error('Error checking message access:', err.message);
      throw new Error('Failed to check message access');
    }
  }
  // Add user message to a program step
  async addUserMessage(stepId, senderId, content, metadata = null) {
    return this.addStepMessage(stepId, 'user_message', senderId, content, metadata);
  }

  // Add system message to a program step
  async addSystemMessage(stepId, content, metadata = null) {
    return this.addStepMessage(stepId, 'system', null, content, metadata);
  }

  // Add message to a program step
  async addStepMessage(stepId, messageType, senderId, content, metadata = null) {
    const messageId = this.generateUniqueId();

    try {
      const insertQuery = `
        INSERT INTO messages (id, step_id, message_type, sender_id, content, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;

      const metadataString = metadata ? JSON.stringify(metadata) : null;
      await this.runAsync(insertQuery, [messageId, stepId, messageType, senderId, content, metadataString]);
      
      return {
        id: messageId,
        step_id: stepId,
        message_type: messageType,
        sender_id: senderId,
        content,
        metadata,
        created_at: new Date().toISOString()
      };
    } catch (err) {
      console.error('Error adding step message:', err.message);
      throw new Error('Failed to add message to step');
    }
  }

  // Get all messages in a program step
  async getStepMessages(stepId) {
    try {
      const query = `
        SELECT m.id, m.step_id, m.message_type, m.sender_id, m.content, 
               m.created_at, m.updated_at
        FROM messages m
        WHERE m.step_id = ?
        ORDER BY m.created_at ASC
      `;

      const messages = await this.allAsync(query, [stepId]);
      
      return messages.map(message => ({
        id: message.id,
        step_id: message.step_id,
        message_type: message.message_type,
        sender_id: message.sender_id,
        content: message.content,
        created_at: message.created_at,
        updated_at: message.updated_at
      }));
    } catch (err) {
      console.error('Error fetching step messages:', err.message);
      throw new Error('Failed to fetch step messages');
    }
  }
}

module.exports = Message;
