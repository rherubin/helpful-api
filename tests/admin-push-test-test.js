/**
 * Admin Push-Test Endpoint Integration Tests
 *
 * Covers POST /api/admin/push-test against a live API process.
 * Requires TEST_MOCK_PUSH=true on the server so no real FCM calls are made.
 *
 * What is tested:
 *   - 401  No token supplied
 *   - 403  Authenticated as a regular user (not admin)
 *   - 400  Missing user_id
 *   - 400  Missing both title and body
 *   - 404  Target user_id does not exist
 *   - 200  Happy-path send to a real user (mock mode)
 *
 * Run standalone:  node tests/admin-push-test-test.js
 */

const axios = require('axios');
const { generateTestEmail } = require('./test-helpers');

class AdminPushTestRunner {
  constructor(options = {}) {
    this.baseURL = options.baseURL || 'http://127.0.0.1:9000';
    this.timeout = options.timeout || 10000;
    this.testResults = { passed: 0, failed: 0, total: 0 };
    this.testData = { users: [], adminToken: null, targetUser: null };
    this.runId = `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
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

  async http(method, path, data = null, token = null) {
    const config = {
      method,
      url: `${this.baseURL}${path}`,
      timeout: this.timeout,
      validateStatus: () => true
    };
    if (data) config.data = data;
    if (token) config.headers = { Authorization: `Bearer ${token}` };
    return axios(config);
  }

  // ─────────────────────────────────────────────
  // Setup: create an admin + a regular target user
  // ─────────────────────────────────────────────
  async setup() {
    this.log('Setting up test data', 'section');

    // Register + login admin
    const adminEmail = `admin-push-test_${this.runId}@example.com`;
    const adminPassword = 'Zpfg8K3qVt!';
    const regRes = await this.http('POST', '/api/admin/auth/register', { email: adminEmail, password: adminPassword });
    if (regRes.status !== 201) {
      this.log(`Admin register failed: ${JSON.stringify(regRes.data)}`, 'fail');
      return false;
    }
    const loginRes = await this.http('POST', '/api/admin/auth/login', { email: adminEmail, password: adminPassword });
    if (loginRes.status !== 200) {
      this.log(`Admin login failed: ${JSON.stringify(loginRes.data)}`, 'fail');
      return false;
    }
    this.testData.adminToken = loginRes.data.access_token;
    this.log(`Admin created & logged in: ${adminEmail}`, 'data');

    // Register a regular user (the push target)
    const userEmail = generateTestEmail('admin-push-test');
    const userRes = await this.http('POST', '/api/users', { email: userEmail, password: 'SecurePass987!' });
    if (![200, 201].includes(userRes.status)) {
      this.log(`Target user creation failed: ${JSON.stringify(userRes.data)}`, 'fail');
      return false;
    }
    this.testData.targetUser = userRes.data.user;
    this.testData.regularToken = userRes.data.access_token;
    this.log(`Target user created: ${userEmail} (id: ${this.testData.targetUser.id})`, 'data');

    return true;
  }

  // ─────────────────────────────────────────────
  // Auth / access control
  // ─────────────────────────────────────────────
  async runAuthTests() {
    this.log('Auth / access control', 'section');

    // 401 — no token
    const noToken = await this.http('POST', '/api/admin/push-test', {
      user_id: 'any', title: 'Hello', body: 'World'
    });
    this.assert(noToken.status === 401, 'No token → 401', `got ${noToken.status}`);

    // 403 — regular user token (not admin)
    const regularUser = await this.http('POST', '/api/admin/push-test', {
      user_id: this.testData.targetUser.id, title: 'Hi', body: 'Test'
    }, this.testData.regularToken);
    this.assert(regularUser.status === 403, 'Regular user token → 403', `got ${regularUser.status}`);
    this.assert(
      regularUser.data?.error === 'Admin access required',
      'Regular user token → correct error message',
      `got "${regularUser.data?.error}"`
    );
  }

  // ─────────────────────────────────────────────
  // Input validation
  // ─────────────────────────────────────────────
  async runValidationTests() {
    this.log('Input validation', 'section');

    const tok = this.testData.adminToken;

    // 400 — missing user_id
    const noUserId = await this.http('POST', '/api/admin/push-test', { title: 'Hi', body: 'Test' }, tok);
    this.assert(noUserId.status === 400, 'Missing user_id → 400', `got ${noUserId.status}`);
    this.assert(noUserId.data?.error === 'user_id is required', 'Missing user_id → correct error', `got "${noUserId.data?.error}"`);

    // 400 — missing title AND body
    const noContent = await this.http('POST', '/api/admin/push-test', { user_id: this.testData.targetUser.id }, tok);
    this.assert(noContent.status === 400, 'Missing title+body → 400', `got ${noContent.status}`);
    this.assert(
      noContent.data?.error === 'At least one of title or body is required',
      'Missing title+body → correct error',
      `got "${noContent.data?.error}"`
    );
  }

  // ─────────────────────────────────────────────
  // Not-found handling
  // ─────────────────────────────────────────────
  async runNotFoundTests() {
    this.log('Not-found handling', 'section');

    const tok = this.testData.adminToken;
    const res = await this.http('POST', '/api/admin/push-test', {
      user_id: 'nonexistent-user-id-xyz',
      title: 'Hi',
      body: 'Test'
    }, tok);
    this.assert(res.status === 404, 'Nonexistent user_id → 404', `got ${res.status}`);
    this.assert(res.data?.error === 'User not found', 'Nonexistent user_id → correct error', `got "${res.data?.error}"`);
  }

  // ─────────────────────────────────────────────
  // Happy path
  // ─────────────────────────────────────────────
  async runHappyPathTests() {
    this.log('Happy path (mock FCM)', 'section');

    const tok = this.testData.adminToken;

    // Title + body
    const withBoth = await this.http('POST', '/api/admin/push-test', {
      user_id: this.testData.targetUser.id,
      title: 'Test notification',
      body: 'Integration test body',
      data: { kind: 'test' }
    }, tok);
    this.assert(withBoth.status === 200, 'Valid send → 200', `got ${withBoth.status}`);
    this.assert(withBoth.data?.message === 'Push notification sent', 'Valid send → correct message', `got "${withBoth.data?.message}"`);
    this.assert(typeof withBoth.data?.result === 'object', 'Valid send → result object present');

    // Title only (no body)
    const titleOnly = await this.http('POST', '/api/admin/push-test', {
      user_id: this.testData.targetUser.id,
      title: 'Title only'
    }, tok);
    this.assert(titleOnly.status === 200, 'Title-only send → 200', `got ${titleOnly.status}`);

    // Body only (no title)
    const bodyOnly = await this.http('POST', '/api/admin/push-test', {
      user_id: this.testData.targetUser.id,
      body: 'Body only'
    }, tok);
    this.assert(bodyOnly.status === 200, 'Body-only send → 200', `got ${bodyOnly.status}`);
  }

  // ─────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────
  async teardown() {
    // Nothing to clean up — test users are @example.com and cleaned by cleanup-test-data.js
  }

  async runAllTests() {
    this.log('Admin Push-Test Endpoint Tests', 'section');

    const ready = await this.setup();
    if (!ready) {
      this.log('Setup failed — skipping tests', 'warn');
      return false;
    }

    await this.runAuthTests();
    await this.runValidationTests();
    await this.runNotFoundTests();
    await this.runHappyPathTests();
    await this.teardown();

    const { passed, failed, total } = this.testResults;
    console.log('\n============================================================');
    this.log('Admin Push-Test Endpoint TEST SUMMARY');
    this.log(`Total:  ${total}`);
    this.log(`Passed: ${passed}`);
    this.log(`Failed: ${failed}`);
    console.log('============================================================');

    if (failed === 0) {
      this.log('All admin push-test endpoint tests passed!', 'pass');
    } else {
      this.log(`${failed} test(s) failed.`, 'fail');
    }

    return failed === 0;
  }
}

if (require.main === module) {
  const runner = new AdminPushTestRunner();
  runner.runAllTests().then(success => process.exit(success ? 0 : 1)).catch(err => {
    console.error('Test runner failed:', err);
    process.exit(1);
  });
}

module.exports = AdminPushTestRunner;
