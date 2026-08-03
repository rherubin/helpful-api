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
//
// Solo / single-device mode: POST without pairing_id creates a session owned by
// the caller. Prep and other member endpoints work without an accepted pairing.
//
// NOTE: Content generation (building the dynamic prompt + LLM call) is NOT yet
// implemented. The `/generate` endpoint and the auto-trigger on second prep
// completion are stubbed and clearly marked as TODO.
function createPromptSessionRoutes(promptSessionModel, pairingModel, authService = null, pushNotificationService = null) {
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

  // STUB: invoked when prep requirements are met. Real implementation will build
  // the dynamic prompt from prep(s), call the LLM, and persist content via
  // promptSessionModel.saveGeneratedContent / updateGenerationError.
  function triggerGenerationStub(promptSessionId) {
    console.log(`[prompt_sessions] TODO: generation not implemented — prep ready for session ${promptSessionId}.`);
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
        // TODO: kick off real generation here.
        triggerGenerationStub(id);
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

  // Trigger content generation. STUB — not implemented yet.
  router.post('/:id/generate', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;

      const session = await promptSessionModel.getPromptSessionById(id);
      const hasAccess = await promptSessionModel.checkAccess(req.user.id, id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this prompt session' });
      }

      const bothComplete = await promptSessionModel.bothPrepsComplete(id);
      if (!bothComplete) {
        const message = session.pairing_id
          ? 'Both partners must complete prep before generating'
          : 'Prep must be complete before generating';
        return res.status(409).json({ error: message });
      }

      // TODO: implement prompt construction + LLM call, then persist via
      // promptSessionModel.saveGeneratedContent(...). Until then, advertise
      // that this endpoint is not yet implemented.
      return res.status(501).json({
        error: 'Prompt session generation is not implemented yet',
        details: 'The dynamic prompt construction and LLM call still need to be defined. See docs/prompt-sessions-design.md.'
      });
    } catch (error) {
      if (error.message === 'Prompt session not found') {
        return res.status(404).json({ error: error.message });
      }
      console.error('Error generating prompt session content:', error.message);
      return res.status(500).json({ error: 'Failed to generate prompt session content' });
    }
  });

  return router;
}

module.exports = createPromptSessionRoutes;
