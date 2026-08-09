require('dotenv').config();
const axios = require('axios');
const { getPool } = require('../config/database');
const PromptSessionModel = require('../models/PromptSession');

/**
 * Prompt Sessions ("Sit Sessions") Endpoint Test Suite
 *
 * Exercises the /api/prompt-sessions routes end-to-end:
 *   - solo / single-device: create + prep without pairing_id; one active solo per user
 *   - paired: create with pairing_id (accepted); membership checks; one active per pairing
 *   - pending (non-accepted) pairing: create + prep still allowed for members
 *   - prep submit/merge + completion detection (1 prep solo / 2 prep paired)
 *   - partner prep visibility policy (hidden until BOTH preps complete when paired)
 *   - phase/status PATCH
 *   - generation endpoint (409 before ready; 200 with bridge/session after;
 *     idempotent if already generated)
 *   - generation_prompt never exposed to clients
 *
 * Run with: node tests/prompt-sessions-test.js
 * (Start the server first, e.g. TEST_MOCK_LLM=true npm start)
 */
class PromptSessionsTestRunner {
  constructor(options = {}) {
    this.baseURL = options.baseURL || process.env.TEST_BASE_URL || 'http://127.0.0.1:9000';
    this.timeout = options.timeout || 15000;
    this.testResults = { passed: 0, failed: 0, total: 0 };
    this.testData = {};
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
      info: '📝', pass: '✅', fail: '❌', warn: '⚠️', section: '🧪'
    }[type] || '📝';
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  assert(condition, testName, details = '') {
    this.testResults.total++;
    if (condition) {
      this.testResults.passed++;
      this.log(`${testName} - PASSED ${details}`, 'pass');
    } else {
      this.testResults.failed++;
      this.log(`${testName} - FAILED ${details}`, 'fail');
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // True only for the 409 that means "a generation is in flight, poll for it".
  // Deliberately keyed on `code` rather than the bare 409 status: PREP_NOT_READY
  // is also a 409 but polling for it would hang forever, so a test that sees it
  // where it expects GENERATION_RUNNING should fail loudly instead.
  isGenerationRunning(error) {
    return error?.response?.status === 409 && error?.response?.data?.code === 'GENERATION_RUNNING';
  }

  // Poll GET .../:id until generation.status reaches a terminal state
  // (succeeded or failed), or timeoutMs elapses. Used when an explicit
  // POST .../generate races the fire-and-forget auto-generate trigger and
  // gets a 409 ("already in progress") — the caller falls back to polling,
  // exactly as documented for clients in the README.
  async pollGenerationTerminal(token, sessionId, { timeoutMs = 10000, intervalMs = 250 } = {}) {
    const start = Date.now();
    let last = null;
    while (Date.now() - start < timeoutMs) {
      const res = await axios.get(`${this.baseURL}/api/prompt-sessions/${sessionId}`, this.authHeader(token));
      last = res.data.prompt_session;
      if (last?.generation?.status === 'succeeded' || last?.generation?.status === 'failed') {
        return last;
      }
      await this.sleep(intervalMs);
    }
    return last;
  }

  authHeader(token) {
    return { headers: { Authorization: `Bearer ${token}` }, timeout: this.timeout };
  }

  fullPrep(overrides = {}) {
    // Values align with Sit Session product copy (see HelpfulPromptService.SIT_SESSION_PREP_LINES):
    // gratitude=feeling, energy_level=tank, boundary=closeness, intention=tone,
    // curiosity=topic, bringing_text=free-form.
    return {
      gratitude: 'hopeful and a bit tender',
      energy_level: 'somewhat full',
      boundary: 'somewhat close',
      intention: 'gentle and honest',
      curiosity: 'stay on reconnecting after a hard week',
      bringing_text: 'I want us to leave tonight feeling more on the same team.',
      ...overrides
    };
  }

  async createUser(prefix) {
    const data = {
      email: `${prefix}.${Date.now()}.${Math.random().toString(36).substr(2, 5)}@example.com`,
      first_name: 'PromptSession',
      last_name: prefix,
      password: 'Test1!@#'
    };
    const res = await axios.post(`${this.baseURL}/api/users`, data, { timeout: this.timeout });
    return {
      ...res.data.user,
      token: res.data.access_token,
      refreshToken: res.data.refresh_token
    };
  }

  // Create users + accepted pairing (for paired flow) + pending pairing (for non-accepted flow).
  async setup() {
    this.log('Setting up users, accepted pairing, and pending pairing', 'section');
    try {
      const user1 = await this.createUser('user1');
      const user2 = await this.createUser('user2');
      const outsider = await this.createUser('outsider');
      const pendingUser = await this.createUser('pending');
      this.assert(
        !!user1.token && !!user2.token && !!outsider.token && !!pendingUser.token,
        'Created four test users'
      );

      this.testData.user1 = user1;
      this.testData.user2 = user2;
      this.testData.outsider = outsider;
      this.testData.pendingUser = pendingUser;

      // user1 requests a pairing, user2 accepts.
      const reqRes = await axios.post(`${this.baseURL}/api/pairing/request`, {}, this.authHeader(user1.token));
      const partnerCode = reqRes.data.partner_code;
      this.assert(!!partnerCode, 'Pairing request returned a partner code', `Code: ${partnerCode}`);

      const acceptRes = await axios.post(
        `${this.baseURL}/api/pairing/accept`,
        { partner_code: partnerCode },
        this.authHeader(user2.token)
      );
      this.assert(acceptRes.status === 200, 'Pairing accepted', `Status: ${acceptRes.status}`);

      await this.sleep(500);

      const pairingsRes = await axios.get(`${this.baseURL}/api/pairings`, this.authHeader(user1.token));
      const accepted = (pairingsRes.data.pairings || []).find(p => p.status === 'accepted');
      this.assert(!!accepted, 'Found accepted pairing for user1', accepted ? `ID: ${accepted.id}` : 'none');
      this.testData.pairingId = accepted ? accepted.id : null;

      // Separate user creates a pending (not accepted) pairing for solo-membership tests.
      const pendingReq = await axios.post(
        `${this.baseURL}/api/pairing/request`,
        {},
        this.authHeader(pendingUser.token)
      );
      this.assert(!!pendingReq.data.pairing_id, 'Pending pairing request returns pairing_id', `id: ${pendingReq.data.pairing_id}`);
      this.testData.pendingPairingId = pendingReq.data.pairing_id;

      return !!this.testData.pairingId && !!this.testData.pendingPairingId;
    } catch (error) {
      this.assert(false, 'Setup', `Error: ${error.response?.data?.error || error.message}`);
      return false;
    }
  }

  async testAuthRequired() {
    this.log('Testing authentication is required', 'section');
    try {
      await axios.get(`${this.baseURL}/api/prompt-sessions`, { timeout: this.timeout });
      this.assert(false, 'GET /api/prompt-sessions without token should fail', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 401, 'GET without token returns 401', `Status: ${error.response?.status}`);
    }

    try {
      await axios.post(`${this.baseURL}/api/prompt-sessions`, {}, { timeout: this.timeout });
      this.assert(false, 'POST /api/prompt-sessions without token should fail', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 401, 'POST without token returns 401', `Status: ${error.response?.status}`);
    }
  }

  async testSoloCreateAndPrep() {
    this.log('Testing solo / single-device create + prep (no pairing)', 'section');
    const { outsider } = this.testData;

    let soloSessionId = null;
    try {
      const res = await axios.post(`${this.baseURL}/api/prompt-sessions`, {}, this.authHeader(outsider.token));
      this.assert(res.status === 201, 'Solo create returns 201', `Status: ${res.status}`);
      const session = res.data.prompt_session;
      this.assert(!!session?.id, 'Solo session has id', `ID: ${session?.id}`);
      this.assert(
        session.pairing_id === null || session.pairing_id === undefined,
        'Solo session has null pairing_id',
        `pairing_id: ${session?.pairing_id}`
      );
      this.assert(session.status === 'prep', 'Solo session status is prep', `status: ${session?.status}`);
      this.assert(
        !('generation_prompt' in session),
        'Solo create does not expose generation_prompt',
        `keys: ${Object.keys(session || {}).join(',')}`
      );
      soloSessionId = session.id;
      this.testData.soloSessionId = soloSessionId;
    } catch (error) {
      this.assert(false, 'Solo create', `Error: ${error.response?.data?.error || error.message}`);
      return;
    }

    // Second active solo for same user → 409
    try {
      await axios.post(`${this.baseURL}/api/prompt-sessions`, {}, this.authHeader(outsider.token));
      this.assert(false, 'Second active solo session should fail', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 409, 'Second active solo returns 409', `Status: ${error.response?.status}`);
      if (error.response?.status === 409) {
        this.assert(
          !!error.response.data.prompt_session?.id,
          '409 includes existing solo prompt_session',
          `id: ${error.response.data.prompt_session?.id}`
        );
      }
    }

    // Generate before prep ready → 409
    try {
      await axios.post(
        `${this.baseURL}/api/prompt-sessions/${soloSessionId}/generate`,
        {},
        this.authHeader(outsider.token)
      );
      this.assert(false, 'Solo generate before prep should fail', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 409, 'Solo generate before prep returns 409', `Status: ${error.response?.status}`);
      this.assert(
        error.response?.data?.code === 'PREP_NOT_READY',
        'Solo generate before prep returns code PREP_NOT_READY (not GENERATION_RUNNING)',
        `code: ${error.response?.data?.code}`
      );
    }

    // Partial prep
    try {
      const res = await axios.post(
        `${this.baseURL}/api/prompt-sessions/${soloSessionId}/prep`,
        { bringing_text: 'Partial solo.' },
        this.authHeader(outsider.token)
      );
      this.assert(res.status === 200, 'Solo partial prep returns 200', `Status: ${res.status}`);
      this.assert(res.data.prep.completed === false, 'Solo partial prep not complete', `completed: ${res.data.prep.completed}`);
      this.assert(res.data.both_preps_complete === false, 'Solo both_preps_complete false after partial', `value: ${res.data.both_preps_complete}`);
    } catch (error) {
      this.assert(false, 'Solo partial prep', `Error: ${error.response?.data?.error || error.message}`);
    }

    const soloPrep = this.fullPrep({
      bringing_text: 'Solo bringing.',
      energy_level: 'high',
      intention: 'To reflect alone first.',
      curiosity: 'What do I need tonight?',
      boundary: 'Keep this gentle.',
      gratitude: 'Grateful for quiet time.'
    });

    try {
      const res = await axios.post(
        `${this.baseURL}/api/prompt-sessions/${soloSessionId}/prep`,
        soloPrep,
        this.authHeader(outsider.token)
      );
      this.assert(res.status === 200, 'Solo full prep returns 200', `Status: ${res.status}`);
      this.assert(res.data.prep.completed === true, 'Solo full prep is complete', `completed: ${res.data.prep.completed}`);
      this.assert(
        res.data.both_preps_complete === true,
        'Solo both_preps_complete true after one prep',
        `value: ${res.data.both_preps_complete}`
      );
    } catch (error) {
      this.assert(false, 'Solo full prep', `Error: ${error.response?.data?.error || error.message}`);
    }

    try {
      const res = await axios.get(
        `${this.baseURL}/api/prompt-sessions/${soloSessionId}/prep`,
        this.authHeader(outsider.token)
      );
      this.assert(res.status === 200, 'Solo GET prep returns 200', `Status: ${res.status}`);
      this.assert(res.data.partner_prep === null, 'Solo partner_prep is null', `partner_prep: ${res.data.partner_prep}`);
      this.assert(res.data.both_preps_complete === true, 'Solo GET reports prep ready', `value: ${res.data.both_preps_complete}`);
      this.assert(!!res.data.my_prep?.completed, 'Solo my_prep.completed true', `completed: ${res.data.my_prep?.completed}`);
    } catch (error) {
      this.assert(false, 'Solo GET prep', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Another user cannot access solo session
    try {
      await axios.get(
        `${this.baseURL}/api/prompt-sessions/${soloSessionId}`,
        this.authHeader(this.testData.user1.token)
      );
      this.assert(false, 'Non-creator cannot GET solo session', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 403, 'Non-creator GET solo returns 403', `Status: ${error.response?.status}`);
    }

    try {
      // Auto-generate may already have finished after full prep.
      await this.sleep(300);
      let soloGenerated;
      try {
        const res = await axios.post(
          `${this.baseURL}/api/prompt-sessions/${soloSessionId}/generate`,
          {},
          this.authHeader(outsider.token)
        );
        this.assert(res.status === 200, 'Solo generate returns 200 after prep', `Status: ${res.status}`);
        soloGenerated = res.data.prompt_session;
      } catch (genError) {
        if (this.isGenerationRunning(genError)) {
          // Auto-generate won the race; fall back to polling like a client would.
          soloGenerated = await this.pollGenerationTerminal(outsider.token, soloSessionId);
        } else {
          throw genError;
        }
      }
      const soloBridge = soloGenerated?.bridge_content;
      const soloSession = soloGenerated?.session_content;
      this.assert(
        !!soloBridge && !!soloSession,
        'Solo generate includes bridge + session content',
        `bridge: ${!!soloBridge}, session: ${!!soloSession}`
      );
      this.assert(
        typeof soloBridge?.summary === 'string' && Array.isArray(soloSession?.phases) && soloSession.phases.length === 3,
        'Solo generate uses strict schema',
        `summary?: ${typeof soloBridge?.summary}, phases: ${soloSession?.phases?.length}`
      );
    } catch (error) {
      this.assert(
        false,
        'Solo generate after prep',
        `Status: ${error.response?.status} Error: ${error.response?.data?.error || error.message}`
      );
    }

    try {
      const res = await axios.get(`${this.baseURL}/api/prompt-sessions`, this.authHeader(outsider.token));
      const ids = (res.data.prompt_sessions || []).map(s => s.id);
      this.assert(ids.includes(soloSessionId), 'List includes solo session', `count: ${ids.length}`);
    } catch (error) {
      this.assert(false, 'List includes solo', `Error: ${error.response?.data?.error || error.message}`);
    }

    // PATCH solo session works for creator
    try {
      const res = await axios.patch(
        `${this.baseURL}/api/prompt-sessions/${soloSessionId}`,
        { status: 'abandoned' },
        this.authHeader(outsider.token)
      );
      this.assert(res.status === 200, 'Solo PATCH status returns 200', `Status: ${res.status}`);
      this.assert(res.data.prompt_session.status === 'abandoned', 'Solo session abandoned', `status: ${res.data.prompt_session.status}`);
    } catch (error) {
      this.assert(false, 'Solo PATCH abandon', `Error: ${error.response?.data?.error || error.message}`);
    }

    // After abandon, can create another solo session
    try {
      const res = await axios.post(`${this.baseURL}/api/prompt-sessions`, {}, this.authHeader(outsider.token));
      this.assert(res.status === 201, 'New solo after abandon returns 201', `Status: ${res.status}`);
      this.testData.soloSessionId2 = res.data.prompt_session?.id;
    } catch (error) {
      this.assert(false, 'New solo after abandon', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  async testPendingPairingCreateAndPrep() {
    this.log('Testing create + prep with non-accepted (pending) pairing', 'section');
    const { pendingUser, pendingPairingId } = this.testData;

    let sessionId = null;
    try {
      const res = await axios.post(
        `${this.baseURL}/api/prompt-sessions`,
        { pairing_id: pendingPairingId },
        this.authHeader(pendingUser.token)
      );
      this.assert(res.status === 201, 'Create with pending pairing returns 201', `Status: ${res.status}`);
      this.assert(
        res.data.prompt_session?.pairing_id === pendingPairingId,
        'Session bound to pending pairing',
        `pairing_id: ${res.data.prompt_session?.pairing_id}`
      );
      sessionId = res.data.prompt_session?.id;
      this.testData.pendingSessionId = sessionId;
    } catch (error) {
      this.assert(false, 'Create with pending pairing', `Error: ${error.response?.data?.error || error.message}`);
      return;
    }

    try {
      const res = await axios.post(
        `${this.baseURL}/api/prompt-sessions/${sessionId}/prep`,
        this.fullPrep({ intention: 'Prep while still pending.' }),
        this.authHeader(pendingUser.token)
      );
      this.assert(res.status === 200, 'Prep on pending-pairing session returns 200', `Status: ${res.status}`);
      this.assert(res.data.prep.completed === true, 'Pending-pairing prep is complete', `completed: ${res.data.prep.completed}`);
      // Only one member on pending invite → still needs 2 completed preps for paired sessions
      this.assert(
        res.data.both_preps_complete === false,
        'Pending paired session still requires two preps for both_preps_complete',
        `value: ${res.data.both_preps_complete}`
      );
    } catch (error) {
      this.assert(false, 'Prep on pending pairing session', `Error: ${error.response?.data?.error || error.message}`);
    }

    try {
      const res = await axios.get(
        `${this.baseURL}/api/prompt-sessions/${sessionId}`,
        this.authHeader(pendingUser.token)
      );
      this.assert(res.status === 200, 'Creator can GET pending-pairing session', `Status: ${res.status}`);
    } catch (error) {
      this.assert(false, 'GET pending-pairing session', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Outsider cannot create on this pending pairing
    try {
      await axios.post(
        `${this.baseURL}/api/prompt-sessions`,
        { pairing_id: pendingPairingId },
        this.authHeader(this.testData.outsider.token)
      );
      this.assert(false, 'Outsider create on pending pairing should fail', 'Request unexpectedly succeeded');
    } catch (error) {
      // May be 403 (not member) or 409 (active already exists for pairing if they were member)
      this.assert(
        error.response?.status === 403 || error.response?.status === 409,
        'Outsider create on pending pairing returns 403 or 409',
        `Status: ${error.response?.status}`
      );
    }
  }

  async testCreateValidation() {
    this.log('Testing creation validation + access control', 'section');
    const { user1, outsider, pairingId } = this.testData;

    // Non-member → 403
    try {
      await axios.post(`${this.baseURL}/api/prompt-sessions`, { pairing_id: pairingId }, this.authHeader(outsider.token));
      this.assert(false, 'Create by non-member should fail', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 403, 'Create by non-member returns 403', `Status: ${error.response?.status}`);
    }

    // Unknown pairing → 404
    try {
      await axios.post(`${this.baseURL}/api/prompt-sessions`, { pairing_id: 'does-not-exist-xyz' }, this.authHeader(user1.token));
      this.assert(false, 'Create with unknown pairing should fail', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 404, 'Create with unknown pairing returns 404', `Status: ${error.response?.status}`);
    }
  }

  async testCreateSuccess() {
    this.log('Testing successful paired creation + no prompt leak', 'section');
    const { user1, pairingId } = this.testData;
    try {
      const res = await axios.post(`${this.baseURL}/api/prompt-sessions`, { pairing_id: pairingId }, this.authHeader(user1.token));
      this.assert(res.status === 201, 'Paired create returns 201', `Status: ${res.status}`);

      const session = res.data.prompt_session;
      this.assert(!!session && !!session.id, 'Response includes prompt_session with id', `ID: ${session?.id}`);
      this.assert(session.status === 'prep', 'New session status is "prep"', `Status: ${session?.status}`);
      this.assert(session.pairing_id === pairingId, 'Session bound to the pairing', `pairing_id: ${session?.pairing_id}`);
      this.assert(
        !('generation_prompt' in session),
        'generation_prompt is NOT exposed to clients',
        `keys: ${Object.keys(session).join(',')}`
      );

      this.testData.sessionId = session.id;
    } catch (error) {
      this.assert(false, 'Paired create success', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  async testDuplicateActiveSession() {
    this.log('Testing one-active-session-per-pairing policy', 'section');
    const { user2, pairingId } = this.testData;
    try {
      await axios.post(`${this.baseURL}/api/prompt-sessions`, { pairing_id: pairingId }, this.authHeader(user2.token));
      this.assert(false, 'Second active session should fail', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 409, 'Second active session returns 409', `Status: ${error.response?.status}`);
      if (error.response?.status === 409) {
        this.assert(
          error.response.data.prompt_session?.id === this.testData.sessionId,
          '409 returns the existing active session',
          `id: ${error.response.data.prompt_session?.id}`
        );
      }
    }
  }

  async testGetAndList() {
    this.log('Testing get + list (both partners have access)', 'section');
    const { user1, user2, outsider, sessionId, pairingId } = this.testData;

    try {
      const res = await axios.get(`${this.baseURL}/api/prompt-sessions/${sessionId}`, this.authHeader(user2.token));
      this.assert(res.status === 200, 'Partner can GET session by id', `Status: ${res.status}`);
      this.assert(
        !('generation_prompt' in (res.data.prompt_session || {})),
        'GET by id does not expose generation_prompt',
        `keys: ${Object.keys(res.data.prompt_session || {}).join(',')}`
      );
    } catch (error) {
      this.assert(false, 'Partner GET by id', `Error: ${error.response?.data?.error || error.message}`);
    }

    try {
      await axios.get(`${this.baseURL}/api/prompt-sessions/${sessionId}`, this.authHeader(outsider.token));
      this.assert(false, 'Outsider GET by id should fail', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 403, 'Outsider GET by id returns 403', `Status: ${error.response?.status}`);
    }

    try {
      const res = await axios.get(`${this.baseURL}/api/prompt-sessions`, this.authHeader(user1.token));
      const ids = (res.data.prompt_sessions || []).map(s => s.id);
      this.assert(ids.includes(sessionId), 'List includes the created session', `count: ${ids.length}`);
    } catch (error) {
      this.assert(false, 'List sessions', `Error: ${error.response?.data?.error || error.message}`);
    }

    try {
      const res = await axios.get(`${this.baseURL}/api/prompt-sessions?pairing_id=${pairingId}`, this.authHeader(user2.token));
      this.assert(res.status === 200 && Array.isArray(res.data.prompt_sessions), 'List filtered by pairing_id returns array', `count: ${res.data.prompt_sessions?.length}`);
      const ids = (res.data.prompt_sessions || []).map(s => s.id);
      this.assert(ids.includes(sessionId), 'Filtered list includes session', `ids: ${ids.join(',')}`);
    } catch (error) {
      this.assert(false, 'List by pairing_id', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Outsider cannot list by pairing
    try {
      await axios.get(`${this.baseURL}/api/prompt-sessions?pairing_id=${pairingId}`, this.authHeader(outsider.token));
      this.assert(false, 'Outsider list by pairing should fail', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 403, 'Outsider list by pairing returns 403', `Status: ${error.response?.status}`);
    }
  }

  async testGenerateRequiresBothPreps() {
    this.log('Testing generate is blocked before both preps complete', 'section');
    const { user1, sessionId } = this.testData;
    try {
      await axios.post(`${this.baseURL}/api/prompt-sessions/${sessionId}/generate`, {}, this.authHeader(user1.token));
      this.assert(false, 'Generate before both preps should fail', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 409, 'Generate before both preps returns 409', `Status: ${error.response?.status}`);
      this.assert(
        /both partners|prep/i.test(error.response?.data?.error || ''),
        '409 message mentions prep requirement',
        `error: ${error.response?.data?.error}`
      );
      this.assert(
        error.response?.data?.code === 'PREP_NOT_READY',
        '409 before both preps returns code PREP_NOT_READY (not GENERATION_RUNNING)',
        `code: ${error.response?.data?.code}`
      );
    }
  }

  async testPrepFlow() {
    this.log('Testing prep submit/merge, completion, and visibility policy', 'section');
    const { user1, user2, outsider, sessionId } = this.testData;
    const fullPrep = this.fullPrep();

    try {
      await axios.post(`${this.baseURL}/api/prompt-sessions/${sessionId}/prep`, fullPrep, this.authHeader(outsider.token));
      this.assert(false, 'Outsider prep submit should fail', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 403, 'Outsider prep submit returns 403', `Status: ${error.response?.status}`);
    }

    try {
      const res = await axios.post(
        `${this.baseURL}/api/prompt-sessions/${sessionId}/prep`,
        { bringing_text: 'Just a partial start.' },
        this.authHeader(user1.token)
      );
      this.assert(res.status === 200, 'Partial prep accepted (200)', `Status: ${res.status}`);
      this.assert(res.data.prep.completed === false, 'Partial prep is NOT complete', `completed: ${res.data.prep.completed}`);
      this.assert(res.data.both_preps_complete === false, 'both_preps_complete false after partial', `value: ${res.data.both_preps_complete}`);
    } catch (error) {
      this.assert(false, 'Partial prep', `Error: ${error.response?.data?.error || error.message}`);
    }

    try {
      const res = await axios.post(`${this.baseURL}/api/prompt-sessions/${sessionId}/prep`, fullPrep, this.authHeader(user1.token));
      this.assert(res.data.prep.completed === true, 'User1 full prep is complete', `completed: ${res.data.prep.completed}`);
      this.assert(res.data.both_preps_complete === false, 'both_preps_complete still false (user2 pending)', `value: ${res.data.both_preps_complete}`);
    } catch (error) {
      this.assert(false, 'User1 full prep', `Error: ${error.response?.data?.error || error.message}`);
    }

    try {
      const res = await axios.get(`${this.baseURL}/api/prompt-sessions/${sessionId}/prep`, this.authHeader(user2.token));
      const partner = res.data.partner_prep;
      this.assert(!!partner && partner.completed === true, 'Partner prep shows completed=true', `completed: ${partner?.completed}`);
      this.assert(
        partner && partner.bringing_text === undefined,
        'Partner raw answers hidden until both complete',
        `bringing_text present: ${partner && 'bringing_text' in partner}`
      );
    } catch (error) {
      this.assert(false, 'Partner visibility (pre-complete)', `Error: ${error.response?.data?.error || error.message}`);
    }

    try {
      const res = await axios.post(`${this.baseURL}/api/prompt-sessions/${sessionId}/prep`, {
        ...fullPrep,
        intention: 'To be fully present.'
      }, this.authHeader(user2.token));
      this.assert(res.data.prep.completed === true, 'User2 full prep is complete', `completed: ${res.data.prep.completed}`);
      this.assert(res.data.both_preps_complete === true, 'both_preps_complete true after both submit', `value: ${res.data.both_preps_complete}`);
    } catch (error) {
      this.assert(false, 'User2 full prep', `Error: ${error.response?.data?.error || error.message}`);
    }

    try {
      const res = await axios.get(`${this.baseURL}/api/prompt-sessions/${sessionId}/prep`, this.authHeader(user1.token));
      const partner = res.data.partner_prep;
      this.assert(res.data.both_preps_complete === true, 'both_preps_complete reported true', `value: ${res.data.both_preps_complete}`);
      this.assert(
        !!partner && partner.intention === 'To be fully present.',
        'Partner raw answers revealed once both complete',
        `intention: ${partner?.intention}`
      );
    } catch (error) {
      this.assert(false, 'Partner visibility (post-complete)', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  async testPhasePatch() {
    this.log('Testing PATCH phase/status', 'section');
    const { user1, sessionId } = this.testData;
    try {
      const res = await axios.patch(`${this.baseURL}/api/prompt-sessions/${sessionId}`, { current_phase: 'bridge' }, this.authHeader(user1.token));
      this.assert(res.status === 200, 'PATCH returns 200', `Status: ${res.status}`);
      this.assert(res.data.prompt_session.current_phase === 'bridge', 'current_phase updated', `phase: ${res.data.prompt_session.current_phase}`);
    } catch (error) {
      this.assert(false, 'PATCH phase', `Error: ${error.response?.data?.error || error.message}`);
    }

    try {
      await axios.patch(`${this.baseURL}/api/prompt-sessions/${sessionId}`, { status: 'not-a-status' }, this.authHeader(user1.token));
      this.assert(false, 'PATCH invalid status should fail', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 400, 'PATCH invalid status returns 400', `Status: ${error.response?.status}`);
    }

    // Partner can also patch
    try {
      const res = await axios.patch(
        `${this.baseURL}/api/prompt-sessions/${sessionId}`,
        { current_phase: 'in_session' },
        this.authHeader(this.testData.user2.token)
      );
      this.assert(res.status === 200, 'Partner PATCH returns 200', `Status: ${res.status}`);
      this.assert(res.data.prompt_session.current_phase === 'in_session', 'Partner updated current_phase', `phase: ${res.data.prompt_session.current_phase}`);
    } catch (error) {
      this.assert(false, 'Partner PATCH phase', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  async testGenerateSuccess() {
    this.log('Testing generation once both preps complete', 'section');
    const { user1, sessionId } = this.testData;

    // Auto-generate may already have run after the second prep; allow settle time.
    await this.sleep(500);

    try {
      let session;
      try {
        const res = await axios.post(
          `${this.baseURL}/api/prompt-sessions/${sessionId}/generate`,
          {},
          this.authHeader(user1.token)
        );
        this.assert(res.status === 200, 'Generate returns 200', `Status: ${res.status}`);
        session = res.data.prompt_session;
      } catch (genError) {
        if (this.isGenerationRunning(genError)) {
          session = await this.pollGenerationTerminal(user1.token, sessionId);
          this.assert(!!session, 'Generate 409 fallback: polled session found', `found: ${!!session}`);
        } else {
          throw genError;
        }
      }
      this.assert(!!session, 'Response includes prompt_session', `keys: ${Object.keys(session || {}).join(',')}`);
      this.assert(
        !('generation_prompt' in (session || {})),
        'generation_prompt is NOT exposed after generate',
        `keys: ${Object.keys(session || {}).join(',')}`
      );
      this.assert(
        !!session.bridge_content,
        'bridge_content present after generate',
        `bridge_content: ${JSON.stringify(session.bridge_content)?.slice(0, 80)}`
      );
      this.assert(
        !!session.session_content,
        'session_content present after generate',
        `session_content: ${JSON.stringify(session.session_content)?.slice(0, 80)}`
      );
      const bridge = session.bridge_content;
      const sess = session.session_content;
      this.assert(
        typeof bridge?.summary === 'string' && bridge.summary.length >= 20,
        'bridge_content.summary present',
        `len: ${bridge?.summary?.length}`
      );
      this.assert(
        Array.isArray(bridge?.shared_themes) && bridge.shared_themes.length >= 1,
        'bridge_content.shared_themes is non-empty array',
        `len: ${bridge?.shared_themes?.length}`
      );
      this.assert(
        typeof bridge?.transition === 'string' && bridge.transition.length >= 15,
        'bridge_content.transition present',
        `len: ${bridge?.transition?.length}`
      );
      this.assert(
        typeof sess?.title === 'string' && sess.title.length >= 5,
        'session_content.title present',
        `title: ${sess?.title}`
      );
      this.assert(
        Array.isArray(sess?.phases) && sess.phases.length === 3,
        'session_content.phases has 3 entries',
        `len: ${sess?.phases?.length}`
      );
      this.assert(
        sess.phases.map(p => p.id).join(',') === 'open,deepen,close',
        'phases ordered open,deepen,close',
        `ids: ${sess.phases.map(p => p.id).join(',')}`
      );
      this.assert(
        session.status === 'bridge' || session.status === 'in_session' || session.status === 'prep',
        'status is non-terminal after generate',
        `status: ${session.status}`
      );
      this.assert(
        session.generation?.status === 'succeeded',
        'generation.status is succeeded after generate',
        `generation.status: ${session.generation?.status}`
      );
      this.assert(
        session.generation?.ready === true,
        'generation.ready is true once succeeded with content',
        `generation.ready: ${session.generation?.ready}`
      );
      this.assert(
        session.generation?.error === null,
        'generation.error is null after successful generate',
        `generation.error: ${session.generation?.error}`
      );
      this.assert(
        !!session.generation?.started_at && !!session.generation?.finished_at,
        'generation.started_at and generation.finished_at are set after generate',
        `started_at: ${session.generation?.started_at}, finished_at: ${session.generation?.finished_at}`
      );

      // Idempotent second call
      const res2 = await axios.post(
        `${this.baseURL}/api/prompt-sessions/${sessionId}/generate`,
        {},
        this.authHeader(user1.token)
      );
      this.assert(res2.status === 200, 'Second generate is idempotent (200)', `Status: ${res2.status}`);
      this.assert(
        /already generated|generated successfully/i.test(res2.data.message || ''),
        'Second generate message acknowledges content',
        `message: ${res2.data.message}`
      );
      this.assert(
        res2.data.prompt_session?.generation?.status === 'succeeded',
        'Idempotent second generate keeps generation.status succeeded',
        `generation.status: ${res2.data.prompt_session?.generation?.status}`
      );
    } catch (error) {
      this.assert(
        false,
        'Generate success',
        `Status: ${error.response?.status} Error: ${error.response?.data?.error || error.message}`
      );
    }
  }

  async testSoloGenerate() {
    this.log('Testing solo generate after one complete prep', 'section');
    const { user1 } = this.testData;
    try {
      // Clear any active solo by completing previous if needed — create may 409.
      // Use a fresh user so we do not collide with earlier solo session.
      const soloUser = await this.createUser('sologen');
      // Set a real display name so LLM name validation is happy if used.
      await axios.put(
        `${this.baseURL}/api/users/${soloUser.id}`,
        { user_name: 'SoloGen' },
        this.authHeader(soloUser.token)
      );

      const createRes = await axios.post(
        `${this.baseURL}/api/prompt-sessions`,
        {},
        this.authHeader(soloUser.token)
      );
      this.assert(createRes.status === 201, 'Solo session created for generate test', `Status: ${createRes.status}`);
      const sessionId = createRes.data.prompt_session.id;

      const prepRes = await axios.post(
        `${this.baseURL}/api/prompt-sessions/${sessionId}/prep`,
        this.fullPrep(),
        this.authHeader(soloUser.token)
      );
      this.assert(prepRes.data.both_preps_complete === true, 'Solo prep ready', `value: ${prepRes.data.both_preps_complete}`);

      // The explicit call races the fire-and-forget auto-generate trigger
      // kicked off by the prep response above — either can win the
      // generation_status compare-and-swap. A 200 means this call generated
      // (or found already-generated) content; a 409 means auto-generate got
      // there first, in which case we fall back to polling GET .../:id,
      // exactly as documented for clients.
      let generatedSession;
      try {
        const genRes = await axios.post(
          `${this.baseURL}/api/prompt-sessions/${sessionId}/generate`,
          {},
          this.authHeader(soloUser.token)
        );
        this.assert(genRes.status === 200, 'Solo generate returns 200', `Status: ${genRes.status}`);
        generatedSession = genRes.data.prompt_session;
      } catch (genError) {
        if (this.isGenerationRunning(genError)) {
          this.log('Solo generate got 409 (auto-generate already in progress) — polling GET for final state', 'info');
          generatedSession = await this.pollGenerationTerminal(soloUser.token, sessionId);
          this.assert(!!generatedSession, 'Solo generate 409 fallback: polled session found', `found: ${!!generatedSession}`);
        } else {
          throw genError;
        }
      }

      const gBridge = generatedSession?.bridge_content;
      const gSession = generatedSession?.session_content;
      this.assert(
        !!gBridge && !!gSession,
        'Solo generate has bridge + session content',
        `bridge: ${!!gBridge}, session: ${!!gSession}`
      );
      this.assert(
        typeof gBridge?.summary === 'string' &&
          Array.isArray(gBridge?.shared_themes) &&
          gSession?.phases?.map(p => p.id).join(',') === 'open,deepen,close',
        'Solo generate strict schema',
        `summary?: ${typeof gBridge?.summary}, phases: ${gSession?.phases?.map(p => p.id).join(',')}`
      );
      this.assert(
        generatedSession?.generation?.status === 'succeeded',
        'Solo generate sets generation.status succeeded',
        `generation.status: ${generatedSession?.generation?.status}`
      );
      this.assert(
        generatedSession?.generation?.ready === true,
        'Solo generate sets generation.ready true',
        `generation.ready: ${generatedSession?.generation?.ready}`
      );

      // Quiet unused
      void user1;
    } catch (error) {
      this.assert(
        false,
        'Solo generate',
        `Status: ${error.response?.status} Error: ${error.response?.data?.error || error.message}`
      );
    }
  }

  // Exercises the generation_status state machine end-to-end over HTTP:
  //   idle right after create → concurrent generate calls don't double-run
  //   the LLM → succeeded with ready/started_at/finished_at set → forced
  //   'failed' can be retried (clears generation_error) → a session stuck
  //   'running' rejects a second generate with 409.
  async testGenerationStatusLifecycle() {
    this.log('Testing generation_status state machine (idle/running/succeeded/failed, retry, concurrency)', 'section');

    let genStatusUser;
    let genStatusSessionId;
    try {
      genStatusUser = await this.createUser('genstatus');
      const createRes = await axios.post(`${this.baseURL}/api/prompt-sessions`, {}, this.authHeader(genStatusUser.token));
      const session = createRes.data.prompt_session;
      this.assert(
        session?.generation?.status === 'idle',
        'New session generation.status is idle',
        `status: ${session?.generation?.status}`
      );
      this.assert(
        session?.generation?.ready === false && session?.generation?.error === null,
        'New session generation.ready is false and generation.error is null',
        `ready: ${session?.generation?.ready}, error: ${session?.generation?.error}`
      );
      this.assert(
        session?.generation?.started_at === null && session?.generation?.finished_at === null,
        'New session generation timestamps are null',
        `started_at: ${session?.generation?.started_at}, finished_at: ${session?.generation?.finished_at}`
      );
      genStatusSessionId = session.id;
    } catch (error) {
      this.assert(false, 'Create session for generation-status lifecycle', `Error: ${error.response?.data?.error || error.message}`);
      return;
    }

    // Complete prep, then fire two generate calls back-to-back.
    //
    // Three callers race here, not two: completing prep also kicks off the
    // fire-and-forget auto-generate. With an instant mock LLM whichever one wins
    // can finish before the others are even routed, so they all see 200 and the
    // lock is never exercised. Start the server with TEST_MOCK_LLM_DELAY_MS>=1000
    // to hold the winning call open long enough that the others land mid-flight;
    // then at least one caller must be rejected with 409 GENERATION_RUNNING,
    // which is the property that actually matters — a loser is turned away
    // instead of making a second LLM call. (Which caller wins is not
    // deterministic and doesn't matter: usually auto-generate, in which case
    // both explicit calls get 409.)
    const strictConcurrency = Number(process.env.TEST_MOCK_LLM_DELAY_MS || 0) >= 1000;
    try {
      await axios.post(
        `${this.baseURL}/api/prompt-sessions/${genStatusSessionId}/prep`,
        this.fullPrep(),
        this.authHeader(genStatusUser.token)
      );

      const [res1, res2] = await Promise.allSettled([
        axios.post(`${this.baseURL}/api/prompt-sessions/${genStatusSessionId}/generate`, {}, this.authHeader(genStatusUser.token)),
        axios.post(`${this.baseURL}/api/prompt-sessions/${genStatusSessionId}/generate`, {}, this.authHeader(genStatusUser.token))
      ]);

      const statuses = [res1, res2].map(r => (r.status === 'fulfilled' ? r.value.status : r.reason?.response?.status));
      this.assert(
        statuses.every(s => s === 200 || s === 409),
        'Concurrent generate calls each resolve 200 (generated) or 409 (already in progress)',
        `statuses: ${statuses.join(',')}`
      );

      if (strictConcurrency) {
        this.assert(
          statuses.filter(s => s === 409).length >= 1,
          'With a delayed mock LLM, a concurrent generate is rejected with 409 rather than making a second LLM call',
          `statuses: ${statuses.join(',')} (TEST_MOCK_LLM_DELAY_MS=${process.env.TEST_MOCK_LLM_DELAY_MS})`
        );
        this.assert(
          statuses.filter(s => s === 200).length <= 1,
          'With a delayed mock LLM, at most one concurrent generate returns generated content',
          `statuses: ${statuses.join(',')}`
        );
      } else {
        this.log('TEST_MOCK_LLM_DELAY_MS unset — skipping strict mid-flight concurrency assertions (see comment above)', 'info');
      }

      for (const r of [res1, res2]) {
        if (r.status === 'rejected' && r.reason?.response?.status === 409) {
          this.assert(
            /already in progress/i.test(r.reason.response.data?.error || ''),
            '409 from concurrent generate mentions "already in progress"',
            `error: ${r.reason.response.data?.error}`
          );
          this.assert(
            r.reason.response.data?.code === 'GENERATION_RUNNING',
            '409 from concurrent generate carries code GENERATION_RUNNING',
            `code: ${r.reason.response.data?.code}`
          );
        }
      }
    } catch (error) {
      this.assert(false, 'Concurrent generate calls', `Error: ${error.response?.data?.error || error.message}`);
    }

    try {
      // Whoever won the race may still be mid-flight (guaranteed to be, with a
      // delayed mock), so poll to a terminal state rather than reading once.
      const session = await this.pollGenerationTerminal(genStatusUser.token, genStatusSessionId);
      this.assert(
        session?.generation?.status === 'succeeded',
        'After concurrent generate settles, generation.status is succeeded',
        `status: ${session?.generation?.status}`
      );
      this.assert(
        session?.generation?.ready === true,
        'After concurrent generate settles, generation.ready is true',
        `ready: ${session?.generation?.ready}`
      );
    } catch (error) {
      this.assert(false, 'GET after concurrent generate', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Retry after failed: the mock LLM never fails organically, so force a
    // 'failed' row directly in the DB (documented as an acceptable approach
    // for this suite — see docs/prompt-sessions-design.md), then confirm
    // POST .../generate retries (failed -> running -> succeeded) and clears
    // generation_error.
    try {
      const pool = getPool();
      const forcedError = 'TEST_FORCED_FAILURE: simulated LLM failure for retry-after-failed test';
      await pool.execute(
        `UPDATE prompt_sessions
           SET generation_status = 'failed',
               generation_error = ?,
               bridge_content = NULL,
               session_content = NULL,
               generation_finished_at = NOW()
         WHERE id = ?`,
        [forcedError, genStatusSessionId]
      );

      const failedRes = await axios.get(`${this.baseURL}/api/prompt-sessions/${genStatusSessionId}`, this.authHeader(genStatusUser.token));
      const failedSession = failedRes.data.prompt_session;
      this.assert(
        failedSession?.generation?.status === 'failed' && failedSession?.generation?.error === forcedError,
        'Forced DB row reflects generation_status=failed with generation_error set',
        `status: ${failedSession?.generation?.status}, error: ${failedSession?.generation?.error}`
      );
      this.assert(
        failedSession?.generation?.ready === false,
        'Forced failed session has generation.ready false',
        `ready: ${failedSession?.generation?.ready}`
      );

      const retryRes = await axios.post(
        `${this.baseURL}/api/prompt-sessions/${genStatusSessionId}/generate`,
        {},
        this.authHeader(genStatusUser.token)
      );
      this.assert(retryRes.status === 200, 'Retry generate after failed returns 200', `Status: ${retryRes.status}`);
      const retriedSession = retryRes.data.prompt_session;
      this.assert(
        retriedSession?.generation?.status === 'succeeded',
        'Retry after failed transitions generation.status to succeeded',
        `status: ${retriedSession?.generation?.status}`
      );
      this.assert(
        retriedSession?.generation?.error === null,
        'Retry after failed clears generation_error',
        `error: ${retriedSession?.generation?.error}`
      );
      this.assert(
        !!retriedSession?.bridge_content && !!retriedSession?.session_content,
        'Retry after failed produces bridge/session content',
        `bridge: ${!!retriedSession?.bridge_content}, session: ${!!retriedSession?.session_content}`
      );
    } catch (error) {
      this.assert(
        false,
        'Retry after failed',
        `Status: ${error.response?.status} Error: ${error.response?.data?.error || error.message}`
      );
    }

    // A session stuck 'running' (simulated via DB, since the mock LLM
    // resolves too fast to reliably observe naturally) rejects a second
    // generate with 409, per the concurrency contract.
    try {
      const pool = getPool();
      await pool.execute(
        `UPDATE prompt_sessions
           SET generation_status = 'running',
               generation_started_at = NOW(),
               generation_finished_at = NULL,
               bridge_content = NULL,
               session_content = NULL
         WHERE id = ?`,
        [genStatusSessionId]
      );

      await axios.post(
        `${this.baseURL}/api/prompt-sessions/${genStatusSessionId}/generate`,
        {},
        this.authHeader(genStatusUser.token)
      );
      this.assert(false, 'Generate while generation_status=running should fail', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 409, 'Generate while generation_status=running returns 409', `Status: ${error.response?.status}`);
      this.assert(
        /already in progress/i.test(error.response?.data?.error || ''),
        '409 while running mentions "already in progress"',
        `error: ${error.response?.data?.error}`
      );
      this.assert(
        error.response?.data?.code === 'GENERATION_RUNNING',
        '409 while running carries code GENERATION_RUNNING (distinguishable from PREP_NOT_READY)',
        `code: ${error.response?.data?.code}`
      );
      this.assert(
        error.response?.data?.prompt_session?.generation?.status === 'running',
        '409 while running includes the prompt_session with generation.status running',
        `status: ${error.response?.data?.prompt_session?.generation?.status}`
      );
    } finally {
      // Recover the row from the simulated 'running' state and re-generate so
      // the session ends this test in a normal, content-bearing state.
      try {
        const pool = getPool();
        await pool.execute(
          `UPDATE prompt_sessions SET generation_status = 'idle' WHERE id = ? AND generation_status = 'running'`,
          [genStatusSessionId]
        );
        await axios.post(
          `${this.baseURL}/api/prompt-sessions/${genStatusSessionId}/generate`,
          {},
          this.authHeader(genStatusUser.token)
        );
      } catch {
        // Best-effort cleanup; failure here should not fail the suite.
      }
    }

    // A 'running' row whose worker died is indistinguishable from a live one at
    // the DB level, so the lock is a lease: once generation_started_at is older
    // than PROMPT_SESSION_GENERATION_LEASE_MS, generate may reclaim it. Without
    // this, an interrupted generation would 409 forever and the session could
    // never be recovered through the API.
    try {
      const pool = getPool();
      await pool.execute(
        `UPDATE prompt_sessions
           SET generation_status = 'running',
               generation_started_at = NOW() - INTERVAL 1 DAY,
               generation_finished_at = NULL,
               bridge_content = NULL,
               session_content = NULL,
               generation_error = NULL
         WHERE id = ?`,
        [genStatusSessionId]
      );

      const reclaimRes = await axios.post(
        `${this.baseURL}/api/prompt-sessions/${genStatusSessionId}/generate`,
        {},
        this.authHeader(genStatusUser.token)
      );
      this.assert(
        reclaimRes.status === 200,
        'Generate reclaims an abandoned "running" session past the lease (200, not a permanent 409)',
        `Status: ${reclaimRes.status}`
      );
      this.assert(
        reclaimRes.data.prompt_session?.generation?.status === 'succeeded',
        'Reclaimed abandoned generation completes to succeeded',
        `status: ${reclaimRes.data.prompt_session?.generation?.status}`
      );
    } catch (error) {
      this.assert(
        false,
        'Generate reclaims an abandoned "running" session past the lease',
        `Status: ${error.response?.status} Error: ${error.response?.data?.error || error.message}`
      );
    }

    // Job state is exposed only through the computed `generation` object, so
    // clients have one place to read it and can't drift onto raw columns.
    try {
      const res = await axios.get(`${this.baseURL}/api/prompt-sessions/${genStatusSessionId}`, this.authHeader(genStatusUser.token));
      const session = res.data.prompt_session;
      this.assert(
        session?.generation_status === undefined &&
          session?.generation_started_at === undefined &&
          session?.generation_finished_at === undefined,
        'Raw generation_status/started_at/finished_at columns are not exposed alongside the generation object',
        `keys present: ${['generation_status', 'generation_started_at', 'generation_finished_at'].filter(k => session?.[k] !== undefined).join(',') || 'none'}`
      );
      this.assert(
        session?.generation_prompt === undefined,
        'generation_prompt is still never exposed',
        `generation_prompt: ${session?.generation_prompt}`
      );
    } catch (error) {
      this.assert(false, 'Serialized session omits raw generation columns', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Unit-tests PromptSession model generation_status transitions directly
  // against the DB (no HTTP), covering the compare-and-swap in
  // beginGeneration() that the route layer relies on for concurrency safety.
  async testModelGenerationTransitionsUnit() {
    this.log('Unit-testing PromptSession model generation_status transitions (direct model access)', 'section');
    const createdIds = [];
    try {
      const pool = getPool();
      const model = new PromptSessionModel(pool);
      const ownerId = this.testData.outsider?.id;
      if (!ownerId) {
        this.assert(false, 'Model unit tests setup', 'No outsider user id available from earlier tests');
        return;
      }

      const session = await model.createPromptSession({ createdByUserId: ownerId });
      createdIds.push(session.id);
      this.assert(
        session.generation.status === 'idle',
        'Model: createPromptSession starts generation_status idle',
        `status: ${session.generation.status}`
      );

      const claim1 = await model.beginGeneration(session.id);
      this.assert(!!claim1, 'Model: first beginGeneration() wins the compare-and-swap', `claim1: ${claim1}`);

      const claim2 = await model.beginGeneration(session.id);
      this.assert(claim2 === null, 'Model: second beginGeneration() loses while already running', `claim2: ${claim2}`);

      const runningSession = await model.getPromptSessionById(session.id);
      this.assert(
        runningSession.generation.status === 'running' && !!runningSession.generation.started_at,
        'Model: session is running with started_at set after beginGeneration',
        `status: ${runningSession.generation.status}, started_at: ${runningSession.generation.started_at}`
      );

      await model.saveGeneratedContent(session.id, {
        bridgeContent: {
          summary: 'x'.repeat(25),
          shared_themes: ['unit test theme'],
          transition: 'y'.repeat(20)
        },
        sessionContent: {
          title: 'Model Unit Test Session',
          phases: [
            { id: 'open', prompt: 'p'.repeat(20) },
            { id: 'deepen', prompt: 'p'.repeat(20) },
            { id: 'close', prompt: 'p'.repeat(20) }
          ]
        },
        llmUsed: 'model-unit-test-mock',
        claimId: claim1
      });

      const succeededSession = await model.getPromptSessionById(session.id);
      this.assert(
        succeededSession.generation.status === 'succeeded' && !!succeededSession.generation.finished_at,
        'Model: saveGeneratedContent sets generation_status succeeded + finished_at',
        `status: ${succeededSession.generation.status}, finished_at: ${succeededSession.generation.finished_at}`
      );
      this.assert(
        succeededSession.generation.ready === true,
        'Model: succeeded + valid content => generation.ready true',
        `ready: ${succeededSession.generation.ready}`
      );

      const claimAfterSucceeded = await model.beginGeneration(session.id);
      this.assert(
        claimAfterSucceeded === null,
        'Model: beginGeneration() refuses to restart an already-succeeded session',
        `claim: ${claimAfterSucceeded}`
      );

      // Isolated second session for the failed -> retry transition.
      const session2 = await model.createPromptSession({ createdByUserId: ownerId });
      createdIds.push(session2.id);
      const claimFail = await model.beginGeneration(session2.id);
      await model.updateGenerationError(session2.id, 'Model unit test forced failure', null, claimFail);

      const failedSession = await model.getPromptSessionById(session2.id);
      this.assert(
        failedSession.generation.status === 'failed' && failedSession.generation.error === 'Model unit test forced failure',
        'Model: updateGenerationError sets generation_status failed + generation_error',
        `status: ${failedSession.generation.status}, error: ${failedSession.generation.error}`
      );

      const claimRetry = await model.beginGeneration(session2.id);
      this.assert(!!claimRetry, 'Model: beginGeneration() allows failed -> running retry', `claimRetry: ${claimRetry}`);

      const retriedSession = await model.getPromptSessionById(session2.id);
      this.assert(
        retriedSession.generation.status === 'running' && retriedSession.generation.error === null,
        'Model: retry transition clears generation_error and is running again',
        `status: ${retriedSession.generation.status}, error: ${retriedSession.generation.error}`
      );

      // Lease reclaim: a 'running' row older than the lease is claimable, so a
      // worker that died or wedged cannot hold a session hostage.
      await pool.execute(
        `UPDATE prompt_sessions SET generation_started_at = NOW() - INTERVAL 1 DAY WHERE id = ?`,
        [session2.id]
      );
      const claimExpired = await model.beginGeneration(session2.id);
      this.assert(
        !!claimExpired,
        'Model: beginGeneration() reclaims a running session whose lease has expired',
        `claim: ${claimExpired}`
      );

      // Stale claim token (pre-reclaim) must not mark the reclaimed job failed.
      const lateFailureWhileReclaimed = await model.updateGenerationError(
        session2.id,
        'Late failure from worker whose lease was stolen',
        null,
        claimRetry
      );
      this.assert(
        lateFailureWhileReclaimed.recorded === false,
        'Model: updateGenerationError refuses to fail a row after its lease was reclaimed',
        `recorded: ${lateFailureWhileReclaimed.recorded}`
      );
      const stillRunningAfterStaleFail = await model.getPromptSessionById(session2.id);
      this.assert(
        stillRunningAfterStaleFail.generation.status === 'running',
        'Model: reclaimed session stays running when a stale owner reports failure',
        `status: ${stillRunningAfterStaleFail.generation.status}`
      );

      // Stale save must not overwrite content written by the new owner.
      await model.saveGeneratedContent(session2.id, {
        bridgeContent: {
          summary: 'new owner '.repeat(5),
          shared_themes: ['reclaim theme'],
          transition: 'new owner transition text'
        },
        sessionContent: {
          title: 'Reclaim Owner Session',
          phases: [
            { id: 'open', prompt: 'p'.repeat(20) },
            { id: 'deepen', prompt: 'p'.repeat(20) },
            { id: 'close', prompt: 'p'.repeat(20) }
          ]
        },
        llmUsed: 'reclaim-owner-mock',
        claimId: claimExpired
      });
      let staleSaveLostLease = false;
      let staleSaveAlreadyPresent = false;
      try {
        const staleSave = await model.saveGeneratedContent(session2.id, {
          bridgeContent: {
            summary: 'stale owner '.repeat(5),
            shared_themes: ['stale theme'],
            transition: 'stale owner transition text'
          },
          sessionContent: {
            title: 'Stale Owner Session',
            phases: [
              { id: 'open', prompt: 's'.repeat(20) },
              { id: 'deepen', prompt: 's'.repeat(20) },
              { id: 'close', prompt: 's'.repeat(20) }
            ]
          },
          llmUsed: 'stale-owner-mock',
          claimId: claimRetry
        });
        staleSaveAlreadyPresent = staleSave.saved === false;
      } catch (err) {
        staleSaveLostLease = err.code === 'GENERATION_LEASE_LOST';
      }
      this.assert(
        staleSaveAlreadyPresent || staleSaveLostLease,
        'Model: saveGeneratedContent with a stale claim does not overwrite the new owner',
        `alreadyPresent=${staleSaveAlreadyPresent}, lostLease=${staleSaveLostLease}`
      );
      const afterStaleSave = await model.getPromptSessionById(session2.id);
      this.assert(
        afterStaleSave.session_content?.title === 'Reclaim Owner Session',
        'Model: content after stale save still belongs to the reclaim owner',
        `title: ${afterStaleSave.session_content?.title}`
      );

      // A worker that finally reports failure after another worker already
      // succeeded must not flip a good session back to 'failed'.
      const lateFailure = await model.updateGenerationError(
        session.id,
        'Late failure from a wedged worker',
        null,
        claim1
      );
      this.assert(
        lateFailure.recorded === false,
        'Model: updateGenerationError refuses to overwrite a session that already has content',
        `recorded: ${lateFailure.recorded}`
      );
      const stillSucceeded = await model.getPromptSessionById(session.id);
      this.assert(
        stillSucceeded.generation.status === 'succeeded' && stillSucceeded.generation.error === null,
        'Model: late failure leaves the succeeded session untouched',
        `status: ${stillSucceeded.generation.status}, error: ${stillSucceeded.generation.error}`
      );

      // Startup sweep only touches *expired* leases so multi-instance boot
      // cannot fail a peer's still-live generation. Age the row first.
      const session3 = await model.createPromptSession({ createdByUserId: ownerId });
      createdIds.push(session3.id);
      await model.beginGeneration(session3.id);
      const freshReset = await model.resetStaleRunningGenerations();
      const stillFresh = await model.getPromptSessionById(session3.id);
      this.assert(
        stillFresh.generation.status === 'running',
        'Model: resetStaleRunningGenerations() leaves a fresh (in-lease) running row alone',
        `status: ${stillFresh.generation.status}, resetCount: ${freshReset}`
      );
      await pool.execute(
        `UPDATE prompt_sessions SET generation_started_at = NOW() - INTERVAL 1 DAY WHERE id = ?`,
        [session3.id]
      );
      const resetCount = await model.resetStaleRunningGenerations();
      this.assert(
        resetCount >= 1,
        'Model: resetStaleRunningGenerations() sweeps expired running leases from a dead process',
        `reset: ${resetCount}`
      );
      const sweptSession = await model.getPromptSessionById(session3.id);
      this.assert(
        sweptSession.generation.status === 'failed' && /interrupted/i.test(sweptSession.generation.error || ''),
        'Model: swept session lands on failed with an explanatory, retryable error',
        `status: ${sweptSession.generation.status}, error: ${sweptSession.generation.error}`
      );
      const claimAfterSweep = await model.beginGeneration(session3.id);
      this.assert(
        !!claimAfterSweep,
        'Model: a swept session can be retried immediately',
        `claim: ${claimAfterSweep}`
      );
    } catch (error) {
      this.assert(false, 'Model generation_status unit tests', `Error: ${error.message}`);
    } finally {
      if (createdIds.length > 0) {
        try {
          const pool = getPool();
          await pool.query('DELETE FROM prompt_sessions WHERE id IN (?)', [createdIds]);
        } catch {
          // Best-effort cleanup; failure here should not fail the suite.
        }
      }
    }
  }

  async runAllTests() {
    this.log('🧪 Starting Prompt Sessions Endpoint Test Suite', 'section');
    try {
      const ready = await this.setup();
      if (!ready) {
        this.log('Setup failed, aborting tests', 'fail');
        this.printSummary();
        return false;
      }
      console.log('');
      await this.testAuthRequired();
      console.log('');
      await this.testSoloCreateAndPrep();
      console.log('');
      await this.testPendingPairingCreateAndPrep();
      console.log('');
      await this.testCreateValidation();
      console.log('');
      await this.testCreateSuccess();
      console.log('');
      await this.testDuplicateActiveSession();
      console.log('');
      await this.testGetAndList();
      console.log('');
      await this.testGenerateRequiresBothPreps();
      console.log('');
      await this.testPrepFlow();
      console.log('');
      await this.testPhasePatch();
      console.log('');
      await this.testGenerateSuccess();
      console.log('');
      await this.testSoloGenerate();
      console.log('');
      await this.testGenerationStatusLifecycle();
      console.log('');
      await this.testModelGenerationTransitionsUnit();
      console.log('');

      this.printSummary();
      return this.testResults.failed === 0;
    } catch (error) {
      this.log(`Test suite failed with error: ${error.message}`, 'fail');
      return false;
    }
  }

  printSummary() {
    this.log('📊 Prompt Sessions Test Results Summary', 'section');
    this.log(`Total Tests: ${this.testResults.total}`);
    this.log(`Passed: ${this.testResults.passed}`, this.testResults.passed === this.testResults.total ? 'pass' : 'info');
    this.log(`Failed: ${this.testResults.failed}`, this.testResults.failed === 0 ? 'pass' : 'fail');
    const successRate = this.testResults.total > 0
      ? ((this.testResults.passed / this.testResults.total) * 100).toFixed(1)
      : '0';
    this.log(`Success Rate: ${successRate}%`, successRate === '100.0' ? 'pass' : 'warn');
    if (this.testResults.failed === 0) {
      this.log('🎉 All prompt session tests passed!', 'pass');
    } else {
      this.log('⚠️ Some prompt session tests failed. Review the failures above.', 'fail');
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const testRunner = new PromptSessionsTestRunner();
  testRunner.runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Prompt sessions test runner failed:', error);
    process.exit(1);
  });
}

module.exports = PromptSessionsTestRunner;
