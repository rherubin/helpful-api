const express = require('express');
const { createAuthenticateToken } = require('../middleware/auth');

function createProgramStepRoutes(programStepModel, messageModel, programModel, pairingModel, userModel, chatGPTService, authService) {
  const router = express.Router();
  const authenticateToken = createAuthenticateToken(authService);

  // Helper function to check if we should trigger background therapy response
  async function checkAndTriggerTherapyResponse(stepId, currentUserId) {
    console.log(`[THERAPY_TRIGGER] Checking therapy response for step ${stepId}, user ${currentUserId}`);
    try {
      // Get the program step to find the program
      const step = await programStepModel.getStepById(stepId);
      const program = await programModel.getProgramById(step.program_id);
      console.log(`[THERAPY_TRIGGER] Step: ${stepId}, Program: ${program.id}, Pairing: ${program.pairing_id}`);

      // Only trigger if program has a pairing
      if (!program.pairing_id) {
        console.log(`[THERAPY_TRIGGER] No pairing_id, skipping`);
        return;
      }

      // Get the pairing to find both users
      const pairing = await pairingModel.getPairingById(program.pairing_id);
      console.log(`[THERAPY_TRIGGER] Pairing status: ${pairing.status}`);
      if (pairing.status !== 'accepted') {
        console.log(`[THERAPY_TRIGGER] Pairing not accepted, skipping`);
        return;
      }

      const user1Id = pairing.user1_id;
      const user2Id = pairing.user2_id;
      const otherUserId = currentUserId === user1Id ? user2Id : user1Id;

      // Get all messages in this step
      const messages = await messageModel.getStepMessages(stepId);

      // Filter user messages only
      const userMessages = messages.filter(msg => msg.message_type === 'user_message');

      // Check if this is the very first message in the chatroom
      if (userMessages.length === 1 && userMessages[0].sender_id === currentUserId) {
        console.log(`First message in step ${stepId} from user ${currentUserId}, adding welcome system message`);

        // Add the welcome system message
        await messageModel.addSystemMessage(stepId, "Thanks for the message! As soon as your partner replies, I'll start helping you move the conversation forward in the healthiest, most positive way.", {
          type: 'first_message_welcome',
          triggered_by: 'first_message',
          step_day: step.day,
          step_theme: step.theme
        });

        console.log(`Welcome system message added to step ${stepId}`);
        return; // Don't continue with therapy response logic for first message
      }

      // Check if both users have posted messages
      const user1HasPosted = userMessages.some(msg => msg.sender_id === user1Id);
      const user2HasPosted = userMessages.some(msg => msg.sender_id === user2Id);

      // Check if a therapy response already exists for this step
      const existingTherapyResponse = messages.some(msg =>
        msg.message_type === 'system' &&
        msg.metadata &&
        (typeof msg.metadata === 'string' ?
          msg.metadata.includes('therapy_response') :
          msg.metadata.type === 'therapy_response')
      );

      // Only trigger if both users have posted at least one message AND no therapy response exists yet
      console.log(`[THERAPY_TRIGGER] User1 (${user1Id}) posted: ${user1HasPosted}, User2 (${user2Id}) posted: ${user2HasPosted}, Existing therapy response: ${existingTherapyResponse}`);
      if (user1HasPosted && user2HasPosted && !existingTherapyResponse) {
        console.log(`Both users have posted messages in step ${stepId}, triggering therapy response...`);

        // Get user details for context
        const user1 = await userModel.getUserById(user1Id);
        const user2 = await userModel.getUserById(user2Id);

        // Extract user1's messages as an array of content strings
        const user1MessageContents = userMessages
          .filter(msg => msg.sender_id === user1Id)
          .map(msg => msg.content);

        // Extract user2's first message content
        const user2Messages = userMessages.filter(msg => msg.sender_id === user2Id);
        const user2FirstMessage = user2Messages.length > 0 ? user2Messages[0].content : '';

        // Generate therapy response using the correct method signature
        const therapyResponse = await chatGPTService.generateCouplesTherapyResponse(
          user1.first_name || 'User 1',
          user2.first_name || 'User 2',
          user1MessageContents,
          user2FirstMessage
        );

        // Add the therapy response as a system message
        await messageModel.addSystemMessage(stepId, therapyResponse, {
          type: 'therapy_response',
          triggered_by: 'both_users_posted',
          step_day: step.day,
          step_theme: step.theme
        });

        console.log(`Therapy response added to step ${stepId}`);
      } else if (existingTherapyResponse) {
        console.log(`Therapy response already exists for step ${stepId}, skipping duplicate trigger`);
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

      // Get the program to find the pairing_id
      const program = await programModel.getProgramById(programId);

      // Get all program steps for this program
      const programSteps = await programStepModel.getProgramSteps(programId);
      
      // Format program steps with contribution status
      const formattedSteps = await Promise.all(programSteps.map(async (step) => {
        let contributions = null;
        if (program.pairing_id) {
          contributions = await programStepModel.getStepContributionStatus(step.id, program.pairing_id);
        }
        
        return {
          id: step.id,
          day: step.day,
          theme: step.theme,
          conversation_starter: step.conversation_starter,
          science_behind_it: step.science_behind_it,
          started: step.started,
          contributions,
          created_at: step.created_at,
          updated_at: step.updated_at
        };
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

      // Get the program to find the pairing_id
      const program = await programModel.getProgramById(step.program_id);
      
      // Get contribution status if there's a pairing
      let contributions = null;
      if (program.pairing_id) {
        contributions = await programStepModel.getStepContributionStatus(id, program.pairing_id);
      }

      res.status(200).json({
        message: 'Program step retrieved successfully',
        step: {
          ...step,
          contributions
        }
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

      // Record user contribution (idempotent - only first contribution is recorded)
      await programStepModel.recordUserContribution(id, userId);

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

      // Check if we should trigger a therapy response immediately
      // Use setImmediate to ensure the user message is committed first
      setImmediate(() => {
        checkAndTriggerTherapyResponse(id, userId);
      });

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