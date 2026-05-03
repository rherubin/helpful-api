const axios = require('axios');
const { generateTestEmail } = require('./test-helpers');

/**
 * Device Tokens Endpoint Test Suite
 * Tests /api/device-tokens for iOS/Android push notification registration.
 *
 * Endpoints:
 *   POST   /api/device-tokens          - register (201 new, 200 update)
 *   GET    /api/device-tokens          - list records for the caller
 *   DELETE /api/device-tokens/:id      - remove by record ID (caller-scoped)
 *
 * Run with:                node tests/device-tokens-test.js
 * Keep data for SQL check: node tests/device-tokens-test.js --__keep-data
 *
 * SQL verification (with --__keep-data):
 *   SELECT u.email, dt.id, dt.platform, dt.created_at
 *     FROM device_tokens dt JOIN users u ON dt.user_id = u.id
 *    WHERE u.email LIKE 'device-token-test%@example.com';
 */
class DeviceTokenTestRunner {
  constructor(options = {}) {
    this.baseURL = options.baseURL || 'http://127.0.0.1:9000';
    this.timeout = options.timeout || 10000;
    this.keepData = process.argv.includes('--__keep-data');
    this.testResults = { passed: 0, failed: 0, total: 0 };
    this.testData = { users: [] };
  }

  log(message, type = 'info') {
    const prefix = { info: '📝', pass: '✅', fail: '❌', warn: '⚠️', section: '🧪', data: '💾' }[type] || '📝';
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

  async createTestUser(prefix = 'device-token-test') {
    const email = generateTestEmail(prefix);
    try {
      const response = await axios.post(`${this.baseURL}/api/users`, {
        email,
        password: 'SecurePass987!'
      }, { timeout: this.timeout });

      const user = {
        ...response.data.user,
        email,
        token: response.data.access_token
      };
      this.testData.users.push(user);
      this.log(`Created test user: ${email}`, 'data');
      return user;
    } catch (error) {
      this.log(`Failed to create test user: ${error.response?.data?.error || error.message}`, 'fail');
      return null;
    }
  }

  // Helper to register a token and return the full response
  async registerToken(user, deviceToken, platform) {
    return axios.post(`${this.baseURL}/api/device-tokens`, { device_token: deviceToken, platform }, {
      headers: { Authorization: `Bearer ${user.token}` },
      timeout: this.timeout
    });
  }

  // ─────────────────────────────────────────────
  // Auth
  // ─────────────────────────────────────────────
  async runAuthTests() {
    this.log('Authentication', 'section');
    const body = { device_token: 'a'.repeat(32), platform: 'ios' };

    for (const [label, config] of [
      ['POST no token',     { method: 'post',   url: '/api/device-tokens',      data: body }],
      ['POST invalid token',{ method: 'post',   url: '/api/device-tokens',      data: body, headers: { Authorization: 'Bearer bad.token.here' } }],
      ['GET no token',      { method: 'get',    url: '/api/device-tokens' }],
      ['DELETE no token',   { method: 'delete', url: '/api/device-tokens/some-id' }],
    ]) {
      try {
        await axios({ method: config.method, url: `${this.baseURL}${config.url}`, data: config.data, headers: config.headers, timeout: this.timeout });
        this.assert(false, `${label} should return 401`, 'Request succeeded unexpectedly');
      } catch (error) {
        this.assert(error.response?.status === 401, `${label} returns 401`, `Status: ${error.response?.status}`);
      }
    }
  }

  // ─────────────────────────────────────────────
  // Input validation
  // ─────────────────────────────────────────────
  async runValidationTests(user) {
    this.log('Input Validation', 'section');

    const cases = [
      [{ platform: 'ios' },                                     'Missing device_token'],
      [{ device_token: 42, platform: 'ios' },                   'Non-string device_token'],
      [{ device_token: 'short', platform: 'ios' },              'device_token too short (<10 chars)'],
      [{ device_token: 'a'.repeat(513), platform: 'ios' },      'device_token too long (>512 chars)'],
      [{ device_token: 'a'.repeat(32) },                        'Missing platform'],
      [{ device_token: 'a'.repeat(32), platform: 'blackberry' },'Invalid platform value'],
    ];

    for (const [body, label] of cases) {
      try {
        await axios.post(`${this.baseURL}/api/device-tokens`, body, {
          headers: { Authorization: `Bearer ${user.token}` },
          timeout: this.timeout
        });
        this.assert(false, `${label} should return 400`, 'Request succeeded unexpectedly');
      } catch (error) {
        this.assert(error.response?.status === 400, `${label} returns 400`, `Status: ${error.response?.status}`);
      }
    }
  }

  // ─────────────────────────────────────────────
  // Registration (POST)
  // ─────────────────────────────────────────────
  async runRegistrationTests(user) {
    this.log('Registration (POST)', 'section');
    const baseToken = `valid-device-token-${Date.now()}`;

    // First registration → 201
    let recordId;
    try {
      const res = await this.registerToken(user, `${baseToken}_a`, 'ios');
      this.assert(res.status === 201, 'First registration returns 201', `Status: ${res.status}`);
      this.assert(!!res.data.device_token?.id, 'Response includes record id');
      this.assert(res.data.device_token?.platform === 'ios', 'Response reflects platform');
      recordId = res.data.device_token.id;
    } catch (err) {
      this.assert(false, 'First iOS registration', `Error: ${err.response?.data?.error || err.message}`);
    }

    // Re-registration (same token) → 200 and same id
    try {
      const res = await this.registerToken(user, `${baseToken}_a`, 'ios');
      this.assert(res.status === 200, 'Re-registration returns 200 (idempotent)', `Status: ${res.status}`);
      this.assert(res.data.device_token?.id === recordId, 'Re-registration returns same record id');
    } catch (err) {
      this.assert(false, 'Idempotent re-registration', `Error: ${err.response?.data?.error || err.message}`);
    }

    // Platform update on re-registration
    try {
      const res = await this.registerToken(user, `${baseToken}_a`, 'android');
      this.assert(res.status === 200, 'Platform update on re-registration returns 200');
      this.assert(res.data.device_token?.platform === 'android', 'Platform updated to android');
    } catch (err) {
      this.assert(false, 'Platform update on re-registration', `Error: ${err.response?.data?.error || err.message}`);
    }

    // Android and web tokens register successfully
    for (const [token, platform] of [[`${baseToken}_b`, 'android'], [`${baseToken}_c`, 'web']]) {
      try {
        const res = await this.registerToken(user, token, platform);
        this.assert([200, 201].includes(res.status), `Register ${platform} token succeeds`, `Status: ${res.status}`);
      } catch (err) {
        this.assert(false, `Register ${platform} token`, `Error: ${err.response?.data?.error || err.message}`);
      }
    }

    return recordId;
  }

  // ─────────────────────────────────────────────
  // List (GET)
  // ─────────────────────────────────────────────
  async runListTests(user) {
    this.log('List (GET)', 'section');
    try {
      const res = await axios.get(`${this.baseURL}/api/device-tokens`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });

      this.assert(res.status === 200, 'GET returns 200');
      this.assert(Array.isArray(res.data.device_tokens), 'Response has device_tokens array');
      this.assert(typeof res.data.count === 'number', 'Response has count');
      this.assert(res.data.count === res.data.device_tokens.length, 'count matches array length');

      const record = res.data.device_tokens[0];
      this.assert(record && !!record.id, 'Each record has an id');
      this.assert(record && !!record.platform, 'Each record has a platform');
      this.assert(record && !record.device_token, 'Raw device_token string is not exposed in list response');
    } catch (err) {
      this.assert(false, 'List device tokens', `Error: ${err.response?.data?.error || err.message}`);
    }
  }

