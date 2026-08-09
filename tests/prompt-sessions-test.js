const axios = require('axios');

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
      const res = await axios.post(
        `${this.baseURL}/api/prompt-sessions/${soloSessionId}/generate`,
        {},
        this.authHeader(outsider.token)
      );
      this.assert(res.status === 200, 'Solo generate returns 200 after prep', `Status: ${res.status}`);
      const soloBridge = res.data.prompt_session?.bridge_content;
      const soloSession = res.data.prompt_session?.session_content;
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
      const res = await axios.post(
        `${this.baseURL}/api/prompt-sessions/${sessionId}/generate`,
        {},
        this.authHeader(user1.token)
      );
      this.assert(res.status === 200, 'Generate returns 200', `Status: ${res.status}`);
      const session = res.data.prompt_session;
      this.assert(!!session, 'Response includes prompt_session', `keys: ${Object.keys(res.data || {}).join(',')}`);
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

      const genRes = await axios.post(
        `${this.baseURL}/api/prompt-sessions/${sessionId}/generate`,
        {},
        this.authHeader(soloUser.token)
      );
      this.assert(genRes.status === 200, 'Solo generate returns 200', `Status: ${genRes.status}`);
      const gBridge = genRes.data.prompt_session?.bridge_content;
      const gSession = genRes.data.prompt_session?.session_content;
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
