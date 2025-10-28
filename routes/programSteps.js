const express = require('express');
const { authenticateToken } = require('../middleware/auth');

function createProgramStepRoutes(programStepModel, messageModel, programModel, pairingModel, userModel, chatGPTService) {
  const router = express.Router();

  // Helper function to check if we should trigger background therapy response
  async function checkAndTriggerTherapyResponse(stepId, currentUserId) {
    try {
      // Get the program step to find the program
      const step = await programStepModel.getStepById(stepId);
      const program = await programModel.getProgramById(step.program_id);
      
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

      // Get all messages in this step
      const messages = await messageModel.getStepMessages(stepId);
      
      // Filter user messages only
      const userMessages = messages.filter(msg => msg.message_type === 'user_message');
      
      // Check if both users have posted messages
      const user1HasPosted = userMessages.some(msg => msg.sender_id === user1Id);
      const user2HasPosted = userMessages.some(msg => msg.sender_id === user2Id);
      
      // Only trigger if both users have posted at least one message
      if (user1HasPosted && user2HasPosted) {
        console.log(`Both users have posted messages in step ${stepId}, triggering therapy response...`);
        
        // Get user details for context
        const user1 = await userModel.getUserById(user1Id);
        const user2 = await userModel.getUserById(user2Id);
        
        // Prepare conversation context for OpenAI
        const conversationContext = {
          program: {
            user_name: program.user_name,
            partner_name: program.partner_name,
            children: program.children
          },
          step: {
            day: step.day,
            theme: step.theme,
            conversation_starter: step.conversation_starter,
            science_behind_it: step.science_behind_it
          },
          users: [
            {
              id: user1Id,
              name: user1.first_name || 'User 1'
            },
            {
              id: user2Id,
              name: user2.first_name || 'User 2'
            }
          ],
          messages: userMessages.map(msg => ({
            sender_name: msg.sender_id === user1Id ? (user1.first_name || 'User 1') : (user2.first_name || 'User 2'),
            content: msg.content,
            timestamp: msg.created_at
          }))
        };

        // Generate therapy response
        const therapyResponse = await chatGPTService.generateTherapyResponse(conversationContext);
        
        // Add the therapy response as a system message
        await messageModel.addSystemMessage(stepId, therapyResponse, {
          type: 'therapy_response',
          triggered_by: 'both_users_posted',
          step_day: step.day,
          step_theme: step.theme
        });
        
        console.log(`Therapy response added to step ${stepId}`);
      }
    } catch (error) {
      console.error('Error checking therapy response trigger:', error.message);
    }
  }

  // Get all program steps for a program (organized by days)
  router.get('/programs/:programId/programSteps', authenticateToken, async (req, res) => {
    try {
      const { programId } = req.params;
      const userId = req.user.id;

      // Check if user has access to this program
      const hasAccess = await programStepModel.checkStepAccess(userId, programId);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this program\'s steps' });
      }

      // Get all program steps for this program
      const programSteps = await programStepModel.getProgramSteps(programId);
      
      // Format program steps without messages
      const formattedSteps = programSteps.map(step => ({
        id: step.id,
        day: step.day,
        theme: step.theme,
        conversation_starter: step.conversation_starter,
        science_behind_it: step.science_behind_it,
        started: step.started,
        created_at: step.created_at,
        updated_at: step.updated_at
      }));
      
      res.status(200).json({
        message: 'Program steps retrieved successfully',
        program_steps: formattedSteps,
        total_steps: formattedSteps.length
      });
    } catch (error) {
      console.error('Error fetching program steps:', error.message);
      return res.status(500).json({ error: 'Failed to fetch program steps' });
    }
  });

  // Get specific program step by ID
  router.get('/programSteps/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Get the program step
      const step = await programStepModel.getStepById(id);
      
      // Check if user has access to this program step
      const hasAccess = await programStepModel.checkStepAccess(userId, step.program_id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this program step' });
      }

      res.status(200).json({
        message: 'Program step retrieved successfully',
        step: step
      });
    } catch (error) {
      if (error.message === 'Program step not found') {
        return res.status(404).json({ error: error.message });
      }
      console.error('Error fetching program step:', error.message);
      return res.status(500).json({ error: 'Failed to fetch program step' });
    }
  });

  // Get messages for a specific program step
  router.get('/programSteps/:id/messages', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Get the program step to check access
      const step = await programStepModel.getStepById(id);
      
      // Check if user has access to this program step
      const hasAccess = await programStepModel.checkStepAccess(userId, step.program_id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this program step' });
      }

      // Get all messages for this step
      const messages = await messageModel.getStepMessages(id);

      res.status(200).json({
        message: 'Messages retrieved successfully',
        step_id: id,
        messages: messages,
        total_messages: messages.length
      });
    } catch (error) {
      if (error.message === 'Program step not found') {
        return res.status(404).json({ error: error.message });
      }
      console.error('Error fetching step messages:', error.message);
      return res.status(500).json({ error: 'Failed to fetch step messages' });
    }
  });

  // Add a message to a program step
  router.post('/programSteps/:id/messages', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { content } = req.body;
      const userId = req.user.id;

      if (!content || content.trim() === '') {
        return res.status(400).json({ error: 'Message content is required' });
      }

      // Get the program step to check access
      const step = await programStepModel.getStepById(id);
      
      // Check if user has access to this program step
      const hasAccess = await programStepModel.checkStepAccess(userId, step.program_id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this program step' });
      }

      // Mark the step as started (if not already started)
      await programStepModel.markStepAsStarted(id);

      // Add the user message
      const message = await messageModel.addUserMessage(id, userId, content.trim());

      // Check and update unlock status for the program
      setTimeout(async () => {
        try {
          await programModel.checkAndUpdateUnlockStatus(step.program_id);
        } catch (unlockError) {
          console.error('Error checking unlock status:', unlockError.message);
        }
      }, 500);

      // Check if we should trigger a background therapy response
      setTimeout(() => {
        checkAndTriggerTherapyResponse(id, userId);
      }, 1000); // Small delay to ensure message is saved

      res.status(201).json({
        message: 'Message added successfully',
        data: message
      });
    } catch (error) {
      if (error.message === 'Program step not found') {
        return res.status(404).json({ error: error.message });
      }
      console.error('Error adding message:', error.message);
      return res.status(500).json({ error: 'Failed to add message' });
    }
  });

  // Update a message in a program step
  router.put('/programSteps/:stepId/messages/:messageId', authenticateToken, async (req, res) => {
    try {
      const { stepId, messageId } = req.params;
      const { content } = req.body;
      const userId = req.user.id;

      if (!content || content.trim() === '') {
        return res.status(400).json({ error: 'Message content is required' });
      }

      // Get the program step to check access
      const step = await programStepModel.getStepById(stepId);
      
      // Check if user has access to this program step
      const hasAccess = await programStepModel.checkStepAccess(userId, step.program_id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this program step' });
      }

      // Get the message to check ownership
      const message = await messageModel.getMessageById(messageId);
      if (message.sender_id !== userId) {
        return res.status(403).json({ error: 'Not authorized to edit this message' });
      }

      // Update the message
      const updatedMessage = await messageModel.updateMessage(messageId, content.trim());

      res.status(200).json({
        message: 'Message updated successfully',
        data: updatedMessage
      });
    } catch (error) {
      if (error.message === 'Program step not found' || error.message === 'Message not found') {
        return res.status(404).json({ error: error.message });
      }
      console.error('Error updating message:', error.message);
      return res.status(500).json({ error: 'Failed to update message' });
    }
  });

  return router;
}

module.exports = createProgramStepRoutes;