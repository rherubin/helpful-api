const express = require('express');
const { createAuthenticateToken } = require('../middleware/auth');
const PromptSession = require('../models/PromptSession');

// Routes for "Sit Sessions" (internally `prompt_sessions`).
//
// Dependencies are injected via this factory (see service-injection-convention):
//   - promptSessionModel:       required
//   - pairingModel:             required (membership / access checks when paired)
//   - authService:              for token refresh in auth middleware
//   - pushNotificationService:  optional (partner notifications)
//   - helpfulPromptService:     optional (Sit Session LLM generation)
//   - userModel:                optional (partner display names for generation)
//
// Solo / single-device mode: POST without pairing_id creates a session owned by
// the caller. Prep and other member endpoints work without an accepted pairing.
//
// Generation: POST /:id/generate builds a prompt from completed prep(s) via
// HelpfulPromptService.generateSitSessionContent and persists bridge/session
// content. When prep becomes ready, generation is also kicked off in the
// background (fire-and-forget).
function createPromptSessionRoutes(
  promptSessionModel,
  pairingModel,
  authService = null,
  pushNotificationService = null,
  helpfulPromptService = null,
  userModel = null
) {
  const router = express.Router();
  const authenticateToken = createAuthenticateToken(authService);

  // Resolve a pairing and whether the user is a member. Throws 'Pairing not found'
  // (mapped to 404 by callers) when the pairing does not exist.
  async function loadPairing(pairingId) {
    return pairingModel.getPairingById(pairingId);
  }

  function partnerIdFor(pairing, userId) {
    if (!pairing) return null;
    return pairing.user1_id === userId ? pairing.user2_id : pairing.user1_id;
  }

  function displayNameForUser(user, fallback) {
    if (!user) return fallback;
    const name = (user.user_name || '').trim();
    if (name) return name;
    if (user.email) {
      const local = String(user.email).split('@')[0];
      if (local) return local;
    }
    return fallback;
  }

  // True when Bridge/Session content has already been persisted.
  function hasGeneratedContent(session) {
    return !!(session && (session.bridge_content || session.session_content));
  }

  // Build partners[] for HelpfulPromptService from session + completed preps.
  // Creator is Partner A; when paired, the other member is Partner B.
  async function buildPartnersForGeneration(session) {
    const preps = await promptSessionModel.getPreps(session.id);
    const completedPreps = preps.filter(p => p.completed);
    if (completedPreps.length === 0) {
      throw new Error('No completed preps available for generation');
    }

    const prepByUserId = new Map(completedPreps.map(p => [p.user_id, p]));

    const creatorId = session.created_by_user_id;
    let partnerUserIds = [creatorId];

    if (session.pairing_id) {
      let pairing = null;
      try {
        pairing = await loadPairing(session.pairing_id);
      } catch {
        pairing = null;
      }
      if (pairing) {
        const otherId = partnerIdFor(pairing, creatorId);
        if (otherId) {
          partnerUserIds = [creatorId, otherId];
        }
      }
    }

    // Solo: only the creator's prep. Paired: both members in A/B order.
    const partners = [];
    for (let i = 0; i < partnerUserIds.length; i++) {
      const userId = partnerUserIds[i];
      const prep = prepByUserId.get(userId);
      if (!prep) {
        // Paired but one prep missing should not happen when bothPrepsComplete.
        continue;
      }
      let user = null;
      if (userModel) {
        try {
          user = await userModel.getUserById(userId);
        } catch {
          user = null;
        }
      }
      const fallback = i === 0 ? 'Partner A' : 'Partner B';
      partners.push({
        name: displayNameForUser(user, fallback),
        prep
      });
    }

    if (partners.length === 0) {
      throw new Error('No completed preps available for generation');
    }
    return partners;
  }

  // Run LLM generation and persist bridge/session (or generation_error).
  // Returns the refreshed session row. Throws on hard failures after error is stored.
  async function runGeneration(promptSessionId) {
    if (!helpfulPromptService || !helpfulPromptService.isConfigured()) {
      const err = new Error('LLM service is not configured - set OPENAI_API_KEY');
      err.code = 'LLM_NOT_CONFIGURED';
      throw err;
    }

    const session = await promptSessionModel.getPromptSessionById(promptSessionId);
    if (hasGeneratedContent(session)) {
      return session;
    }

    const bothComplete = await promptSessionModel.bothPrepsComplete(promptSessionId);
    if (!bothComplete) {
      const err = new Error(session.pairing_id
        ? 'Both partners must complete prep before generating'
        : 'Prep must be complete before generating');
      err.code = 'PREP_NOT_READY';
      throw err;
    }

    const partners = await buildPartnersForGeneration(session);
    const startedAt = Date.now();
    let generationPrompt = null;

    try {
      const result = await helpfulPromptService.generateSitSessionContent(partners);
      generationPrompt = result && result.__prompt ? result.__prompt : null;
      const secondsToGenerate = (Date.now() - startedAt) / 1000;

      await promptSessionModel.saveGeneratedContent(promptSessionId, {
        bridgeContent: result.bridge || null,
        sessionContent: result.session || null,
        generationPrompt,
        llmUsed: helpfulPromptService.model || null,
        secondsToGenerate,
        status: 'bridge'
      });

      return promptSessionModel.getPromptSessionById(promptSessionId);
    } catch (error) {
      if (error && error.__prompt) {
        generationPrompt = error.__prompt;
      }
      try {
        await promptSessionModel.updateGenerationError(
          promptSessionId,
          error.message || 'Failed to generate Sit Session content',
          generationPrompt
        );
      } catch (persistErr) {
        console.warn('[prompt_sessions] Failed to persist generation_error:', persistErr.message);
      }
      throw error;
    }
  }

  // Fire-and-forget when prep becomes ready (does not block the prep response).
  function triggerGenerationInBackground(promptSessionId) {
    if (!helpfulPromptService || !helpfulPromptService.isConfigured()) {
      console.log(`[prompt_sessions] Prep ready for ${promptSessionId}; LLM not configured — skip auto-generate.`);
      return;
    }
    runGeneration(promptSessionId)
      .then((session) => {
        console.log(`[prompt_sessions] Auto-generation finished for ${promptSessionId}, status=${session?.status}`);
      })
      .catch((err) => {
        console.warn(`[prompt_sessions] Auto-generation failed for ${promptSessionId}:`, err.message);
      });
  }

  // Create a prompt session. pairing_id is optional (solo / single-device mode).
  // When provided, caller must be a pairing member; status need not be accepted.
  router.post('/', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const { pairing_id } = req.body;

      let pairing = null;

      if (pairing_id) {
        try {
          pairing = await loadPairing(pairing_id);
        } catch (err) {
          return res.status(404).json({ error: 'Pairing not found' });
        }

        const isMember = pairing.user1_id === userId || pairing.user2_id === userId;
        if (!isMember) {
          return res.status(403).json({ error: 'Not authorized to create a prompt session for this pairing' });
        }

        // Policy: only one non-terminal prompt session per pairing at a time.
        const active = await promptSessionModel.getActiveSessionForPairing(pairing_id);
        if (active) {
          return res.status(409).json({
            error: 'An active prompt session already exists for this pairing',
            prompt_session: active
          });
        }
      } else {
        // Solo: only one active unpaired session per user.
        const activeSolo = await promptSessionModel.getActiveSoloSessionForUser(userId);
        if (activeSolo) {
          return res.status(409).json({
            error: 'An active solo prompt session already exists',
            prompt_session: activeSolo
          });
        }
      }

      const session = await promptSessionModel.createPromptSession({
        pairingId: pairing_id || null,
        createdByUserId: userId
      });

      res.status(201).json({
        message: 'Prompt session created',
        prompt_session: session
      });

      // Notify the partner when a paired session is started (if they exist).
      const partnerId = partnerIdFor(pairing, userId);
      if (pushNotificationService && partnerId) {
        pushNotificationService.sendToUser(partnerId, {
          title: 'New Sit Session',
          body: 'Your partner started a Sit Session. Complete your prep to begin.',
          data: { kind: 'prompt_session_created', prompt_session_id: session.id }
        }).catch(err => console.warn('[push] prompt_session_created failed:', err.message));
      }
    } catch (error) {
      console.error('Error creating prompt session:', error.message);
      return res.status(500).json({ error: 'Failed to create prompt session' });
    }
  });

  // List the caller's prompt sessions (optionally filtered by pairing).
  router.get('/', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const { pairing_id } = req.query;

      let sessions;
      if (pairing_id) {
        let pairing;
        try {
          pairing = await loadPairing(pairing_id);
        } catch (err) {
          return res.status(404).json({ error: 'Pairing not found' });
        }
        const isMember = pairing.user1_id === userId || pairing.user2_id === userId;
        if (!isMember) {
          return res.status(403).json({ error: 'Not authorized to access this pairing' });
        }
        sessions = await promptSessionModel.getPromptSessionsForPairing(pairing_id);
      } else {
        sessions = await promptSessionModel.getPromptSessionsForUser(userId);
      }

      res.status(200).json({
        message: 'Prompt sessions retrieved successfully',
        prompt_sessions: sessions
      });
    } catch (error) {
      console.error('Error fetching prompt sessions:', error.message);
      return res.status(500).json({ error: 'Failed to fetch prompt sessions' });
    }
  });

  // Get a single prompt session.
  router.get('/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const session = await promptSessionModel.getPromptSessionById(id);

      const hasAccess = await promptSessionModel.checkAccess(req.user.id, id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this prompt session' });
      }

      res.status(200).json({
        message: 'Prompt session retrieved successfully',
        prompt_session: session
      });
    } catch (error) {
      if (error.message === 'Prompt session not found') {
        return res.status(404).json({ error: error.message });
      }
      console.error('Error fetching prompt session:', error.message);
      return res.status(500).json({ error: 'Failed to fetch prompt session' });
    }
  });

  // Submit or update the caller's prep answers.
  router.post('/:id/prep', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Ensure the session exists (404) before access checks (403).
      await promptSessionModel.getPromptSessionById(id);

      const hasAccess = await promptSessionModel.checkAccess(userId, id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this prompt session' });
      }

      // Keep only recognized prep fields from the body.
      const answers = {};
      for (const field of PromptSession.PREP_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(req.body, field)) {
          answers[field] = req.body[field];
        }
      }

      const prep = await promptSessionModel.upsertPrep({ promptSessionId: id, userId, answers });
      const bothComplete = await promptSessionModel.bothPrepsComplete(id);

      res.status(200).json({
        message: 'Prep saved successfully',
        prep,
        both_preps_complete: bothComplete
      });

      // Resolve pairing for notifications / partner id (optional).
      const session = await promptSessionModel.getPromptSessionById(id);
      let pairing = null;
      if (session.pairing_id) {
        try {
          pairing = await loadPairing(session.pairing_id);
        } catch { /* non-fatal */ }
      }
      const partnerId = partnerIdFor(pairing, userId);

      if (bothComplete) {
        triggerGenerationInBackground(id);
      } else if (prep.completed && pushNotificationService && partnerId) {
        // My prep is done but my partner's is not — nudge them.
        pushNotificationService.sendToUser(partnerId, {
          title: 'Your partner finished prep',
          body: 'Complete your prep to start your Sit Session together.',
          data: { kind: 'prompt_session_prep_complete', prompt_session_id: id }
        }).catch(err => console.warn('[push] prompt_session_prep_complete failed:', err.message));
      }
    } catch (error) {
      if (error.message === 'Prompt session not found') {
        return res.status(404).json({ error: error.message });
      }
      console.error('Error saving prep:', error.message);
      return res.status(500).json({ error: 'Failed to save prep' });
    }
  });

  // Get the caller's prep plus the partner's completion status. Partner's raw
  // answers are only revealed once BOTH preps are complete (visibility policy).
  // Solo sessions have no partner_prep.
  router.get('/:id/prep', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const session = await promptSessionModel.getPromptSessionById(id);

      const hasAccess = await promptSessionModel.checkAccess(userId, id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this prompt session' });
      }

      const myPrep = await promptSessionModel.getPrep(id, userId);
      const bothComplete = await promptSessionModel.bothPrepsComplete(id);

      let pairing = null;
      if (session.pairing_id) {
        try {
          pairing = await loadPairing(session.pairing_id);
        } catch { /* non-fatal */ }
      }
      const partnerId = partnerIdFor(pairing, userId);

      let partnerPrep = null;
      if (partnerId) {
        const rawPartnerPrep = await promptSessionModel.getPrep(id, partnerId);
        if (bothComplete) {
          partnerPrep = rawPartnerPrep; // reveal full answers
        } else {
          // Only expose completion status until both are done.
          partnerPrep = {
            user_id: partnerId,
            completed: !!(rawPartnerPrep && rawPartnerPrep.completed),
            completed_at: rawPartnerPrep ? rawPartnerPrep.completed_at : null
          };
        }
      }

      res.status(200).json({
        message: 'Prep retrieved successfully',
        my_prep: myPrep,
        partner_prep: partnerPrep,
        both_preps_complete: bothComplete
      });
    } catch (error) {
      if (error.message === 'Prompt session not found') {
        return res.status(404).json({ error: error.message });
      }
      console.error('Error fetching prep:', error.message);
      return res.status(500).json({ error: 'Failed to fetch prep' });
    }
  });

  // Update phase / status (member-only). Lightweight phase advancement.
  router.patch('/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { current_phase, status } = req.body;

      await promptSessionModel.getPromptSessionById(id);
      const hasAccess = await promptSessionModel.checkAccess(req.user.id, id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this prompt session' });
      }

      if (status !== undefined) {
        if (!PromptSession.ALL_STATUSES.includes(status)) {
          return res.status(400).json({
            error: `Invalid status. Must be one of: ${PromptSession.ALL_STATUSES.join(', ')}`
          });
        }
        await promptSessionModel.updateStatus(id, status);
      }

      if (current_phase !== undefined) {
        await promptSessionModel.updatePhase(id, current_phase);
      }

      const updated = await promptSessionModel.getPromptSessionById(id);
      res.status(200).json({
        message: 'Prompt session updated successfully',
        prompt_session: updated
      });
    } catch (error) {
      if (error.message === 'Prompt session not found') {
        return res.status(404).json({ error: error.message });
      }
      console.error('Error updating prompt session:', error.message);
      return res.status(500).json({ error: 'Failed to update prompt session' });
    }
  });

  // Trigger content generation from completed prep(s).
  // Idempotent: if bridge/session content already exists, returns it (200).
  router.post('/:id/generate', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;

      const session = await promptSessionModel.getPromptSessionById(id);
      const hasAccess = await promptSessionModel.checkAccess(req.user.id, id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this prompt session' });
      }

      if (hasGeneratedContent(session)) {
        return res.status(200).json({
          message: 'Prompt session content already generated',
          prompt_session: session
        });
      }

      const bothComplete = await promptSessionModel.bothPrepsComplete(id);
      if (!bothComplete) {
        const message = session.pairing_id
          ? 'Both partners must complete prep before generating'
          : 'Prep must be complete before generating';
        return res.status(409).json({ error: message });
      }

      if (!helpfulPromptService || !helpfulPromptService.isConfigured()) {
        return res.status(503).json({
          error: 'LLM service is not configured',
          details: 'Set OPENAI_API_KEY (or TEST_MOCK_LLM=true for tests) to enable Sit Session generation.'
        });
      }

      const updated = await runGeneration(id);
      return res.status(200).json({
        message: 'Prompt session content generated successfully',
        prompt_session: updated
      });
    } catch (error) {
      if (error.message === 'Prompt session not found') {
        return res.status(404).json({ error: error.message });
      }
      if (error.code === 'PREP_NOT_READY') {
        return res.status(409).json({ error: error.message });
      }
      if (error.code === 'LLM_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'LLM service is not configured',
          details: 'Set OPENAI_API_KEY (or TEST_MOCK_LLM=true for tests) to enable Sit Session generation.'
        });
      }
      console.error('Error generating prompt session content:', error.message);
      return res.status(500).json({ error: 'Failed to generate prompt session content' });
    }
  });

  return router;
}

module.exports = createPromptSessionRoutes;
