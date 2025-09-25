const express = require('express');
const { authenticateToken } = require('../middleware/auth');

function createProgramRoutes(programModel, chatGPTService, programStepModel = null) {
  const router = express.Router();

  // Create a program
  router.post('/', authenticateToken, async (req, res) => {
    try {
      const { user_input, pairing_id } = req.body;
      const userId = req.user.id;

      // Validation
      if (!user_input) {
        return res.status(400).json({ 
          error: 'Field user_input is required. pairing_id is optional.' 
        });
      }

      // Create the program first
      const program = await programModel.createProgram(userId, {
        user_input,
        pairing_id
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
            const therapyResponse = await chatGPTService.generateCouplesProgram('User', 'Partner', user_input);
            
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
            // Don't fail the entire request if ChatGPT fails
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
