const axios = require('axios');
const { generateTestEmail } = require('./test-helpers');

/**
 * User Soft-Delete / Restore Test Suite
 *
 * Covers:
 *   DELETE /api/users/:id
 *   PATCH  /api/users/:id/restore
 *
 * Also checks cascade soft-delete of the user's pairings and that
 * GET /api/users/:id returns 404 while deleted and works after restore.
 *
 * Run standalone: node tests/user-soft-delete-test.js
 * (Server must be running, e.g. TEST_MOCK_LLM=true npm start)
 */
class UserSoftDeleteTestRunner {
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

  async createUser(prefix = 'user-soft-del') {
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

  // ─────────────────────────────────────────────
  // Soft-delete + restore happy path
  // ─────────────────────────────────────────────
  async runHappyPathTests() {
    this.log('User soft-delete + restore happy path', 'section');

    const user = await this.createUser('usd-happy');
    const other = await this.createUser('usd-other');

    // Soft-delete
    const delRes = await axios.delete(
      `${this.baseURL}/api/users/${user.id}`,
      this.authHeader(user.token)
    );
    this.assert(delRes.status === 200, 'Soft-delete user → 200', `status=${delRes.status}`);
    this.assert(
      typeof delRes.data?.message === 'string' && delRes.data.message.toLowerCase().includes('deleted'),
      'Soft-delete response includes success message',
      `msg=${delRes.data?.message}`
    );
    this.assert(!!delRes.data?.deleted_at, 'Soft-delete response includes deleted_at');

    // Outsider cannot soft-delete another user (IDOR guard)
    try {
      await axios.delete(
        `${this.baseURL}/api/users/${user.id}`,
        this.authHeader(other.token)
      );
      this.assert(false, 'Outsider soft-delete should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Outsider soft-delete → 403',
        `status=${error.response?.status}`
      );
    }

    // Outsider cannot restore another user (IDOR guard) — even while deleted
    try {
      await axios.patch(
        `${this.baseURL}/api/users/${user.id}/restore`,
        {},
        this.authHeader(other.token)
      );
      this.assert(false, 'Outsider restore should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Outsider restore → 403',
        `status=${error.response?.status}`
      );
    }

    // GET user → 404 while deleted
    try {
      await axios.get(`${this.baseURL}/api/users/${user.id}`, this.authHeader(other.token));
      this.assert(false, 'GET soft-deleted user should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 404,
        'GET soft-deleted user → 404',
        `status=${error.response?.status}`
      );
    }

    // Double-delete → 404
    try {
      await axios.delete(
        `${this.baseURL}/api/users/${user.id}`,
        this.authHeader(user.token)
      );
      this.assert(false, 'Double soft-delete should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 404,
        'Double soft-delete → 404',
        `status=${error.response?.status}`
      );
    }

    // Restore (JWT still accepted — middleware does not check deleted_at)
    const restoreRes = await axios.patch(
      `${this.baseURL}/api/users/${user.id}/restore`,
      {},
      this.authHeader(user.token)
    );
    this.assert(restoreRes.status === 200, 'Restore user → 200', `status=${restoreRes.status}`);
    this.assert(
      typeof restoreRes.data?.message === 'string' && restoreRes.data.message.toLowerCase().includes('restored'),
      'Restore response includes success message',
      `msg=${restoreRes.data?.message}`
    );

    // GET works again
    const getRes = await axios.get(
      `${this.baseURL}/api/users/${user.id}`,
      this.authHeader(user.token)
    );
    this.assert(getRes.status === 200, 'GET restored user → 200', `status=${getRes.status}`);
    this.assert(getRes.data?.id === user.id, 'Restored user returns correct id');

    // Restore when not deleted → 404
    try {
      await axios.patch(
        `${this.baseURL}/api/users/${user.id}/restore`,
        {},
        this.authHeader(user.token)
      );
      this.assert(false, 'Restore non-deleted user should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 404,
        'Restore non-deleted user → 404',
        `status=${error.response?.status}`
      );
    }
  }

  // ─────────────────────────────────────────────
  // Cascade: soft-delete user also soft-deletes pairings
  // ─────────────────────────────────────────────
  async runCascadePairingTests() {
    this.log('User soft-delete cascades pairings', 'section');

    const user1 = await this.createUser('usd-casc-u1');
    const user2 = await this.createUser('usd-casc-u2');

    const reqRes = await axios.post(
      `${this.baseURL}/api/pairing/request`,
      {},
      this.authHeader(user1.token)
    );
    const pairingId = reqRes.data.pairing_id;
    await axios.post(
      `${this.baseURL}/api/pairing/accept`,
      { partner_code: reqRes.data.partner_code },
      this.authHeader(user2.token)
    );

    // Confirm pairing exists for user2
    const before = await axios.get(`${this.baseURL}/api/pairings`, this.authHeader(user2.token));
    const hadPairing = (before.data.pairings || []).some(p => p.id === pairingId);
    this.assert(hadPairing, 'Pairing present before user soft-delete');

    // Soft-delete user1 → pairings cascade
    await axios.delete(
      `${this.baseURL}/api/users/${user1.id}`,
      this.authHeader(user1.token)
    );

    const after = await axios.get(`${this.baseURL}/api/pairings`, this.authHeader(user2.token));
    const stillThere = (after.data.pairings || []).some(p => p.id === pairingId);
    this.assert(!stillThere, 'Pairing soft-deleted when user is soft-deleted');

    // Restore user1 does NOT auto-restore pairings (document current behavior)
    await axios.patch(
      `${this.baseURL}/api/users/${user1.id}/restore`,
      {},
      this.authHeader(user1.token)
    );
    const afterUserRestore = await axios.get(
      `${this.baseURL}/api/pairings`,
      this.authHeader(user2.token)
    );
    const pairingBack = (afterUserRestore.data.pairings || []).some(p => p.id === pairingId);
    this.assert(
      !pairingBack,
      'User restore does not auto-restore cascade-deleted pairings (current behavior)'
    );
  }

  // ─────────────────────────────────────────────
  // Auth gates
  // ─────────────────────────────────────────────
  async runAuthTests() {
    this.log('Auth requirements', 'section');

    const user = await this.createUser('usd-auth');

    try {
      await axios.delete(`${this.baseURL}/api/users/${user.id}`, { timeout: this.timeout });
      this.assert(false, 'Soft-delete without token should fail', 'Request succeeded');
    } catch (error) {
      this.assert(error.response?.status === 401, 'Soft-delete without token → 401', `status=${error.response?.status}`);
    }

    try {
      await axios.patch(
        `${this.baseURL}/api/users/${user.id}/restore`,
        {},
        { timeout: this.timeout }
      );
      this.assert(false, 'Restore without token should fail', 'Request succeeded');
    } catch (error) {
      this.assert(error.response?.status === 401, 'Restore without token → 401', `status=${error.response?.status}`);
    }

    // Unknown user id — ownership gate rejects before existence check (no IDOR leak)
    try {
      await axios.delete(
        `${this.baseURL}/api/users/nonexistent-user-id-xyz`,
        this.authHeader(user.token)
      );
      this.assert(false, 'Soft-delete unknown user should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Soft-delete unknown (non-self) user → 403',
        `status=${error.response?.status}`
      );
    }

    // Non-admin cannot enumerate soft-deleted users (PII)
    try {
      await axios.get(`${this.baseURL}/api/users/deleted/all`, this.authHeader(user.token));
      this.assert(false, 'Non-admin deleted/all should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Non-admin GET /api/users/deleted/all → 403',
        `status=${error.response?.status}`
      );
    }
  }

  // ─────────────────────────────────────────────
  // Login recovers soft-deleted account (no permanent email lockout)
  // ─────────────────────────────────────────────
  async runLoginRestoreTests() {
    this.log('Login restores soft-deleted account', 'section');

    const password = 'SecurePass987!';
    const email = generateTestEmail('usd-login-restore');
    const createRes = await axios.post(`${this.baseURL}/api/users`, {
      email,
      password
    }, { timeout: this.timeout });
    const userId = createRes.data.user.id;
    const token = createRes.data.access_token;

    await axios.delete(
      `${this.baseURL}/api/users/${userId}`,
      this.authHeader(token)
    );

    // Re-register with same email must still fail (row retained)
    try {
      await axios.post(`${this.baseURL}/api/users`, {
        email,
        password
      }, { timeout: this.timeout });
      this.assert(false, 'Re-register soft-deleted email should fail', 'Request succeeded');
    } catch (error) {
      this.assert(
        error.response?.status === 409,
        'Re-register soft-deleted email → 409',
        `status=${error.response?.status}`
      );
    }

    // Login with password restores the account
    const loginRes = await axios.post(`${this.baseURL}/api/login`, {
      email,
      password
    }, { timeout: this.timeout });
    this.assert(loginRes.status === 200, 'Login soft-deleted user → 200', `status=${loginRes.status}`);
    this.assert(
      loginRes.data?.data?.restored === true,
      'Login response marks restored=true',
      `restored=${loginRes.data?.data?.restored}`
    );
    this.assert(!!loginRes.data?.data?.access_token, 'Login restore returns access_token');

    const getRes = await axios.get(
      `${this.baseURL}/api/users/${userId}`,
      this.authHeader(loginRes.data.data.access_token)
    );
    this.assert(getRes.status === 200, 'GET user after login-restore → 200', `status=${getRes.status}`);
  }

  async runAllTests() {
    this.log('Starting User Soft-Delete Test Suite', 'section');

    try {
      await this.runHappyPathTests();
      await this.runCascadePairingTests();
      await this.runAuthTests();
      await this.runLoginRestoreTests();
    } catch (error) {
      this.log(`Unexpected suite error: ${error.message}`, 'fail');
      this.testResults.failed++;
      this.testResults.total++;
    }

    const { passed, failed, total } = this.testResults;
    console.log('\n============================================================');
    this.log('User Soft-Delete TEST SUMMARY');
    this.log(`Total:  ${total}`);
    this.log(`Passed: ${passed}`);
    this.log(`Failed: ${failed}`);
    console.log('============================================================');

    if (failed === 0) {
      this.log('All user soft-delete tests passed!', 'pass');
    } else {
      this.log(`${failed} test(s) failed.`, 'fail');
    }

    return failed === 0;
  }
}

if (require.main === module) {
  const runner = new UserSoftDeleteTestRunner();
  runner.runAllTests()
    .then(success => process.exit(success ? 0 : 1))
    .catch(err => {
      console.error('Test runner failed:', err);
      process.exit(1);
    });
}

module.exports = UserSoftDeleteTestRunner;
