/**
 * User Org Code Test Suite
 * Tests the PUT /api/users/:id endpoint for org_code association and premium status
 *
 * Run with:           node tests/user-org-code-test.js
 * Run with keep-data: node tests/user-org-code-test.js --keep-data
 *
 * The --keep-data flag prevents cleanup of test data, allowing SQL verification:
 *   SELECT id, email, org_code_id, is_premium FROM users
 *     WHERE email LIKE 'orgcode_user%@example.com';
 *   SELECT id, org_code, organization, expires_at FROM org_codes
 *     WHERE org_code LIKE 'TESTORG%';
 */

require('dotenv').config();
const axios = require('axios');
const { generateTestEmail } = require('./test-helpers');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:9000';

class UserOrgCodeTestRunner {
  constructor(options = {}) {
    this.baseURL = options.baseURL || BASE_URL;
    this.timeout = options.timeout || 15000;
    this.keepData = process.argv.includes('--keep-data');
    this.testResults = { passed: 0, failed: 0, total: 0 };
    this.testData = {
      user: null,
      userToken: null,
      adminToken: null,
      activeOrgCode: null,
      expiredOrgCode: null
    };
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
      info: '📝', pass: '✅', fail: '❌', warn: '⚠️', section: '🧪', data: '💾'
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
    return condition;
  }

  // ─── Setup ────────────────────────────────────────────────────────────────

  async setup() {
    this.log('Setting up test data...', 'section');

    try {
      // 1. Create a regular test user
      const userEmail = generateTestEmail('orgcode_user');
      const createUserRes = await axios.post(`${this.baseURL}/api/users`, {
        email: userEmail,
        password: 'TestPass987!'
      });
      this.assert(createUserRes.status === 201, 'Setup - create test user');
      this.testData.user = createUserRes.data.user;
      this.testData.userToken = createUserRes.data.access_token;

      // 2. Get an admin token (required to create org codes)
      const adminLoginRes = await axios.post(`${this.baseURL}/api/admin/login`, {
        email: process.env.ADMIN_EMAIL || 'admin@example.com',
        password: process.env.ADMIN_PASSWORD || 'AdminPass1!'
      }).catch(() => null);

      if (adminLoginRes?.status === 200) {
        this.testData.adminToken = adminLoginRes.data.access_token;
        this.log('Admin login successful', 'pass');
      } else {
        this.log('Admin login unavailable — org code creation tests will be skipped', 'warn');
      }

      // 3. Create an active org code (admin only)
      if (this.testData.adminToken) {
        const activeOrgRes = await axios.post(`${this.baseURL}/api/org-codes`, {
          org_code: 'TESTORG_ACTIVE',
          organization: 'Test Active Org'
        }, { headers: { Authorization: `Bearer ${this.testData.adminToken}` } });

        this.assert(activeOrgRes.status === 201, 'Setup - create active org code');
        this.testData.activeOrgCode = activeOrgRes.data.org_code;

        // 4. Create an expired org code
        const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // yesterday
        const expiredOrgRes = await axios.post(`${this.baseURL}/api/org-codes`, {
          org_code: 'TESTORG_EXPIRED',
          organization: 'Test Expired Org',
          expires_at: pastDate
        }, { headers: { Authorization: `Bearer ${this.testData.adminToken}` } });

        this.assert(expiredOrgRes.status === 201, 'Setup - create expired org code');
        this.testData.expiredOrgCode = expiredOrgRes.data.org_code;
      }

      this.log('Setup complete', 'pass');
      return true;
    } catch (error) {
      this.log(`Setup failed: ${error.response?.data?.error || error.message}`, 'fail');
      return false;
    }
  }

  // ─── Tests ────────────────────────────────────────────────────────────────

