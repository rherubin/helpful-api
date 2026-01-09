const express = require('express');
const { createAuthenticateToken } = require('../middleware/auth');

function createProgramRoutes(programModel, chatGPTService, programStepModel = null, userModel = null, pairingModel = null, authService = null) {
  const router = express.Router();
  const authenticateToken = createAuthenticateToken(authService);

  // Create next program based on previous program
  router.post('/:id/next_program', authenticateToken, async (req, res) => {
    try {
      const { id: previousProgramId } = req.params;
      const { user_input, steps_required_for_unlock } = req.body;
      const userId = req.user.id;

      // Validation
      if (!user_input) {
        return res.status(400).json({ 
          error: 'Field user_input is required' 
        });
      }

      // Check if user has access to the previous program
      const hasAccess = await programModel.checkProgramAccess(userId, previousProgramId);
      if (!hasAccess) {
        return res.status(403).json({ 
          error: 'Not authorized to access this program' 
        });
      }

      // Get the previous program
      const previousProgram = await programModel.getProgramById(previousProgramId);

      // Check if the previous program is unlocked
      if (!previousProgram.next_program_unlocked) {
        return res.status(403).json({ 
          error: 'Previous program must be unlocked before generating next program',
          current_unlock_status: {
            next_program_unlocked: false,
            steps_required_for_unlock: previousProgram.steps_required_for_unlock
          }
        });
      }

      // Get user names for the prompt
      let userName = null;
      let partnerName = null;

      if (userModel) {
        try {
          const user = await userModel.getUserById(previousProgram.user_id);
          userName = user.user_name || null;
          partnerName = user.partner_name || null;

          // If pairing exists and partner_name is not set, try to get partner's user_name
          if (previousProgram.pairing_id && pairingModel && !user.partner_name) {
            try {
              const pairing = await pairingModel.getPairingById(previousProgram.pairing_id);
              const partnerId = pairing.user1_id === previousProgram.user_id ? pairing.user2_id : pairing.user1_id;
              if (partnerId) {
                const partner = await userModel.getUserById(partnerId);
                partnerName = partner.user_name || partnerName;
              }
            } catch (pairingError) {
              console.log('Could not fetch partner name from pairing:', pairingError.message);
            }
          }
        } catch (userError) {
          console.log('Could not fetch user names:', userError.message);
        }
      }

      // Validate that both user names are set
      if (!userName || !partnerName) {
        return res.status(400).json({
          error: 'User names are required to generate therapy content',
          details: {
            user_name_set: !!userName,
            partner_name_set: !!partnerName
          },
          hint: 'Please update your profile with user_name and partner_name before generating a program'
        });
      }

      // Get conversation starters from previous program that have messages
      let previousConversationStarters = [];
      try {
        previousConversationStarters = await programModel.getConversationStartersWithMessages(previousProgramId);
      } catch (startersError) {
        console.log('Could not fetch conversation starters:', startersError.message);
      }

      // Create the new program
      const newProgram = await programModel.createProgram(previousProgram.user_id, {
        user_input,
        pairing_id: previousProgram.pairing_id,
        previous_program_id: previousProgramId,
        steps_required_for_unlock: steps_required_for_unlock || 7
      });

      // Return immediate response
      res.status(201).json({
        message: 'Next program created successfully',
        program: newProgram
      });

      // Generate ChatGPT response asynchronously in the background
      if (chatGPTService && chatGPTService.isConfigured()) {
        // Don't await this - let it run in the background
        (async () => {
          try {
            console.log('Generating next program ChatGPT response for program:', newProgram.id);
            const therapyResponse = await chatGPTService.generateNextCouplesProgram(
              userName, 
              partnerName, 
              previousConversationStarters,
              user_input
            );
            
            // Convert response to string if it's an object
            const therapyResponseString = typeof therapyResponse === 'object' 
              ? JSON.stringify(therapyResponse) 
              : therapyResponse;
            
            // Update the program with the therapy response (for backward compatibility)
            await programModel.updateTherapyResponse(newProgram.id, therapyResponseString);
            
            // Also save to program_steps table if available (create program steps)
            if (programStepModel) {
              await programStepModel.createProgramSteps(newProgram.id, therapyResponseString);
              console.log('Program steps created for next program:', newProgram.id);
            }
            
            console.log('ChatGPT response generated and saved for next program:', newProgram.id);
          } catch (chatGPTError) {
            console.error('Failed to generate ChatGPT response for next program', newProgram.id, ':', chatGPTError.message);
            // Save the error to the database
            try {
              await programModel.updateGenerationError(newProgram.id, chatGPTError.message);
            } catch (saveError) {
              console.error('Failed to save generation error:', saveError.message);
            }
          }
        })();
      } else {
        console.log('ChatGPT service not configured, skipping therapy response generation');
      }
    } catch (error) {
      console.error('Error creating next program:', error.message);
      if (error.message === 'Program not found') {
        return res.status(404).json({ error: 'Previous program not found' });
      }
      return res.status(500).json({ error: 'Failed to create next program' });
    }
  });

  // Manually generate therapy response for a program
  router.post('/:program_id/therapy_response', authenticateToken, async (req, res) => {
    try {
      const { program_id } = req.params;
      const userId = req.user.id;

      // Check if user has access to this program
      const hasAccess = await programModel.checkProgramAccess(userId, program_id);
      if (!hasAccess) {
        return res.status(403).json({ 
          error: 'Not authorized to access this program' 
        });
      }

      // Get the program
      const program = await programModel.getProgramById(program_id);

      // Check if program already has program steps
      if (programStepModel) {
        const existingSteps = await programStepModel.getProgramSteps(program_id);
        if (existingSteps && existingSteps.length > 0) {
          return res.status(409).json({
            error: 'Therapy response already exists for this program',
            details: 'This program already has program steps. Delete the program and create a new one if you need to regenerate.',
            existing_steps_count: existingSteps.length
          });
        }
      }

      // Check if ChatGPT service is configured
      if (!chatGPTService || !chatGPTService.isConfigured()) {
        return res.status(503).json({ 
          error: 'ChatGPT service is not configured. Please set OPENAI_API_KEY environment variable.',
          details: 'The OpenAI API key is required to generate therapy responses.'
        });
      }

      // Get user names for the prompt
      let userName = null;
      let partnerName = null;

      if (userModel) {
        try {
          const user = await userModel.getUserById(program.user_id);
          userName = user.user_name || null;
          partnerName = user.partner_name || null;

          // If pairing exists and partner_name is not set, try to get partner's user_name
          if (program.pairing_id && pairingModel && !user.partner_name) {
            try {
              const pairing = await pairingModel.getPairingById(program.pairing_id);
              const partnerId = pairing.user1_id === program.user_id ? pairing.user2_id : pairing.user1_id;
              if (partnerId) {
                const partner = await userModel.getUserById(partnerId);
                partnerName = partner.user_name || partnerName;
              }
            } catch (pairingError) {
              console.log('Could not fetch partner name from pairing:', pairingError.message);
            }
          }
        } catch (userError) {
          console.log('Could not fetch user names:', userError.message);
        }
      }

      // Validate that both user names are set
      if (!userName || !partnerName) {
        return res.status(400).json({
          error: 'User names are required to generate therapy content',
          details: {
            user_name_set: !!userName,
            partner_name_set: !!partnerName
          },
          hint: 'Please update your profile with user_name and partner_name before generating a program'
        });
      }

      // Return immediate response
      res.status(202).json({
        message: 'Therapy response generation started',
        program_id: program_id,
        status: 'processing'
      });

      // Generate ChatGPT response asynchronously in the background
      (async () => {
        try {
          console.log('Manually generating ChatGPT response for program:', program_id);
          const therapyResponse = await chatGPTService.generateCouplesProgram(userName, partnerName, program.user_input);
          
          // Convert response to string if it's an object
          const therapyResponseString = typeof therapyResponse === 'object' 
            ? JSON.stringify(therapyResponse) 
            : therapyResponse;
          
          // Update the program with the therapy response (for backward compatibility)
          await programModel.updateTherapyResponse(program_id, therapyResponseString);
          
          // Also save to program_steps table if available (create program steps)
          if (programStepModel) {
            await programStepModel.createProgramSteps(program_id, therapyResponseString);
            console.log('Program steps created for program:', program_id);
          }
          
          console.log('ChatGPT response generated and saved for program:', program_id);
        } catch (chatGPTError) {
          console.error('Failed to generate ChatGPT response for program', program_id, ':', chatGPTError.message);
          // Save the error to the database
          try {
            await programModel.updateGenerationError(program_id, chatGPTError.message);
          } catch (saveError) {
            console.error('Failed to save generation error:', saveError.message);
          }
        }
      })();
    } catch (error) {
      console.error('Error in manual therapy response generation:', error.message);
      if (error.message === 'Program not found') {
        return res.status(404).json({ error: 'Program not found' });
      }
      return res.status(500).json({ error: 'Failed to generate therapy response' });
    }
  });

  // Create a program
  router.post('/', authenticateToken, async (req, res) => {
    try {
      const { user_input, pairing_id, steps_required_for_unlock } = req.body;
      const userId = req.user.id;

      // Validation
      if (!user_input) {
        return res.status(400).json({ 
          error: 'Field user_input is required. pairing_id is optional.' 
        });
      }

      // Get user names for the prompt
      let userName = null;
      let partnerName = null;

      if (userModel) {
        try {
          const user = await userModel.getUserById(userId);
          userName = user.user_name || null;
          partnerName = user.partner_name || null;

          // If pairing exists and partner_name is not set, try to get partner's user_name
          if (pairing_id && pairingModel && !user.partner_name) {
            try {
              const pairing = await pairingModel.getPairingById(pairing_id);
              const partnerId = pairing.user1_id === userId ? pairing.user2_id : pairing.user1_id;
              if (partnerId) {
                const partner = await userModel.getUserById(partnerId);
                partnerName = partner.user_name || partnerName;
              }
            } catch (pairingError) {
              console.log('Could not fetch partner name from pairing:', pairingError.message);
            }
          }
        } catch (userError) {
          console.log('Could not fetch user names:', userError.message);
        }
      }

      // Validate that both user names are set
      if (!userName || !partnerName) {
        return res.status(400).json({
          error: 'User names are required to generate therapy content',
          details: {
            user_name_set: !!userName,
            partner_name_set: !!partnerName
          },
          hint: 'Please update your profile with user_name and partner_name before generating a program'
        });
      }

      // Create the program first
      const program = await programModel.createProgram(userId, {
        user_input,
        pairing_id,
        steps_required_for_unlock: steps_required_for_unlock || 7
      });

      // Return immediate response
      res.status(201).json({
        message: 'Program created successfully',
        program
      });

      // Generate ChatGPT response asynchronously in the background
      if (chatGPTService && chatGPTService.isConfigured()) {
        // Don't await this - let it run in the background
        (async () => {
          try {
            console.log('Generating ChatGPT response for program:', program.id);
            const therapyResponse = await chatGPTService.generateCouplesProgram(userName, partnerName, user_input);
            
            // Convert response to string if it's an object
            const therapyResponseString = typeof therapyResponse === 'object' 
              ? JSON.stringify(therapyResponse) 
              : therapyResponse;
            
            // Update the program with the therapy response (for backward compatibility)
            await programModel.updateTherapyResponse(program.id, therapyResponseString);
            
            // Also save to program_steps table if available (create program steps)
            if (programStepModel) {
              await programStepModel.createProgramSteps(program.id, therapyResponseString);
              console.log('Program steps created for program:', program.id);
            }
            
            console.log('ChatGPT response generated and saved for program:', program.id);
          } catch (chatGPTError) {
            console.error('Failed to generate ChatGPT response for program', program.id, ':', chatGPTError.message);
            // Save the error to the database
            try {
              await programModel.updateGenerationError(program.id, chatGPTError.message);
            } catch (saveError) {
              console.error('Failed to save generation error:', saveError.message);
            }
          }
        })();
      } else {
        console.log('ChatGPT service not configured, skipping therapy response generation');
      }
    } catch (error) {
      return res.status(500).json({ error: 'Failed to create program' });
    }
  });

  // Get all user's programs
  router.get('/', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const programs = await programModel.getUserPrograms(userId);
      
      // Fetch program steps for each program
      const programsWithSteps = await Promise.all(
        programs.map(async (program) => {
          const programSteps = programStepModel ? await programStepModel.getProgramSteps(program.id) : [];
          return {
            ...program,
            next_program_unlocked: Boolean(program.next_program_unlocked),
            program_steps: programSteps
          };
        })
      );
      
      res.status(200).json({
        message: 'Programs retrieved successfully',
        programs: programsWithSteps
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch programs' });
    }
  });

  // Get program by ID
  router.get('/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const program = await programModel.getProgramById(id);

      // Check if the user has access to this program (either owner or paired user)
      const hasAccess = await programModel.checkProgramAccess(req.user.id, id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this program' });
      }

      // Fetch program steps for this program
      const programSteps = programStepModel ? await programStepModel.getProgramSteps(id) : [];
      const programWithSteps = {
        ...program,
        next_program_unlocked: Boolean(program.next_program_unlocked),
        program_steps: programSteps
      };

      res.status(200).json({
        message: 'Program retrieved successfully',
        program: programWithSteps
      });
    } catch (error) {
      if (error.message === 'Program not found') {
        return res.status(404).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to fetch program' });
    }
  });

  // Delete a program
  router.delete('/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if the user has access to this program
      const hasAccess = await programModel.checkProgramAccess(req.user.id, id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to delete this program' });
      }

      // Only the owner can delete a program
      const program = await programModel.getProgramById(id);
      if (program.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Only the program owner can delete it' });
      }

      const result = await programModel.softDeleteProgram(id);
      res.status(200).json(result);
    } catch (error) {
      if (error.message === 'Program not found' || error.message === 'Program not found or already deleted') {
        return res.status(404).json({ error: 'Program not found' });
      }
      return res.status(500).json({ error: 'Failed to delete program' });
    }
  });

  // Get OpenAI service metrics (for monitoring)
  router.get('/metrics', authenticateToken, async (req, res) => {
    try {
      if (!chatGPTService) {
        return res.status(503).json({ 
          error: 'ChatGPT service not available',
          metrics: null
        });
      }

      if (!chatGPTService.isConfigured()) {
        return res.status(200).json({
          message: 'ChatGPT service not configured (OPENAI_API_KEY missing)',
          metrics: {
            configured: false,
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            rateLimitErrors: 0,
            averageResponseTime: 0,
            queueLength: 0,
            activeRequests: 0,
            successRate: '0%'
          },
          timestamp: new Date().toISOString()
        });
      }

      const metrics = chatGPTService.getMetrics();
      res.status(200).json({
        message: 'OpenAI service metrics retrieved successfully',
        metrics: {
          ...metrics,
          configured: true
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error retrieving OpenAI metrics:', error.message);
      return res.status(500).json({ error: 'Failed to retrieve OpenAI metrics' });
    }
  });

  return router;
}

module.exports = createProgramRoutes;