  // ─────────────────────────────────────────────
  // Delete (DELETE /:id)
  // ─────────────────────────────────────────────
  async runDeletionTests(user, recordId) {
    this.log('Deletion (DELETE /:id)', 'section');

    // Delete a known record
    if (recordId) {
      try {
        const res = await axios.delete(`${this.baseURL}/api/device-tokens/${recordId}`, {
          headers: { Authorization: `Bearer ${user.token}` },
          timeout: this.timeout
        });
        this.assert(res.status === 200, 'DELETE by id succeeds', `Status: ${res.status}`);
        this.assert(res.data.success === true, 'Response success flag is true');
      } catch (err) {
        this.assert(false, 'DELETE by id', `Error: ${err.response?.data?.error || err.message}`);
      }

      // Confirm deletion — record should no longer be in the list
      try {
        const listRes = await axios.get(`${this.baseURL}/api/device-tokens`, {
          headers: { Authorization: `Bearer ${user.token}` },
          timeout: this.timeout
        });
        const stillPresent = listRes.data.device_tokens.some(t => t.id === recordId);
        this.assert(!stillPresent, 'Deleted record absent from subsequent GET');
      } catch (err) {
        this.log('Could not verify deletion via GET', 'warn');
      }
    }

    // Delete non-existent id → 404
    try {
      await axios.delete(`${this.baseURL}/api/device-tokens/nonexistent-id-xyz`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(false, 'DELETE non-existent id should return 404', 'Request succeeded unexpectedly');
    } catch (err) {
      this.assert(err.response?.status === 404, 'DELETE non-existent id returns 404', `Status: ${err.response?.status}`);
    }
  }

  // ─────────────────────────────────────────────
  // User isolation
  // ─────────────────────────────────────────────
  async runIsolationTests(userA, userB) {
    this.log('User Isolation', 'section');

    const tokenStr = `isolation-token-${Date.now()}-abcdefgh`;

    // User A registers a token
    let recordId;
    try {
      const res = await this.registerToken(userA, tokenStr, 'ios');
      recordId = res.data.device_token?.id;
      this.assert(!!recordId, 'User A registers a token and receives record id');
    } catch (err) {
      this.assert(false, 'User A registration for isolation test', `Error: ${err.response?.data?.error || err.message}`);
      return;
    }

    // User B cannot see User A's token in their own list
    try {
      const res = await axios.get(`${this.baseURL}/api/device-tokens`, {
        headers: { Authorization: `Bearer ${userB.token}` },
        timeout: this.timeout
      });
      const visible = res.data.device_tokens.some(t => t.id === recordId);
      this.assert(!visible, "User B cannot see User A's token record in GET");
    } catch (err) {
      this.assert(false, "User B GET isolation", `Error: ${err.response?.data?.error || err.message}`);
    }

    // User B cannot delete User A's token by id → 404
    try {
      await axios.delete(`${this.baseURL}/api/device-tokens/${recordId}`, {
        headers: { Authorization: `Bearer ${userB.token}` },
        timeout: this.timeout
      });
      this.assert(false, "User B delete of User A's token should return 404", 'Request succeeded unexpectedly');
    } catch (err) {
      this.assert(err.response?.status === 404, "User B cannot delete User A's token (404)", `Status: ${err.response?.status}`);
    }
  }

  // ─────────────────────────────────────────────
  // Per-user token cap
  // ─────────────────────────────────────────────
  async runCapTests(user) {
    this.log('Per-user token cap (25 max)', 'section');

    // Register tokens up to the cap (we may already have some from prior tests;
    // count first so we don't make the suite very slow)
    try {
      const listRes = await axios.get(`${this.baseURL}/api/device-tokens`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      const existing = listRes.data.count || 0;
      const toAdd = Math.max(0, 25 - existing);

      for (let i = 0; i < toAdd; i++) {
        await this.registerToken(user, `cap-fill-token-${Date.now()}-${i}-${'x'.repeat(20)}`, 'ios');
      }

      // The next one should fail
      try {
        await this.registerToken(user, `cap-overflow-token-${Date.now()}-${'y'.repeat(20)}`, 'android');
        this.assert(false, 'Token beyond cap should return 400', 'Request succeeded unexpectedly');
      } catch (err) {
        this.assert(err.response?.status === 400, 'Token beyond cap returns 400', `Status: ${err.response?.status}`);
        this.assert(
          err.response?.data?.error?.includes('limit'),
          'Error message mentions limit',
          err.response?.data?.error
        );
      }
    } catch (err) {
      this.log(`Cap test skipped or failed: ${err.response?.data?.error || err.message}`, 'warn');
    }
  }

  // ─────────────────────────────────────────────
  // Main runner
  // ─────────────────────────────────────────────
  async runAllTests() {
    this.log('Starting Device Tokens Test Suite', 'section');
    this.log(`Base URL: ${this.baseURL}`);
    console.log('');

    const userA = await this.createTestUser('device-token-test');
    const userB = await this.createTestUser('device-token-test');

    if (!userA || !userB) {
      this.log('Could not create test users. Aborting.', 'fail');
      this.printSummary();
      return false;
    }

    await this.runAuthTests();
    await this.runValidationTests(userA);
    const recordId = await this.runRegistrationTests(userA);
    await this.runListTests(userA);
    await this.runDeletionTests(userA, recordId);
    await this.runIsolationTests(userA, userB);
    await this.runCapTests(userB);

    this.printSummary();

    if (!this.keepData) {
      this.log('\n🧹 Test data will be cleaned up by: node tests/cleanup-test-data.js', 'info');
    }

    return this.testResults.failed === 0;
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    this.log('DEVICE TOKENS TEST SUMMARY', 'section');
    console.log(`Total:  ${this.testResults.total}`);
    console.log(`Passed: ${this.testResults.passed}`);
    console.log(`Failed: ${this.testResults.failed}`);
    console.log('='.repeat(60));
    if (this.testResults.failed === 0) {
      this.log('All device token tests passed!', 'pass');
    } else {
      this.log('Some tests failed. See output above.', 'fail');
    }
  }
}

if (require.main === module) {
  const runner = new DeviceTokenTestRunner();
  runner.runAllTests().then(success => process.exit(success ? 0 : 1)).catch(err => {
    console.error('Test runner failed:', err);
    process.exit(1);
  });
}

module.exports = DeviceTokenTestRunner;
