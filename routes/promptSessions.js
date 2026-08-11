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

  // True when Bridge *and* Session content are present — same completeness
  // bar as generation.ready (minus the status check). Either-field alone is
  // partial and must not short-circuit generate as "already done".
  function hasGeneratedContent(session) {
    return !!(session && session.bridge_content && session.session_content);
  }

  // Resolve pairing membership for a session even when the pairing was soft-
  // deleted. Generation still needs both partners' prep answers; live-only
  // lookup would silently drop Partner B after unpair.
  async function loadPairingForGeneration(pairingId) {
    try {
      return await loadPairing(pairingId);
    } catch {
      // Soft-deleted (or momentarily missing) pairing: fall through.
    }
    if (typeof pairingModel.getPairingByIdIncludingDeleted === 'function') {
      try {
        return await pairingModel.getPairingByIdIncludingDeleted(pairingId);
      } catch {
        return null;
      }
    }
    return null;
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
      const pairing = await loadPairingForGeneration(session.pairing_id);
      if (pairing) {
        const otherId = partnerIdFor(pairing, creatorId);
        if (otherId) {
          partnerUserIds = [creatorId, otherId];
        }
      } else {
        // Pairing row gone entirely: still include every other completed prep
        // so we never discard answers that bothPrepsComplete already counted.
        for (const prep of completedPreps) {
          if (prep.user_id !== creatorId && !partnerUserIds.includes(prep.user_id)) {
            partnerUserIds.push(prep.user_id);
          }
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
    // Paired sessions must not silently degrade to a single-prep generate when
    // the second completed prep exists but membership resolution failed.
    if (session.pairing_id && completedPreps.length >= 2 && partners.length < 2) {
      throw new Error('Paired Sit Session generation requires both partners\' completed preps');
    }
    return partners;
  }

  // Run LLM generation and persist bridge/session (or generation_error).
  // Returns the refreshed session row. Throws on hard failures after error is
  // stored. Shared by the explicit POST /:id/generate route and the
  // fire-and-forget auto-generate trigger, so both paths drive the exact same
  // generation_status state machine (idle/pending/failed -> running ->
  // succeeded|failed) and polling clients see the same transitions either way.
  //
  // Concurrency: the idle/failed -> running transition is a compare-and-swap
  // (promptSessionModel.beginGeneration), so only one caller can ever be
  // mid-flight for a given session — a second caller gets a
  // GENERATION_RUNNING error (mapped to 409 by the route) instead of also
  // calling the LLM. The claim token from beginGeneration is threaded into
  // success/failure writes so a reclaimed lease cannot corrupt the new owner.
  async function runGeneration(promptSessionId) {
    if (!helpfulPromptService || !helpfulPromptService.isConfigured()) {
      const err = new Error('LLM service is not configured - set OPENAI_API_KEY');
      err.code = 'LLM_NOT_CONFIGURED';
      throw err;
    }

    let session = await promptSessionModel.getPromptSessionById(promptSessionId);
    if (hasGeneratedContent(session) || session.generation?.status === 'succeeded') {
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

    const claimId = await promptSessionModel.beginGeneration(promptSessionId);
    if (!claimId) {
      // Someone else is already running, or finished between our read above
      // and now — re-read and decide which of those it was.
      session = await promptSessionModel.getPromptSessionById(promptSessionId);
      if (hasGeneratedContent(session) || session.generation?.status === 'succeeded') {
        return session;
      }
      const err = new Error('Generation already in progress');
      err.code = 'GENERATION_RUNNING';
      // Carried so the route can return the same body shape as its own
      // pre-flight 409 check (error + code + prompt_session).
      err.promptSession = session;
      throw err;
    }

    // Everything below runs while we hold the 'running' lock, so every exit
    // path must land on a terminal status *for this claim*. Anything that
    // throws in here — including buildPartnersForGeneration's DB reads —
    // has to go through updateGenerationError with claimId, or the
    // row can stay 'running' until the lease expires.
    const startedAt = Date.now();
    let generationPrompt = null;

    // If another worker already finished, return that session as success
    // instead of recording failure / throwing 500 GENERATION_FAILED.
    async function sessionIfAlreadySucceeded() {
      try {
        const current = await promptSessionModel.getPromptSessionById(promptSessionId);
        if (hasGeneratedContent(current) || current?.generation?.status === 'succeeded') {
          return current;
        }
      } catch {
        // Fall through — caller will surface the original error.
      }
      return null;
    }

    try {
      const partners = await buildPartnersForGeneration(session);
      const result = await helpfulPromptService.generateSitSessionContent(partners);
      generationPrompt = result && result.__prompt ? result.__prompt : null;
      const secondsToGenerate = (Date.now() - startedAt) / 1000;

      await promptSessionModel.saveGeneratedContent(promptSessionId, {
        bridgeContent: result.bridge || null,
        sessionContent: result.session || null,
        generationPrompt,
        llmUsed: helpfulPromptService.model || null,
        secondsToGenerate,
        status: 'bridge',
        claimId
      });

      return promptSessionModel.getPromptSessionById(promptSessionId);
    } catch (error) {
      if (error && error.__prompt) {
        generationPrompt = error.__prompt;
      }

      const alreadyDone = await sessionIfAlreadySucceeded();
      if (alreadyDone) {
        return alreadyDone;
      }

      // Lost-lease without content: do not mark failed (that would belong to
      // the new owner). Surface GENERATION_RUNNING so the client polls.
      if (error && error.code === 'GENERATION_LEASE_LOST') {
        session = await promptSessionModel.getPromptSessionById(promptSessionId);
        if (hasGeneratedContent(session) || session?.generation?.status === 'succeeded') {
          return session;
        }
        const runningErr = new Error('Generation already in progress');
        runningErr.code = 'GENERATION_RUNNING';
        runningErr.promptSession = session;
        throw runningErr;
      }

      try {
        await promptSessionModel.updateGenerationError(
          promptSessionId,
          error.message || 'Failed to generate Sit Session content',
          generationPrompt,
          claimId
        );
      } catch (persistErr) {
        console.warn('[prompt_sessions] Failed to persist generation_error:', persistErr.message);
      }

      // Another worker may have succeeded while we were writing the error.
      const racedSuccess = await sessionIfAlreadySucceeded();
      if (racedSuccess) {
        return racedSuccess;
      }

      throw error;
    }
  }

  // Fire-and-forget when prep becomes ready (does not block the prep response).
  // Shares runGeneration's state machine with the explicit generate route, so
  // a client polling GET /:id sees the same idle -> running -> succeeded|failed
  // transitions regardless of which path started the job.
  function triggerGenerationInBackground(promptSessionId) {
    if (!helpfulPromptService || !helpfulPromptService.isConfigured()) {
      console.log(`[prompt_sessions] Prep ready for ${promptSessionId}; LLM not configured — skip auto-generate.`);
      return;
    }
    runGeneration(promptSessionId)
      .then((session) => {
        console.log(`[prompt_sessions] Auto-generation finished for ${promptSessionId}, status=${session?.status}, generation_status=${session?.generation?.status}`);
      })
      .catch((err) => {
        if (err.code === 'GENERATION_RUNNING') {
          console.log(`[prompt_sessions] Auto-generation for ${promptSessionId} skipped — already running (explicit generate likely won the race).`);
          return;
        }
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
        // Include soft-deleted pairings so the creator can still see partner
        // answers after unpair once both preps were completed.
        pairing = await loadPairingForGeneration(session.pairing_id);
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
  //
  // State machine (generation_status): idle | pending | running | succeeded | failed.
  //   - Already succeeded / content present → 200 with the existing session (idempotent; no LLM call).
  //   - Already running (this call or the auto-generate background trigger) → 409 GENERATION_RUNNING.
  //   - idle or failed → running → succeeded|failed (failed sessions can be retried this way).
  //
  // Both 409s carry a machine-readable `code` because they mean opposite
  // things to a client: GENERATION_RUNNING means "poll GET, it's coming",
  // PREP_NOT_READY means "collect more prep first, polling will never help".
  router.post('/:id/generate', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;

      const session = await promptSessionModel.getPromptSessionById(id);
      const hasAccess = await promptSessionModel.checkAccess(req.user.id, id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Not authorized to access this prompt session' });
      }

      if (hasGeneratedContent(session) || session.generation?.status === 'succeeded') {
        return res.status(200).json({
          message: 'Prompt session content already generated',
          prompt_session: session
        });
      }

      // Note: "already running" is deliberately NOT checked here. That
      // decision belongs to the beginGeneration compare-and-swap inside
      // runGeneration, which is also the only thing that knows whether a
      // 'running' row still holds a live lease or has been abandoned by a
      // wedged worker. Checking it here would shadow the lease and make
      // abandoned sessions permanently un-retryable.
      const bothComplete = await promptSessionModel.bothPrepsComplete(id);
      if (!bothComplete) {
        const message = session.pairing_id
          ? 'Both partners must complete prep before generating'
          : 'Prep must be complete before generating';
        return res.status(409).json({ error: message, code: 'PREP_NOT_READY' });
      }

      if (!helpfulPromptService || !helpfulPromptService.isConfigured()) {
        return res.status(503).json({
          error: 'LLM service is not configured',
          code: 'LLM_NOT_CONFIGURED',
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
        return res.status(404).json({ error: error.message, code: 'NOT_FOUND' });
      }
      if (error.code === 'PREP_NOT_READY') {
        return res.status(409).json({ error: error.message, code: 'PREP_NOT_READY' });
      }
      if (error.code === 'GENERATION_RUNNING') {
        const body = { error: 'Generation already in progress', code: 'GENERATION_RUNNING' };
        if (error.promptSession) {
          body.prompt_session = error.promptSession;
        }
        return res.status(409).json(body);
      }
      if (error.code === 'LLM_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'LLM service is not configured',
          code: 'LLM_NOT_CONFIGURED',
          details: 'Set OPENAI_API_KEY (or TEST_MOCK_LLM=true for tests) to enable Sit Session generation.'
        });
      }
      console.error('Error generating prompt session content:', error.message);
      return res.status(500).json({
        error: 'Failed to generate prompt session content',
        code: 'GENERATION_FAILED'
      });
    }
  });

  return router;
}

module.exports = createPromptSessionRoutes;
