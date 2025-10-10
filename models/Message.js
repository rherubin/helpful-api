class Message {
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
    const createMessagesTable = `
      CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(50) PRIMARY KEY,
        step_id VARCHAR(50) NOT NULL,
        message_type VARCHAR(20) NOT NULL CHECK (message_type IN ('openai_response', 'user_message', 'system')),
        sender_id VARCHAR(50) DEFAULT NULL,
        content TEXT NOT NULL,
        metadata TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_step_id (step_id),
        INDEX idx_sender_id (sender_id),
        INDEX idx_message_type (message_type),
        INDEX idx_created_at (created_at),
        FOREIGN KEY (step_id) REFERENCES program_steps (id) ON DELETE CASCADE,
        FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;

    try {
      await this.query(createMessagesTable);
      console.log('Messages table initialized successfully.');
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

  // Add a message to a conversation (legacy method for backward compatibility)
  async addMessage(conversationId, messageType, senderId, content, metadata = null) {
    const messageId = this.generateUniqueId();

    try {
      const insertQuery = `
        INSERT INTO messages (id, step_id, message_type, sender_id, content, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;

      const metadataString = metadata ? JSON.stringify(metadata) : null;
      await this.query(insertQuery, [messageId, conversationId, messageType, senderId, content, metadataString]);
      
      return {
        id: messageId,
        conversation_id: conversationId,
        step_id: conversationId,
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

  // Get all messages for a conversation (legacy method - maps to step)
  async getConversationMessages(conversationId) {
    try {
      const query = `
        SELECT m.id, m.step_id as conversation_id, m.message_type, m.sender_id, m.content, 
               m.created_at, m.updated_at
        FROM messages m
        WHERE m.step_id = ?
        ORDER BY m.created_at ASC
      `;

      const messages = await this.query(query, [conversationId]);
      
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

  // Get message by ID
  async getMessageById(messageId) {
    try {
      const query = `
        SELECT m.id, m.step_id, m.message_type, m.sender_id, m.content, 
               m.metadata, m.created_at, m.updated_at,
               u.user_name, u.email
        FROM messages m
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `;

      const message = await this.queryOne(query, [messageId]);
      if (!message) {
        throw new Error('Message not found');
      }
      
      return {
        ...message,
        metadata: this.parseMetadata(message.metadata),
        sender: message.sender_id ? {
          id: message.sender_id,
          user_name: message.user_name,
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
        SET content = ?, metadata = ?, updated_at = NOW()
        WHERE id = ?
      `;

      const metadataString = metadata ? JSON.stringify(metadata) : null;
      const result = await this.query(updateQuery, [content, metadataString, messageId]);
      
      if (result.affectedRows === 0) {
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
      const result = await this.query(deleteQuery, [messageId]);
      
      if (result.affectedRows === 0) {
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

  // Get message count for a conversation/step
  async getMessageCount(conversationId) {
    try {
      const query = `SELECT COUNT(*) as count FROM messages WHERE step_id = ?`;
      const result = await this.queryOne(query, [conversationId]);
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
        JOIN program_steps ps ON m.step_id = ps.id
        JOIN programs p ON ps.program_id = p.id
        LEFT JOIN pairings pair ON p.pairing_id = pair.id
        WHERE m.id = ?
          AND p.deleted_at IS NULL
          AND (
            p.user_id = ?
            OR (p.pairing_id IS NOT NULL AND pair.status = 'accepted' AND (pair.user1_id = ? OR pair.user2_id = ?))
          )
      `;

      const result = await this.queryOne(query, [messageId, userId, userId, userId]);
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
        VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;

      const metadataString = metadata ? JSON.stringify(metadata) : null;
      await this.query(insertQuery, [messageId, stepId, messageType, senderId, content, metadataString]);
      
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

      const messages = await this.query(query, [stepId]);
      
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
