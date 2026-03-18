const express = require('express');
const { createAuthenticateToken } = require('../middleware/auth');

function createProgramRoutes(programModel, chatGPTService, programStepModel = null, userModel = null, pairingModel = null, authService = null, userModelForOrgCode = null) {
  const router = express.Router();
  const authenticateToken = createAuthenticateToken(authService);
  const GENERATION_FOLLOWUP_ENABLED = process.env.PROGRAM_GENERATION_FOLLOWUP_ENABLED !== 'false';
  const GENERATION_FOLLOWUP_DELAY_MS = Number(process.env.PROGRAM_GENERATION_FOLLOWUP_DELAY_MS || 60000);

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  async function hasProgramSteps(programId) {
    if (!programStepModel) return false;
    const steps = await programStepModel.getProgramSteps(programId);
    return Array.isArray(steps) && steps.length > 0;
  }

  async function generateAndPersistProgramContent({ programId, generateResponse, successLogPrefix, forceRegenerate = false }) {
    // If steps already exist and this is not a forced regeneration, treat as already-completed work.
    if (!forceRegenerate && await hasProgramSteps(programId)) {
      console.log(`${successLogPrefix} Program steps already exist, skipping generation for:`, programId);
      return;
    }

    // For forced regeneration, delete existing steps so they can be recreated cleanly.
    if (forceRegenerate && programStepModel && await hasProgramSteps(programId)) {
      console.log(`${successLogPrefix} Force-regenerating: deleting existing steps for program:`, programId);
      await programStepModel.deleteProgramSteps(programId);
    }

    const therapyResponse = await generateResponse();
    const therapyResponseString = typeof therapyResponse === 'object'
      ? JSON.stringify(therapyResponse)
      : therapyResponse;

    // Persist raw response for backward compatibility and diagnostics.
    await programModel.updateTherapyResponse(programId, therapyResponseString);

    if (programStepModel) {
      // Check again to avoid duplicate step creation in rare concurrent trigger races.
      if (!(await hasProgramSteps(programId))) {
        await programStepModel.createProgramSteps(programId, therapyResponseString);
      }
      console.log(`${successLogPrefix} Program steps created for program:`, programId);
    }

    console.log(`${successLogPrefix} ChatGPT response generated and saved for program:`, programId);
  }

  async function runGenerationWithFollowUp({ programId, generateResponse, logPrefix, forceRegenerate = false }) {
    const attemptLogs = [];

    try {
      await generateAndPersistProgramContent({
        programId,
        generateResponse,
        successLogPrefix: logPrefix,
        forceRegenerate
      });
      return;
    } catch (firstError) {
      attemptLogs.push(`attempt_1: ${firstError.message}`);
      console.error(`${logPrefix} Initial generation attempt failed for program ${programId}:`, firstError.message);
    }

    if (GENERATION_FOLLOWUP_ENABLED) {
      try {
        console.log(`${logPrefix} Scheduling follow-up generation attempt in ${GENERATION_FOLLOWUP_DELAY_MS}ms for program:`, programId);
        await sleep(GENERATION_FOLLOWUP_DELAY_MS);

        // For forced regeneration the follow-up should also force; otherwise skip if steps exist.
        if (!forceRegenerate && await hasProgramSteps(programId)) {
          console.log(`${logPrefix} Follow-up skipped; program already has steps:`, programId);
          return;
        }

        await generateAndPersistProgramContent({
          programId,
          generateResponse,
          successLogPrefix: `${logPrefix} [follow-up]`,
          forceRegenerate
        });
        return;
      } catch (followUpError) {
        attemptLogs.push(`attempt_2: ${followUpError.message}`);
        console.error(`${logPrefix} Follow-up generation attempt failed for program ${programId}:`, followUpError.message);
      }
    }

    const combinedError = `Program generation failed after ${GENERATION_FOLLOWUP_ENABLED ? '2 attempts' : '1 attempt'} (${attemptLogs.join(' | ')})`;
    try {
      await programModel.updateGenerationError(programId, combinedError);
    } catch (saveError) {
      console.error(`${logPrefix} Failed to save generation error for program ${programId}:`, saveError.message);
    }
  }

  // Fetch org context and custom prompts for a user.
  // Priority: linked admin org code → user's custom org fields → null.
  async function getCustomPrompts(userId) {
    if (!userModelForOrgCode) return null;
    try {
      const orgCode = await userModelForOrgCode.getUserOrgCode(userId);
      if (orgCode) {
        return {
          initialProgramPrompt: orgCode.initial_program_prompt || null,
          nextProgramPrompt: orgCode.next_program_prompt || null,
          therapyResponsePrompt: orgCode.therapy_response_prompt || null,
          organizationName: orgCode.organization || null,
          organizationCity: orgCode.city || null,
          organizationState: orgCode.state || null
        };
      }

      // No linked admin org — fall back to custom org fields on the user record
      const user = await userModelForOrgCode.getUserById(userId);
      if (user && (user.org_name || user.org_city || user.org_state)) {
        return {
          initialProgramPrompt: null,
          nextProgramPrompt: null,
          therapyResponsePrompt: null,
          organizationName: user.org_name || null,
          organizationCity: user.org_city || null,
          organizationState: user.org_state || null
        };
      }

      return null;
    } catch {
      return null;
    }
  }

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

      // Programs are now always unlocked by default - no unlock check needed

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

      // Validate that user name is set
      if (!userName) {
        return res.status(400).json({
          error: 'User name is required to generate therapy content',
          details: {
            user_name_set: !!userName
          },
          hint: 'Please update your profile with user_name before generating a program'
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
          console.log('Generating next program ChatGPT response for program:', newProgram.id);
          await runGenerationWithFollowUp({
            programId: newProgram.id,
            logPrefix: '[next_program]',
            generateResponse: async () => {
              const customPrompts = await getCustomPrompts(previousProgram.user_id);
              return chatGPTService.generateNextCouplesProgram(
                userName,
                partnerName,
                previousConversationStarters,
                user_input,
                customPrompts
              );
            }
          });
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

      // Validate that user name is set
      if (!userName) {
        return res.status(400).json({
          error: 'User name is required to generate therapy content',
          details: {
            user_name_set: !!userName
          },
          hint: 'Please update your profile with user_name before generating a program'
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
        console.log('Manually generating ChatGPT response for program:', program_id);
        await runGenerationWithFollowUp({
          programId: program_id,
          logPrefix: '[manual_therapy_response]',
          generateResponse: async () => {
            const customPrompts = await getCustomPrompts(program.user_id);
            return chatGPTService.generateCouplesProgram(userName, partnerName, program.user_input, customPrompts);
          }
        });
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

      // Validate that user name is set
      if (!userName) {
        return res.status(400).json({
          error: 'User name is required to generate therapy content',
          details: {
            user_name_set: !!userName
          },
          hint: 'Please update your profile with user_name before generating a program'
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
          console.log('Generating ChatGPT response for program:', program.id);
          await runGenerationWithFollowUp({
            programId: program.id,
            logPrefix: '[create_program]',
            generateResponse: async () => {
              const customPrompts = await getCustomPrompts(userId);
              return chatGPTService.generateCouplesProgram(userName, partnerName, user_input, customPrompts);
            }
          });
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

// Background poller that watches for programs with regenerate_therapy_response = TRUE
// and re-runs generateInitialPrompt for each one, then clears the flag.
function startRegenerationPoller(programModel, programStepModel, chatGPTService, userModel, pairingModel, userModelForOrgCode) {
  const POLL_INTERVAL_MS = Number(process.env.REGENERATION_POLL_INTERVAL_MS || 30000);

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  async function getCustomPromptsForUser(userId) {
    if (!userModelForOrgCode) return null;
    try {
      const orgCode = await userModelForOrgCode.getUserOrgCode(userId);
      if (orgCode) {
        return {
          initialProgramPrompt: orgCode.initial_program_prompt || null,
          nextProgramPrompt: orgCode.next_program_prompt || null,
          therapyResponsePrompt: orgCode.therapy_response_prompt || null,
          organizationName: orgCode.organization || null,
          organizationCity: orgCode.city || null,
          organizationState: orgCode.state || null
        };
      }
      const user = await userModelForOrgCode.getUserById(userId);
      if (user && (user.org_name || user.org_city || user.org_state)) {
        return {
          initialProgramPrompt: null,
          nextProgramPrompt: null,
          therapyResponsePrompt: null,
          organizationName: user.org_name || null,
          organizationCity: user.org_city || null,
          organizationState: user.org_state || null
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async function hasProgramSteps(programId) {
    if (!programStepModel) return false;
    const steps = await programStepModel.getProgramSteps(programId);
    return Array.isArray(steps) && steps.length > 0;
  }

  async function pollOnce() {
    let flaggedPrograms;
    try {
      flaggedPrograms = await programModel.getProgramsFlaggedForRegeneration();
    } catch (err) {
      console.error('[regen_poller] Failed to query flagged programs:', err.message);
      return;
    }

    if (!flaggedPrograms.length) return;

    console.log(`[regen_poller] Found ${flaggedPrograms.length} program(s) flagged for regeneration.`);

    for (const program of flaggedPrograms) {
      // Clear the flag first so a crash mid-generation doesn't cause an infinite loop.
      try {
        await programModel.clearRegenerateFlag(program.id);
      } catch (err) {
        console.error(`[regen_poller] Could not clear flag for program ${program.id}:`, err.message);
        continue;
      }

      console.log(`[regen_poller] Starting regeneration for program:`, program.id);

      // Delete existing steps so they are recreated cleanly.
      if (programStepModel && await hasProgramSteps(program.id)) {
        try {
          await programStepModel.deleteProgramSteps(program.id);
          console.log(`[regen_poller] Deleted existing steps for program:`, program.id);
        } catch (err) {
          console.error(`[regen_poller] Failed to delete steps for program ${program.id}:`, err.message);
          continue;
        }
      }

      // Resolve user names.
      let userName = null;
      let partnerName = null;
      if (userModel) {
        try {
          const user = await userModel.getUserById(program.user_id);
          userName = user.user_name || null;
          partnerName = user.partner_name || null;

          if (program.pairing_id && pairingModel && !user.partner_name) {
            try {
              const pairing = await pairingModel.getPairingById(program.pairing_id);
              const partnerId = pairing.user1_id === program.user_id ? pairing.user2_id : pairing.user1_id;
              if (partnerId) {
                const partner = await userModel.getUserById(partnerId);
                partnerName = partner.user_name || partnerName;
              }
            } catch { /* non-fatal */ }
          }
        } catch (err) {
          console.error(`[regen_poller] Could not fetch user names for program ${program.id}:`, err.message);
        }
      }

      if (!userName) {
        console.error(`[regen_poller] Skipping program ${program.id}: user_name not set.`);
        await programModel.updateGenerationError(program.id, 'Regeneration skipped: user_name not set on account.');
        continue;
      }

      // Run generation (no follow-up for poller-triggered regenerations).
      try {
        const customPrompts = await getCustomPromptsForUser(program.user_id);
        const therapyResponse = await chatGPTService.generateCouplesProgram(userName, partnerName, program.user_input, customPrompts);
        const therapyResponseString = typeof therapyResponse === 'object'
          ? JSON.stringify(therapyResponse)
          : therapyResponse;

        await programModel.updateTherapyResponse(program.id, therapyResponseString);

        if (programStepModel) {
          await programStepModel.createProgramSteps(program.id, therapyResponseString);
        }

        console.log(`[regen_poller] Regeneration complete for program:`, program.id);
      } catch (err) {
        console.error(`[regen_poller] Regeneration failed for program ${program.id}:`, err.message);
        try {
          await programModel.updateGenerationError(program.id, `Regeneration failed: ${err.message}`);
        } catch { /* non-fatal */ }
      }
    }
  }

  async function loop() {
    while (true) {
      await sleep(POLL_INTERVAL_MS);
      try {
        await pollOnce();
      } catch (err) {
        console.error('[regen_poller] Unexpected error in poll loop:', err.message);
      }
    }
  }

  console.log(`[regen_poller] Starting regeneration poller (interval: ${POLL_INTERVAL_MS}ms).`);
  loop();
}

module.exports = { createProgramRoutes, startRegenerationPoller };
