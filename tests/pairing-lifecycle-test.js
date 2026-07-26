const axios = require('axios');
const { generateTestEmail } = require('./test-helpers');

/**
 * Pairing Lifecycle Test Suite
 *
 * Covers reject / soft-delete / restore flows that are not covered by the
 * existing request→accept→list pairings suites:
 *
 *   POST   /api/pairing/reject/:pairingId
 *   DELETE /api/pairing/:pairingId
 *   PATCH  /api/pairing/:pairingId/restore
 *
 * Run standalone: node tests/pairing-lifecycle-test.js
 * (Server must be running, e.g. TEST_MOCK_LLM=true npm start)
 */
class PairingLifecycleTestRunner {
  constructor(options = {}) {
    this.baseURL = options.baseURL || process.env.TEST_BASE_URL || 'http://127.0.0.1:9000';
    this.timeout = options.timeout || 15000;
    this.testResults = { passed: 0, failed: 0, total: 0 };
    this.testData = { users: [] };
  }

  log(message, type = 'info') {
    const prefix = {
      info: '📝', pass: '✅', fail: '❌', warn: '⚠️', section: '🧪', data: '💾'
    }[type] || '📝';
    console.log(`${prefix} [${new Date().toISOString()}] ${message}`);
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

  authHeader(token) {
    return { headers: { Authorization: `Bearer ${token}` }, timeout: this.timeout };
  }

  async createUser(prefix = 'pairing-lifecycle') {
    const email = generateTestEmail(prefix);
    const res = await axios.post(`${this.baseURL}/api/users`, {
      email,
      password: 'SecurePass987!'
    }, { timeout: this.timeout });

    const user = {
      ...res.data.user,
      email,
      token: res.data.access_token
    };
    this.testData.users.push(user);
    return user;
  }

  async requestPairing(user) {
    const res = await axios.post(
      `${this.baseURL}/api/pairing/request`,
      {},
      this.authHeader(user.token)
    );
    return res.data;
  }

  async acceptPairing(user, partnerCode) {
    return axios.post(
      `${this.baseURL}/api/pairing/accept`,
      { partner_code: partnerCode },
      this.authHeader(user.token)
    );
  }

  // ─────────────────────────────────────────────
  // Reject
  // ─────────────────────────────────────────────
  async runRejectTests() {
    this.log('POST /api/pairing/reject/:pairingId', 'section');

    const requester = await this.createUser('pl-reject-req');
    const outsider = await this.createUser('pl-reject-out');

    // Happy path: requester cancels their pending invite
    const pending = await this.requestPairing(requester);
    this.assert(!!pending.pairing_id, 'Request returns pairing_id', `id=${pending.pairing_id}`);
    this.assert(!!pending.partner_code, 'Request returns partner_code');

    const rejectRes = await axios.post(
      `${this.baseURL}/api/pairing/reject/${pending.pairing_id}`,
      {},
      this.authHeader(requester.token)
    );
    this.assert(rejectRes.status === 200, 'Requester reject pending → 200', `status=${rejectRes.status}`);
    this.assert(
      typeof rejectRes.data?.message === 'string' && rejectRes.data.message.toLowerCase().includes('reject'),
      'Reject response includes success message',
      `msg=${rejectRes.data?.message}`
    );

    // Already processed
    try {
      await axios.post(
        `${this.baseURL}/api/pairing/reject/${pending.pairing_id}`,
        {},
        this.authHeader(requester.token)
      );
      this.assert(false, 'Reject already-processed pairing should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 400,
        'Reject already-processed → 400',
        `status=${error.response?.status}`
      );
    }

    // Outsider cannot reject someone else's pending invite
    const pending2 = await this.requestPairing(requester);
    try {
      await axios.post(
        `${this.baseURL}/api/pairing/reject/${pending2.pairing_id}`,
        {},
        this.authHeader(outsider.token)
      );
      this.assert(false, 'Outsider reject should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Outsider reject → 403',
        `status=${error.response?.status}`
      );
    }

    // Reject after accept is not allowed
    const userA = await this.createUser('pl-reject-a');
    const userB = await this.createUser('pl-reject-b');
    const acceptedReq = await this.requestPairing(userA);
    await this.acceptPairing(userB, acceptedReq.partner_code);
    try {
      await axios.post(
        `${this.baseURL}/api/pairing/reject/${acceptedReq.pairing_id}`,
        {},
        this.authHeader(userA.token)
      );
      this.assert(false, 'Reject accepted pairing should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 400,
        'Reject accepted pairing → 400',
        `status=${error.response?.status}`
      );
    }

    // Auth required
    try {
      await axios.post(
        `${this.baseURL}/api/pairing/reject/${pending2.pairing_id}`,
        {},
        { timeout: this.timeout }
      );
      this.assert(false, 'Reject without token should fail', 'Request succeeded');
    } catch (error) {
      this.assert(error.response?.status === 401, 'Reject without token → 401', `status=${error.response?.status}`);
    }

    // Unknown pairing
    try {
      await axios.post(
        `${this.baseURL}/api/pairing/reject/nonexistent-pairing-id`,
        {},
        this.authHeader(requester.token)
      );
      this.assert(false, 'Reject unknown pairing should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 404 || error.response?.status === 500,
        'Reject unknown pairing → 404/500',
        `status=${error.response?.status}`
      );
    }
  }

  // ─────────────────────────────────────────────
  // Soft-delete + restore
  // ─────────────────────────────────────────────
  async runSoftDeleteRestoreTests() {
    this.log('DELETE /api/pairing/:id + PATCH restore', 'section');

    const user1 = await this.createUser('pl-del-u1');
    const user2 = await this.createUser('pl-del-u2');
    const outsider = await this.createUser('pl-del-out');

    const req = await this.requestPairing(user1);
    await this.acceptPairing(user2, req.partner_code);
    const pairingId = req.pairing_id;

    // Soft-delete by a member
    const delRes = await axios.delete(
      `${this.baseURL}/api/pairing/${pairingId}`,
      this.authHeader(user1.token)
    );
    this.assert(delRes.status === 200, 'Member soft-delete → 200', `status=${delRes.status}`);
    this.assert(
      typeof delRes.data?.message === 'string' && delRes.data.message.toLowerCase().includes('deleted'),
      'Soft-delete response includes success message',
      `msg=${delRes.data?.message}`
    );

    // Pairing no longer listed for either member
    const list1 = await axios.get(`${this.baseURL}/api/pairings`, this.authHeader(user1.token));
    const stillThere1 = (list1.data.pairings || []).some(p => p.id === pairingId);
    this.assert(!stillThere1, 'Soft-deleted pairing absent from user1 list');

    const list2 = await axios.get(`${this.baseURL}/api/pairings`, this.authHeader(user2.token));
    const stillThere2 = (list2.data.pairings || []).some(p => p.id === pairingId);
    this.assert(!stillThere2, 'Soft-deleted pairing absent from user2 list');

    // GET by id → 404 while deleted
    try {
      await axios.get(`${this.baseURL}/api/pairing/${pairingId}`, this.authHeader(user1.token));
      this.assert(false, 'GET soft-deleted pairing should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 404 || error.response?.status === 500,
        'GET soft-deleted pairing → 404/500',
        `status=${error.response?.status}`
      );
    }

    // Double-delete → not found
    try {
      await axios.delete(
        `${this.baseURL}/api/pairing/${pairingId}`,
        this.authHeader(user1.token)
      );
      this.assert(false, 'Double soft-delete should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 404,
        'Double soft-delete → 404',
        `status=${error.response?.status}`
      );
    }

    // Restore
    const restoreRes = await axios.patch(
      `${this.baseURL}/api/pairing/${pairingId}/restore`,
      {},
      this.authHeader(user1.token)
    );
    this.assert(restoreRes.status === 200, 'Restore soft-deleted pairing → 200', `status=${restoreRes.status}`);
    this.assert(
      typeof restoreRes.data?.message === 'string' && restoreRes.data.message.toLowerCase().includes('restored'),
      'Restore response includes success message',
      `msg=${restoreRes.data?.message}`
    );

    // Visible again after restore
    const listAfter = await axios.get(`${this.baseURL}/api/pairings`, this.authHeader(user1.token));
    const restored = (listAfter.data.pairings || []).some(p => p.id === pairingId);
    this.assert(restored, 'Restored pairing present in user1 list');

    // Restore when not deleted
    try {
      await axios.patch(
        `${this.baseURL}/api/pairing/${pairingId}/restore`,
        {},
        this.authHeader(user1.token)
      );
      this.assert(false, 'Restore non-deleted pairing should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 404,
        'Restore non-deleted pairing → 404',
        `status=${error.response?.status}`
      );
    }

    // Outsider cannot soft-delete a live pairing
    try {
      await axios.delete(
        `${this.baseURL}/api/pairing/${pairingId}`,
        this.authHeader(outsider.token)
      );
      this.assert(false, 'Outsider soft-delete should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Outsider soft-delete → 403',
        `status=${error.response?.status}`
      );
    }

    // Auth required for delete + restore
    try {
      await axios.delete(`${this.baseURL}/api/pairing/${pairingId}`, { timeout: this.timeout });
      this.assert(false, 'Soft-delete without token should fail', 'Request succeeded');
    } catch (error) {
      this.assert(error.response?.status === 401, 'Soft-delete without token → 401', `status=${error.response?.status}`);
    }

    try {
      await axios.patch(
        `${this.baseURL}/api/pairing/${pairingId}/restore`,
        {},
        { timeout: this.timeout }
      );
      this.assert(false, 'Restore without token should fail', 'Request succeeded');
    } catch (error) {
      this.assert(error.response?.status === 401, 'Restore without token → 401', `status=${error.response?.status}`);
    }
  }

  async runAllTests() {
    this.log('Starting Pairing Lifecycle Test Suite', 'section');

    try {
      await this.runRejectTests();
      await this.runSoftDeleteRestoreTests();
    } catch (error) {
      this.log(`Unexpected suite error: ${error.message}`, 'fail');
      this.testResults.failed++;
      this.testResults.total++;
    }

    const { passed, failed, total } = this.testResults;
    console.log('\n============================================================');
    this.log('Pairing Lifecycle TEST SUMMARY');
    this.log(`Total:  ${total}`);
    this.log(`Passed: ${passed}`);
    this.log(`Failed: ${failed}`);
    console.log('============================================================');

    if (failed === 0) {
      this.log('All pairing lifecycle tests passed!', 'pass');
    } else {
      this.log(`${failed} test(s) failed.`, 'fail');
    }

    return failed === 0;
  }
}

if (require.main === module) {
  const runner = new PairingLifecycleTestRunner();
  runner.runAllTests()
    .then(success => process.exit(success ? 0 : 1))
    .catch(err => {
      console.error('Test runner failed:', err);
      process.exit(1);
    });
}

module.exports = PairingLifecycleTestRunner;
