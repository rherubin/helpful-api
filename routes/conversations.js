const express = require('express');
const { authenticateToken } = require('../middleware/auth');

function createConversationRoutes(conversationModel, messageModel, programModel, pairingModel, userModel, chatGPTService) {
  const router = express.Router();

  // Helper function to check if we should trigger background therapy response
  async function checkAndTriggerTherapyResponse(conversationId, currentUserId) {
    try {
      // Get the conversation to find the program
      const conversation = await conversationModel.getConversationById(conversationId);
      const program = await programModel.getProgramById(conversation.program_id);
      
      // Only trigger if program has a pairing
      if (!program.pairing_id) {
        return;
      }

      // Get the pairing to find both users
      const pairing = await pairingModel.getPairingById(program.pairing_id);
      if (pairing.status !== 'accepted') {
        return;
      }

      const user1Id = pairing.user1_id;
      const user2Id = pairing.user2_id;
      const otherUserId = currentUserId === user1Id ? user2Id : user1Id;

      // Get all messages in this conversation
      const messages = await messageModel.getConversationMessages(conversationId);
      
      // Filter user messages only
      const userMessages = messages.filter(msg => msg.message_type === 'user_message');
      
      // Check if both users have posted messages
      const user1Messages = userMessages.filter(msg => msg.sender_id === user1Id);
      const user2Messages = userMessages.filter(msg => msg.sender_id === user2Id);
      
      // Only trigger if both users have posted at least one message
      // and this is the second user's first message (either user1 or user2 could be second)
      const shouldTrigger = 
        (user1Messages.length === 1 && user2Messages.length > 0 && currentUserId === user1Id) ||
        (user2Messages.length === 1 && user1Messages.length > 0 && currentUserId === user2Id);
        
      if (shouldTrigger) {
        // Get user names
        const user1 = await userModel.getUserById(user1Id);
        const user2 = await userModel.getUserById(user2Id);
        
        const user1Name = user1.first_name || 'User 1';
        const user2Name = user2.first_name || 'User 2';
        
        // Get user1's messages content and user2's first message
        const user1MessagesContent = user1Messages.map(msg => msg.content);
        const user2FirstMessage = user2Messages[0].content;
        
        // Trigger background request with 2-second delay
        setTimeout(async () => {
          try {
            console.log(`Triggering background therapy response for conversation ${conversationId}`);
            
            const therapyMessages = await chatGPTService.generateCouplesTherapyResponse(
              user1Name,
              user2Name,
              user1MessagesContent,
              user2FirstMessage
            );
            
            // Add each therapy message as a system message
            for (let i = 0; i < therapyMessages.length; i++) {
              const message = therapyMessages[i];
              if (message && message.trim().length > 0) {
                await messageModel.addMessage(
                  conversationId,
                  'system',
                  null, // No sender for system messages
                  message.trim(),
                  {
                    type: 'therapy_response',
                    sequence: i + 1,
                    total_messages: therapyMessages.length
                  }
                );
              }
            }
            
            console.log(`Added ${therapyMessages.length} therapy response messages to conversation ${conversationId}`);
          } catch (error) {
            console.error('Error generating background therapy response:', error.message);
          }
        }, 2000); // 2-second delay
      }
    } catch (error) {
      console.error('Error checking therapy response trigger:', error.message);
    }
  }

  // Get all conversations for a program (organized by days)
  router.get('/programs/:programId/conversations', authenticateToken, async (req, res) => {
    try {
      const { programId } = req.params;
      const userId = req.user.id;

      // Check if user has access to this program
      const hasAccess = await conversationModel.checkConversationAccess(userId, programId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this program\'s conversations' });
      }

      // Get all days and their conversations
      const days = await conversationModel.getProgramDays(programId);
      const conversationsByDay = {};

      for (const dayInfo of days) {
        // Get the conversation details and messages
        const conversation = await conversationModel.getDayConversation(programId, dayInfo.day);
        const messages = await messageModel.getConversationMessages(conversation.id);
        
        conversationsByDay[dayInfo.day] = {
          day: dayInfo.day,
          theme: dayInfo.theme,
          conversation_id: conversation.id,
          conversation_starter: conversation.conversation_starter,
          science_behind_it: conversation.science_behind_it,
          created_at: dayInfo.created_at,
          messages: messages
        };
      }
      
      res.status(200).json({
        message: 'Conversations retrieved successfully',
        days: conversationsByDay,
        total_days: days.length
      });
    } catch (error) {
      console.error('Error fetching conversations:', error.message);
      return res.status(500).json({ error: 'Failed to fetch conversations' });
    }
  });

  // Get specific conversation by ID
  router.get('/conversations/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Get conversation details
      const conversation = await conversationModel.getConversationById(id);
      
      // Check if user has access to this conversation's program
      const hasAccess = await conversationModel.checkConversationAccess(userId, conversation.program_id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this conversation' });
      }

      res.status(200).json({
        message: 'Conversation retrieved successfully',
        conversation
      });
    } catch (error) {
      if (error.message === 'Conversation not found') {
        return res.status(404).json({ error: error.message });
      }
      console.error('Error fetching conversation:', error.message);
      return res.status(500).json({ error: 'Failed to fetch conversation' });
    }
  });

  // Get all messages for a conversation
  router.get('/conversations/:id/messages', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Get conversation details to check access
      const conversation = await conversationModel.getConversationById(id);
      
      // Check if user has access to this conversation's program
      const hasAccess = await conversationModel.checkConversationAccess(userId, conversation.program_id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this conversation\'s messages' });
      }

      // Get all messages for this conversation
      const messages = await messageModel.getConversationMessages(id);

      res.status(200).json({
        message: 'Messages retrieved successfully',
        conversation_id: id,
        messages
      });
    } catch (error) {
      if (error.message === 'Conversation not found') {
        return res.status(404).json({ error: error.message });
      }
      console.error('Error fetching messages:', error.message);
      return res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  // Add a message to a conversation
  router.post('/conversations/:id/messages', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { content, metadata } = req.body;
      const userId = req.user.id;

      // Validation
      if (!content || content.trim().length === 0) {
        return res.status(400).json({ 
          error: 'Message content is required and cannot be empty' 
        });
      }

      // Get conversation details to check access
      const conversation = await conversationModel.getConversationById(id);
      
      // Check if user has access to this conversation's program
      const hasAccess = await conversationModel.checkConversationAccess(userId, conversation.program_id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to add messages to this conversation' });
      }

      // Add message metadata including day from conversation
      const messageMetadata = {
        ...metadata,
        day: conversation.day,
        type: 'user_message'
      };

      // Add the message to the conversation
      const message = await messageModel.addMessage(
        id, 
        'user_message', 
        userId, 
        content.trim(), 
        messageMetadata
      );
      
      // Check if we should trigger background therapy response (non-blocking)
      checkAndTriggerTherapyResponse(id, userId).catch(error => {
        console.error('Background therapy response trigger failed:', error.message);
      });
      
      res.status(201).json({
        message: 'Message added successfully',
        data: message
      });
    } catch (error) {
      if (error.message === 'Conversation not found') {
        return res.status(404).json({ error: error.message });
      }
      console.error('Error adding message:', error.message);
      return res.status(500).json({ error: 'Failed to add message' });
    }
  });

  // Update a message in a conversation
  router.put('/conversations/:conversationId/messages/:messageId', authenticateToken, async (req, res) => {
    try {
      const { conversationId, messageId } = req.params;
      const { content, metadata } = req.body;
      const userId = req.user.id;

      // Validation
      if (!content || content.trim().length === 0) {
        return res.status(400).json({ 
          error: 'Message content is required and cannot be empty' 
        });
      }

      // Get message details to check ownership
      const message = await messageModel.getMessageById(messageId);
      
      // Check if user has access to this message
      const hasAccess = await messageModel.checkMessageAccess(userId, messageId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this message' });
      }

      // Only the sender can update their own messages (can't edit OpenAI responses)
      if (message.message_type === 'openai_response') {
        return res.status(403).json({ error: 'Cannot edit OpenAI responses' });
      }

      if (message.sender_id !== userId) {
        return res.status(403).json({ error: 'Can only edit your own messages' });
      }

      // Update the message
      const result = await messageModel.updateMessage(messageId, content.trim(), metadata);
      
      res.status(200).json(result);
    } catch (error) {
      if (error.message === 'Message not found') {
        return res.status(404).json({ error: error.message });
      }
      console.error('Error updating message:', error.message);
      return res.status(500).json({ error: 'Failed to update message' });
    }
  });

  // Get conversations for a specific day
  router.get('/programs/:programId/conversations/day/:day', authenticateToken, async (req, res) => {
    try {
      const { programId, day } = req.params;
      const userId = req.user.id;

      // Validate day parameter
      const dayNumber = parseInt(day);
      if (isNaN(dayNumber) || dayNumber < 1) {
        return res.status(400).json({ error: 'Day must be a positive integer' });
      }

      // Check if user has access to this program
      const hasAccess = await conversationModel.checkConversationAccess(userId, programId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this program\'s conversations' });
      }

      // Get the conversation and its messages
      const conversation = await conversationModel.getDayConversation(programId, dayNumber);
      const messages = await messageModel.getConversationMessages(conversation.id);
      
      res.status(200).json({
        message: `Day ${dayNumber} conversations retrieved successfully`,
        day: dayNumber,
        conversation: {
          ...conversation,
          messages: messages
        }
      });
    } catch (error) {
      if (error.message === 'Day conversation not found') {
        return res.status(404).json({ error: 'Day conversation not found' });
      }
      console.error('Error fetching day conversations:', error.message);
      return res.status(500).json({ error: 'Failed to fetch day conversations' });
    }
  });

  // Add a user message to a specific day's conversation
  router.post('/programs/:programId/conversations/day/:day', authenticateToken, async (req, res) => {
    try {
      const { programId, day } = req.params;
      const { content, metadata } = req.body;
      const userId = req.user.id;

      // Validate day parameter
      const dayNumber = parseInt(day);
      if (isNaN(dayNumber) || dayNumber < 1) {
        return res.status(400).json({ error: 'Day must be a positive integer' });
      }

      // Validation
      if (!content || content.trim().length === 0) {
        return res.status(400).json({ 
          error: 'Message content is required and cannot be empty' 
        });
      }

      // Check if user has access to this program
      const hasAccess = await conversationModel.checkConversationAccess(userId, programId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to add messages to this program' });
      }

      // Get the conversation for this day
      const conversation = await conversationModel.getDayConversation(programId, dayNumber);

      // Add message metadata
      const messageMetadata = {
        ...metadata,
        day: dayNumber,
        type: 'user_message'
      };

      // Add the message to the conversation
      const message = await messageModel.addMessage(
        conversation.id, 
        'user_message', 
        userId, 
        content.trim(), 
        messageMetadata
      );
      
      // Check if we should trigger background therapy response (non-blocking)
      checkAndTriggerTherapyResponse(conversation.id, userId).catch(error => {
        console.error('Background therapy response trigger failed:', error.message);
      });
      
      res.status(201).json({
        message: `Message added to day ${dayNumber} successfully`,
        data: message
      });
    } catch (error) {
      if (error.message === 'Day conversation not found') {
        return res.status(404).json({ error: 'Day conversation not found' });
      }
      console.error('Error adding user message:', error.message);
      return res.status(500).json({ error: 'Failed to add message' });
    }
  });

  // Get a specific conversation by ID
  router.get('/conversations/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const conversation = await conversationModel.getConversationById(id);
      
      // Check if user has access to this program
      const hasAccess = await conversationModel.checkConversationAccess(userId, conversation.program_id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this conversation' });
      }

      res.status(200).json({
        message: 'Conversation retrieved successfully',
        conversation
      });
    } catch (error) {
      if (error.message === 'Conversation not found') {
        return res.status(404).json({ error: error.message });
      }
      console.error('Error fetching conversation:', error.message);
      return res.status(500).json({ error: 'Failed to fetch conversation' });
    }
  });

  // Update a conversation (only the sender can update their own messages)
  router.put('/conversations/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { content, metadata } = req.body;
      const userId = req.user.id;

      // Validation
      if (!content || content.trim().length === 0) {
        return res.status(400).json({ 
          error: 'Message content is required and cannot be empty' 
        });
      }

      // Get the conversation to check ownership
      const conversation = await conversationModel.getConversationById(id);
      
      // Check if user has access to this program
      const hasAccess = await conversationModel.checkConversationAccess(userId, conversation.program_id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this conversation' });
      }

      // Only the sender can update their own messages (can't edit OpenAI responses)
      if (conversation.message_type === 'openai_response') {
        return res.status(403).json({ error: 'Cannot edit OpenAI responses' });
      }

      if (conversation.sender_id !== userId) {
        return res.status(403).json({ error: 'Can only edit your own messages' });
      }

      const result = await conversationModel.updateConversation(id, content.trim(), metadata);
      
      res.status(200).json(result);
    } catch (error) {
      if (error.message === 'Conversation not found') {
        return res.status(404).json({ error: error.message });
      }
      console.error('Error updating conversation:', error.message);
      return res.status(500).json({ error: 'Failed to update conversation' });
    }
  });

  // Delete a conversation (only the sender can delete their own messages)
  router.delete('/conversations/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Get the conversation to check ownership
      const conversation = await conversationModel.getConversationById(id);
      
      // Check if user has access to this program
      const hasAccess = await conversationModel.checkConversationAccess(userId, conversation.program_id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this conversation' });
      }

      // Only the sender can delete their own messages (can't delete OpenAI responses)
      if (conversation.message_type === 'openai_response') {
        return res.status(403).json({ error: 'Cannot delete OpenAI responses' });
      }

      if (conversation.sender_id !== userId) {
        return res.status(403).json({ error: 'Can only delete your own messages' });
      }

      const result = await conversationModel.deleteConversation(id);
      
      res.status(200).json(result);
    } catch (error) {
      if (error.message === 'Conversation not found') {
        return res.status(404).json({ error: error.message });
      }
      console.error('Error deleting conversation:', error.message);
      return res.status(500).json({ error: 'Failed to delete conversation' });
    }
  });

  return router;
}

module.exports = createConversationRoutes;
