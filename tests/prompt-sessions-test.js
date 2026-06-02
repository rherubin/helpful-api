const axios = require('axios');

/**
 * Prompt Sessions ("Sit Sessions") Endpoint Test Suite
 *
 * Exercises the /api/prompt-sessions routes end-to-end:
 *   - creation validation + access control (membership / accepted pairing)
 *   - one-active-session-per-pairing policy
 *   - prep submit/merge + completion detection
 *   - partner prep visibility policy (hidden until BOTH preps complete)
 *   - phase/status PATCH
 *   - generation endpoint stub behavior (409 before both preps, 501 after)
 *   - that generation_prompt is never exposed to clients
 *
 * Run with: node tests/prompt-sessions-test.js
 * (Start the server first, e.g. TEST_MOCK_LLM=true npm start)
 */
class PromptSessionsTestRunner {
  constructor(options = {}) {
    this.baseURL = options.baseURL || 'http://127.0.0.1:9000';
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

  // Create two users, pair them (request + accept), and resolve the pairing id.
  async setup() {
    this.log('Setting up users + accepted pairing', 'section');
    try {
      const user1 = await this.createUser('user1');
      const user2 = await this.createUser('user2');
      const outsider = await this.createUser('outsider');
      this.assert(!!user1.token && !!user2.token && !!outsider.token, 'Created three test users');

      this.testData.user1 = user1;
      this.testData.user2 = user2;
      this.testData.outsider = outsider;

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

      await this.sleep(1000);

      // Resolve the accepted pairing id from user1's pairings list.
      const pairingsRes = await axios.get(`${this.baseURL}/api/pairings`, this.authHeader(user1.token));
      const accepted = (pairingsRes.data.pairings || []).find(p => p.status === 'accepted');
      this.assert(!!accepted, 'Found accepted pairing for user1', accepted ? `ID: ${accepted.id}` : 'none');
      this.testData.pairingId = accepted ? accepted.id : null;

      return !!this.testData.pairingId;
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
  }

  async testCreateValidation() {
    this.log('Testing creation validation + access control', 'section');
    const { user1, outsider, pairingId } = this.testData;

    // Missing pairing_id → 400
    try {
      await axios.post(`${this.baseURL}/api/prompt-sessions`, {}, this.authHeader(user1.token));
      this.assert(false, 'Create without pairing_id should fail', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 400, 'Create without pairing_id returns 400', `Status: ${error.response?.status}`);
    }

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
    this.log('Testing successful creation + no prompt leak', 'section');
    const { user1, pairingId } = this.testData;
    try {
      const res = await axios.post(`${this.baseURL}/api/prompt-sessions`, { pairing_id: pairingId }, this.authHeader(user1.token));
      this.assert(res.status === 201, 'Create returns 201', `Status: ${res.status}`);

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
      this.assert(false, 'Create success', `Error: ${error.response?.data?.error || error.message}`);
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
    }
  }

  async testGetAndList() {
    this.log('Testing get + list (both partners have access)', 'section');
    const { user1, user2, outsider, sessionId, pairingId } = this.testData;

    // Partner (user2) can fetch by id.
    try {
      const res = await axios.get(`${this.baseURL}/api/prompt-sessions/${sessionId}`, this.authHeader(user2.token));
      this.assert(res.status === 200, 'Partner can GET session by id', `Status: ${res.status}`);
    } catch (error) {
      this.assert(false, 'Partner GET by id', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Outsider cannot.
    try {
      await axios.get(`${this.baseURL}/api/prompt-sessions/${sessionId}`, this.authHeader(outsider.token));
      this.assert(false, 'Outsider GET by id should fail', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 403, 'Outsider GET by id returns 403', `Status: ${error.response?.status}`);
    }

    // List for user1 includes the session.
    try {
      const res = await axios.get(`${this.baseURL}/api/prompt-sessions`, this.authHeader(user1.token));
      const ids = (res.data.prompt_sessions || []).map(s => s.id);
      this.assert(ids.includes(sessionId), 'List includes the created session', `count: ${ids.length}`);
    } catch (error) {
      this.assert(false, 'List sessions', `Error: ${error.response?.data?.error || error.message}`);
    }

    // List filtered by pairing_id works.
    try {
      const res = await axios.get(`${this.baseURL}/api/prompt-sessions?pairing_id=${pairingId}`, this.authHeader(user2.token));
      this.assert(res.status === 200 && Array.isArray(res.data.prompt_sessions), 'List filtered by pairing_id returns array', `count: ${res.data.prompt_sessions?.length}`);
    } catch (error) {
      this.assert(false, 'List by pairing_id', `Error: ${error.response?.data?.error || error.message}`);
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
    }
  }

  async testPrepFlow() {
    this.log('Testing prep submit/merge, completion, and visibility policy', 'section');
    const { user1, user2, outsider, sessionId } = this.testData;

    const fullPrep = {
      bringing_text: 'I am bringing curiosity and some tiredness.',
      energy_level: 'medium',
      intention: 'To listen more than I speak.',
      curiosity: 'What has felt heavy for you this week?',
      boundary: 'Let us avoid logistics tonight.',
      gratitude: 'Thank you for planning dinner.'
    };

    // Outsider cannot submit prep.
    try {
      await axios.post(`${this.baseURL}/api/prompt-sessions/${sessionId}/prep`, fullPrep, this.authHeader(outsider.token));
      this.assert(false, 'Outsider prep submit should fail', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 403, 'Outsider prep submit returns 403', `Status: ${error.response?.status}`);
    }

    // Partial prep → not complete.
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

    // Full prep for user1 → complete, merge preserved bringing_text gets overwritten by full value.
    try {
      const res = await axios.post(`${this.baseURL}/api/prompt-sessions/${sessionId}/prep`, fullPrep, this.authHeader(user1.token));
      this.assert(res.data.prep.completed === true, 'User1 full prep is complete', `completed: ${res.data.prep.completed}`);
      this.assert(res.data.both_preps_complete === false, 'both_preps_complete still false (user2 pending)', `value: ${res.data.both_preps_complete}`);
    } catch (error) {
      this.assert(false, 'User1 full prep', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Visibility: user2 should see user1 completed but NOT raw answers yet.
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

    // user2 completes prep → both complete.
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

    // Now user1 should see user2's raw answers (both complete).
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

    // Invalid status rejected.
    try {
      await axios.patch(`${this.baseURL}/api/prompt-sessions/${sessionId}`, { status: 'not-a-status' }, this.authHeader(user1.token));
      this.assert(false, 'PATCH invalid status should fail', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 400, 'PATCH invalid status returns 400', `Status: ${error.response?.status}`);
    }
  }

  async testGenerateStub() {
    this.log('Testing generation stub (501 once both preps complete)', 'section');
    const { user1, sessionId } = this.testData;
    try {
      await axios.post(`${this.baseURL}/api/prompt-sessions/${sessionId}/generate`, {}, this.authHeader(user1.token));
      this.assert(false, 'Generate stub should not succeed yet', 'Request unexpectedly succeeded');
    } catch (error) {
      this.assert(error.response?.status === 501, 'Generate returns 501 (not implemented)', `Status: ${error.response?.status}`);
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
      await this.testGenerateStub();
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
