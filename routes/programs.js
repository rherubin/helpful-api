const express = require('express');
const { authenticateToken } = require('../middleware/auth');

function createProgramRoutes(programModel, chatGPTService) {
  const router = express.Router();

  // Create a program
  router.post('/', authenticateToken, async (req, res) => {
    try {
      const { user_name, partner_name, children, user_input, pairing_id } = req.body;
      const userId = req.user.id;

      // Validation
      if (!user_name || !partner_name || children === undefined || !user_input || !pairing_id) {
        return res.status(400).json({ 
          error: 'All fields (user_name, partner_name, children, user_input, pairing_id) are required' 
        });
      }

      // Validate children is a number
      if (!Number.isInteger(children) || children < 0) {
        return res.status(400).json({ 
          error: 'Children must be a non-negative integer' 
        });
      }

      // Create the program first
      const program = await programModel.createProgram(userId, {
        user_name,
        partner_name,
        children,
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
            const therapyResponse = await chatGPTService.generateCouplesProgram(user_name, partner_name, user_input);
            
            // Convert response to string if it's an object
            const therapyResponseString = typeof therapyResponse === 'object' 
              ? JSON.stringify(therapyResponse) 
              : therapyResponse;
            
            // Update the program with the therapy response
            await programModel.updateTherapyResponse(program.id, therapyResponseString);
            
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
      
      res.status(200).json({
        message: 'Programs retrieved successfully',
        programs
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

      res.status(200).json({
        message: 'Program retrieved successfully',
        program
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

  return router;
}

module.exports = createProgramRoutes;