  /**
   * Valid org_code sets org_code_id and marks user as premium
   */
  async testValidOrgCode() {
    this.log('Testing valid org_code grants premium status...', 'section');

    if (!this.testData.activeOrgCode) {
      this.log('Skipping - no active org code available', 'warn');
      return;
    }

    try {
      const res = await axios.put(
        `${this.baseURL}/api/users/${this.testData.user.id}`,
        { org_code: this.testData.activeOrgCode.org_code },
        { headers: { Authorization: `Bearer ${this.testData.userToken}` }, timeout: this.timeout }
      );

      this.assert(res.status === 200, 'Valid org_code - status 200', `Status: ${res.status}`);
      this.assert(
        res.data.user.org_code_id === this.testData.activeOrgCode.id,
        'Valid org_code - org_code_id set correctly',
        `org_code_id: ${res.data.user.org_code_id}`
      );
      this.assert(
        res.data.user.premium === true,
        'Valid org_code - premium is true',
        `premium: ${res.data.user.premium}`
      );
      this.assert(
        res.data.message === 'User updated successfully',
        'Valid org_code - correct success message',
        `message: ${res.data.message}`
      );

      // Verify premium persists on GET /users/:id
      const getRes = await axios.get(
        `${this.baseURL}/api/users/${this.testData.user.id}`,
        { headers: { Authorization: `Bearer ${this.testData.userToken}` }, timeout: this.timeout }
      );

      this.assert(
        getRes.data.premium === true,
        'Valid org_code - premium persists on GET /users/:id',
        `premium: ${getRes.data.premium}`
      );
      this.assert(
        getRes.data.org_code_id === this.testData.activeOrgCode.id,
        'Valid org_code - org_code_id persists on GET /users/:id',
        `org_code_id: ${getRes.data.org_code_id}`
      );
    } catch (error) {
      this.assert(false, 'Valid org_code test', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Invalid (non-existent) org_code returns 400
   */
  async testInvalidOrgCode() {
    this.log('Testing invalid org_code returns 400...', 'section');

    try {
      await axios.put(
        `${this.baseURL}/api/users/${this.testData.user.id}`,
        { org_code: 'DOESNOTEXIST999' },
        { headers: { Authorization: `Bearer ${this.testData.userToken}` }, timeout: this.timeout }
      );
      this.assert(false, 'Invalid org_code - should have returned 400', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 400,
        'Invalid org_code - returns 400',
        `Status: ${error.response?.status}`
      );
      this.assert(
        error.response?.data?.error === 'Invalid org code',
        'Invalid org_code - correct error message',
        `Error: ${error.response?.data?.error}`
      );
    }
  }

  /**
   * Expired org_code returns 400
   */
  async testExpiredOrgCode() {
    this.log('Testing expired org_code returns 400...', 'section');

    if (!this.testData.expiredOrgCode) {
      this.log('Skipping - no expired org code available', 'warn');
      return;
    }

    try {
      await axios.put(
        `${this.baseURL}/api/users/${this.testData.user.id}`,
        { org_code: this.testData.expiredOrgCode.org_code },
        { headers: { Authorization: `Bearer ${this.testData.userToken}` }, timeout: this.timeout }
      );
      this.assert(false, 'Expired org_code - should have returned 400', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 400,
        'Expired org_code - returns 400',
        `Status: ${error.response?.status}`
      );
      this.assert(
        error.response?.data?.error === 'Org code has expired',
        'Expired org_code - correct error message',
        `Error: ${error.response?.data?.error}`
      );
    }
  }

  /**
   * org_code field can coexist with other updatable fields in the same request
   */
  async testOrgCodeAlongsideOtherFields() {
    this.log('Testing org_code alongside other profile fields...', 'section');

    if (!this.testData.activeOrgCode) {
      this.log('Skipping - no active org code available', 'warn');
      return;
    }

    let freshUser = null;
    let freshToken = null;
    try {
      const res = await axios.post(`${this.baseURL}/api/users`, {
        email: generateTestEmail('orgcode_combo'),
        password: 'TestPass987!'
      });
      freshUser = res.data.user;
      freshToken = res.data.access_token;
    } catch (err) {
      this.assert(false, 'Combo test - fresh user creation', `Error: ${err.message}`);
      return;
    }

    try {
      const res = await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        {
          org_code: this.testData.activeOrgCode.org_code,
          user_name: 'Test User',
          partner_name: 'Test Partner'
        },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      this.assert(res.status === 200, 'Combo update - status 200', `Status: ${res.status}`);
      this.assert(res.data.user.premium === true, 'Combo update - premium is true');
      this.assert(
        res.data.user.org_code_id === this.testData.activeOrgCode.id,
        'Combo update - org_code_id set',
        `org_code_id: ${res.data.user.org_code_id}`
      );
      this.assert(
        res.data.user.user_name === 'Test User',
        'Combo update - user_name set',
        `user_name: ${res.data.user.user_name}`
      );
      this.assert(
        res.data.user.partner_name === 'Test Partner',
        'Combo update - partner_name set',
        `partner_name: ${res.data.user.partner_name}`
      );
    } catch (error) {
      this.assert(false, 'Combo update test', `Error: ${error.response?.data?.error || error.message}`);
    } finally {
      if (!this.keepData && freshUser) {
        await axios.delete(`${this.baseURL}/api/users/${freshUser.id}`, {
          headers: { Authorization: `Bearer ${freshToken}` }
        }).catch(() => {});
      }
    }
  }

  /**
   * PUT /users/:id without org_code still works normally (no regression)
   */
  async testUpdateWithoutOrgCode() {
    this.log('Testing PUT /users/:id without org_code is unaffected...', 'section');

    let freshUser = null;
    let freshToken = null;
    try {
      const res = await axios.post(`${this.baseURL}/api/users`, {
        email: generateTestEmail('orgcode_noorg'),
        password: 'TestPass987!'
      });
      freshUser = res.data.user;
      freshToken = res.data.access_token;
    } catch (err) {
      this.assert(false, 'No-org test - fresh user creation', `Error: ${err.message}`);
      return;
    }

    try {
      const res = await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { user_name: 'Name Only Update' },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      this.assert(res.status === 200, 'No org_code update - status 200', `Status: ${res.status}`);
      this.assert(
        res.data.user.user_name === 'Name Only Update',
        'No org_code update - user_name updated',
        `user_name: ${res.data.user.user_name}`
      );
      this.assert(
        res.data.user.org_code_id === null || res.data.user.org_code_id === undefined,
        'No org_code update - org_code_id remains null',
        `org_code_id: ${res.data.user.org_code_id}`
      );
      this.assert(
        res.data.user.premium === false,
        'No org_code update - premium remains false',
        `premium: ${res.data.user.premium}`
      );
    } catch (error) {
      this.assert(false, 'No org_code update test', `Error: ${error.response?.data?.error || error.message}`);
    } finally {
      if (!this.keepData && freshUser) {
        await axios.delete(`${this.baseURL}/api/users/${freshUser.id}`, {
          headers: { Authorization: `Bearer ${freshToken}` }
        }).catch(() => {});
      }
    }
  }

  /**
   * PUT /users/:id requires authentication
   */
  async testAuthenticationRequired() {
    this.log('Testing PUT /users/:id requires authentication...', 'section');

    try {
      await axios.put(
        `${this.baseURL}/api/users/${this.testData.user.id}`,
        { org_code: 'ANYTHING' },
        { timeout: this.timeout }
      );
      this.assert(false, 'No token - should return 401', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 401,
        'No token - returns 401',
        `Status: ${error.response?.status}`
      );
    }

    try {
      await axios.put(
        `${this.baseURL}/api/users/${this.testData.user.id}`,
        { org_code: 'ANYTHING' },
        { headers: { Authorization: 'Bearer invalid-token' }, timeout: this.timeout }
      );
      this.assert(false, 'Invalid token - should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 401 || error.response?.status === 403,
        'Invalid token - returns 401 or 403',
        `Status: ${error.response?.status}`
      );
    }
  }

  /**
   * Users cannot update another user's profile
   */
  async testCannotUpdateOtherUser() {
    this.log('Testing users cannot update another user\'s org_code...', 'section');

    let otherUser = null;
    let otherToken = null;
    try {
      const res = await axios.post(`${this.baseURL}/api/users`, {
        email: generateTestEmail('orgcode_other'),
        password: 'TestPass987!'
      });
      otherUser = res.data.user;
      otherToken = res.data.access_token;
    } catch (err) {
      this.assert(false, 'Cross-user test - other user creation', `Error: ${err.message}`);
      return;
    }

    try {
      await axios.put(
        `${this.baseURL}/api/users/${this.testData.user.id}`,
        { org_code: 'ANYTHING' },
        { headers: { Authorization: `Bearer ${otherToken}` }, timeout: this.timeout }
      );
      this.assert(false, 'Cross-user update - should return 403', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Cross-user update - returns 403',
        `Status: ${error.response?.status}`
      );
    } finally {
      if (!this.keepData && otherUser) {
        await axios.delete(`${this.baseURL}/api/users/${otherUser.id}`, {
          headers: { Authorization: `Bearer ${otherToken}` }
        }).catch(() => {});
      }
    }
  }

  /**
   * Rate limiter returns 429 after 10 rapid attempts
   */
  async testRateLimiting() {
    this.log('Testing PUT /users/:id rate limiting...', 'section');

    let rlUser = null;
    let rlToken = null;
    try {
      const res = await axios.post(`${this.baseURL}/api/users`, {
        email: generateTestEmail('orgcode_ratelimit'),
        password: 'TestPass987!'
      });
      rlUser = res.data.user;
      rlToken = res.data.access_token;
    } catch (err) {
      this.log('Rate limit test - could not create dedicated user, skipping', 'warn');
      return;
    }

    let hitRateLimit = false;
    let requestCount = 0;

    // Fire 12 rapid sequential requests (limit is 10 per 15 min)
    for (let i = 0; i < 12; i++) {
      try {
        await axios.put(
          `${this.baseURL}/api/users/${rlUser.id}`,
          { user_name: `Name ${i}` },
          { headers: { Authorization: `Bearer ${rlToken}` }, timeout: this.timeout }
        );
        requestCount++;
      } catch (error) {
        if (error.response?.status === 429) {
          hitRateLimit = true;
          this.log(`Rate limit hit after ${requestCount} requests`, 'info');
          break;
        }
      }
    }

    this.assert(
      hitRateLimit,
      'Rate limiter - 429 received after exceeding 10 requests per 15 min',
      hitRateLimit ? 'Rate limit triggered correctly' : 'Rate limit was NOT triggered'
    );

    if (this.keepData && rlUser) {
      this.log(`Rate-limit test user ${rlUser.email} preserved (--keep-data)`, 'data');
    }
  }

  /**
   * Response never leaks is_premium or password_hash
   */
  async testSensitiveFieldsNotExposed() {
    this.log('Testing sensitive fields are not exposed in response...', 'section');

    if (!this.testData.activeOrgCode) {
      this.log('Skipping - no active org code available', 'warn');
      return;
    }

    try {
      const res = await axios.put(
        `${this.baseURL}/api/users/${this.testData.user.id}`,
        { org_code: this.testData.activeOrgCode.org_code },
        { headers: { Authorization: `Bearer ${this.testData.userToken}` }, timeout: this.timeout }
      );

      this.assert(
        !res.data.user.hasOwnProperty('password_hash'),
        'Response - password_hash not exposed',
        'password_hash correctly excluded'
      );
      this.assert(
        !res.data.user.hasOwnProperty('is_premium'),
        'Response - is_premium not exposed (surfaced as premium)',
        'is_premium correctly excluded'
      );
      this.assert(
        typeof res.data.user.premium === 'boolean',
        'Response - premium is a boolean',
        `premium type: ${typeof res.data.user.premium}`
      );
    } catch (error) {
      this.assert(false, 'Sensitive fields test', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  async cleanup() {
    if (this.keepData) {
      this.log('KEEP DATA MODE: Skipping cleanup', 'data');
      this.printKeepDataInfo();
      return;
    }

    this.log('Cleaning up test data...', 'section');

    if (this.testData.user?.id) {
      await axios.delete(`${this.baseURL}/api/users/${this.testData.user.id}`, {
        headers: { Authorization: `Bearer ${this.testData.userToken}` }
      }).catch(() => {});
    }

    if (this.testData.adminToken) {
      for (const key of ['activeOrgCode', 'expiredOrgCode']) {
        const oc = this.testData[key];
        if (oc?.id) {
          await axios.delete(`${this.baseURL}/api/org-codes/${oc.id}`, {
            headers: { Authorization: `Bearer ${this.testData.adminToken}` }
          }).catch(() => {});
        }
      }
    }
  }

  printKeepDataInfo() {
    this.log('─── Keep-data SQL queries ───────────────────────────────────────────', 'data');
    this.log("SELECT id, email, org_code_id, is_premium FROM users WHERE email LIKE 'orgcode_%@example.com';", 'data');
    this.log("SELECT id, org_code, organization, expires_at FROM org_codes WHERE org_code LIKE 'TESTORG%';", 'data');
    this.log('────────────────────────────────────────────────────────────────────', 'data');
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 USER ORG CODE TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`Total Tests:  ${this.testResults.total}`);
    console.log(`Passed:       ${this.testResults.passed}`);
    console.log(`Failed:       ${this.testResults.failed}`);
    const rate = this.testResults.total > 0
      ? Math.round((this.testResults.passed / this.testResults.total) * 100)
      : 0;
    console.log(`Success Rate: ${rate}%`);
    if (this.testResults.failed === 0) {
      console.log('\n🎉 All org code / premium tests passed!');
    } else {
      console.log('\n⚠️  Some tests failed. Review output above.');
    }
    console.log('='.repeat(60) + '\n');
  }

  // ─── Runner ───────────────────────────────────────────────────────────────

  async runAllTests() {
    this.log('🧪 Starting User Org Code Test Suite', 'section');
    if (this.keepData) {
      this.log('🔒 KEEP DATA MODE: test data will NOT be cleaned up', 'data');
    }
    console.log('='.repeat(60));

    try {
      const setupOk = await this.setup();
      if (!setupOk) {
        this.log('Setup failed — aborting', 'fail');
        return false;
      }

      const tests = [
        () => this.testValidOrgCode(),
        () => this.testInvalidOrgCode(),
        () => this.testExpiredOrgCode(),
        () => this.testOrgCodeAlongsideOtherFields(),
        () => this.testUpdateWithoutOrgCode(),
        () => this.testAuthenticationRequired(),
        () => this.testCannotUpdateOtherUser(),
        () => this.testRateLimiting(),
        () => this.testSensitiveFieldsNotExposed()
      ];

      for (const test of tests) {
        console.log('');
        await test();
        await new Promise(resolve => setTimeout(resolve, 500));
      }

    } finally {
      console.log('');
      await this.cleanup();
    }

    this.printSummary();
    return this.testResults.failed === 0;
  }
}

if (require.main === module) {
  const runner = new UserOrgCodeTestRunner();
  runner.runAllTests()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error('Test runner error:', error);
      process.exit(1);
    });
}

module.exports = UserOrgCodeTestRunner;
