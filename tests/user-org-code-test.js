/**
 * User Org Code Test Suite
 *
 * Covers two org-link paths on PUT /api/users/:id:
 *
 *   Path A – admin org_code string
 *     Linking an admin-created org code sets org_code_id, grants premium,
 *     clears any custom org fields, and returns org details from the organizations table.
 *     Detaching (org_code: null | '') reverses all of that.
 *
 *   Path B – custom user org fields (org_name / org_city / org_state)
 *     Providing these without org_code stores values on the user row directly,
 *     detaches any existing org_code_id, and grants premium when all three fields
 *     are populated with non-empty values.
 *     Any subset of the three fields may be updated independently.
 *
 * Run with:           node tests/user-org-code-test.js
 * Run with keep-data: node tests/user-org-code-test.js --keep-data
 *
 *   SELECT id, email, org_code_id, org_name, org_city, org_state, is_premium
 *     FROM users WHERE email LIKE 'orgcode_%@example.com';
 *   SELECT id, org_code, organization, city, state FROM organizations
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

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async createFreshUser(emailPrefix) {
    const res = await axios.post(`${this.baseURL}/api/users`, {
      email: generateTestEmail(emailPrefix),
      password: 'TestPass987!'
    });
    return { user: res.data.user, token: res.data.access_token };
  }

  async deleteUser(userId, token) {
    await axios.delete(`${this.baseURL}/api/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => {});
  }

  // ─── Setup ────────────────────────────────────────────────────────────────

  async setup() {
    this.log('Setting up test data...', 'section');

    try {
      // 1. Create a regular test user (reused by stateless tests)
      const { user, token } = await this.createFreshUser('orgcode_user');
      this.testData.user = user;
      this.testData.userToken = token;
      this.assert(!!user.id, 'Setup - create test user');

      // 2. Obtain admin token
      const adminLoginRes = await axios.post(`${this.baseURL}/api/admin/login`, {
        email: process.env.ADMIN_EMAIL || 'admin@example.com',
        password: process.env.ADMIN_PASSWORD || 'AdminPass1!'
      }).catch(() => null);

      if (adminLoginRes?.status === 200) {
        this.testData.adminToken = adminLoginRes.data.access_token;
        this.log('Admin login successful', 'pass');
      } else {
        this.log('Admin login unavailable — Path A and audit tests will be skipped', 'warn');
      }

      // 3. Create an active admin org code
      if (this.testData.adminToken) {
        const activeOrgRes = await axios.post(`${this.baseURL}/api/org-codes`, {
          org_code: 'TESTORG_ACTIVE',
          organization: 'Test Active Org',
          city: 'Test City',
          state: 'TC'
        }, { headers: { Authorization: `Bearer ${this.testData.adminToken}` } });

        this.assert(activeOrgRes.status === 201, 'Setup - create active org code');
        this.testData.activeOrgCode = activeOrgRes.data.org_code;

        // 4. Create an expired org code
        const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
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

  // ─── Path A: admin org_code ───────────────────────────────────────────────

  /**
   * Valid org_code sets org_code_id, grants premium, returns org details from admin record.
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

      this.assert(res.status === 200, 'Valid org_code - status 200');
      this.assert(
        res.data.user.org_code_id === this.testData.activeOrgCode.id,
        'Valid org_code - org_code_id set correctly',
        `org_code_id: ${res.data.user.org_code_id}`
      );
      this.assert(res.data.user.premium === true, 'Valid org_code - premium is true');
      this.assert(
        res.data.user.org_name === 'Test Active Org',
        'Valid org_code - org_name from admin record',
        `org_name: ${res.data.user.org_name}`
      );
      this.assert(
        res.data.user.org_city === 'Test City',
        'Valid org_code - org_city from admin record',
        `org_city: ${res.data.user.org_city}`
      );
      this.assert(
        res.data.user.org_state === 'TC',
        'Valid org_code - org_state from admin record',
        `org_state: ${res.data.user.org_state}`
      );

      // Verify persistence on GET /users/:id
      const getRes = await axios.get(
        `${this.baseURL}/api/users/${this.testData.user.id}`,
        { headers: { Authorization: `Bearer ${this.testData.userToken}` }, timeout: this.timeout }
      );

      this.assert(getRes.data.premium === true, 'Valid org_code - premium persists on GET');
      this.assert(
        getRes.data.org_code_id === this.testData.activeOrgCode.id,
        'Valid org_code - org_code_id persists on GET'
      );
      this.assert(
        getRes.data.org_name === 'Test Active Org',
        'Valid org_code - org_name from admin record on GET'
      );
    } catch (error) {
      this.assert(false, 'Valid org_code test', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Invalid (non-existent) org_code returns 400.
   */
  async testInvalidOrgCode() {
    this.log('Testing invalid org_code returns 400...', 'section');

    try {
      await axios.put(
        `${this.baseURL}/api/users/${this.testData.user.id}`,
        { org_code: 'DOESNOTEXIST999' },
        { headers: { Authorization: `Bearer ${this.testData.userToken}` }, timeout: this.timeout }
      );
      this.assert(false, 'Invalid org_code - should have returned 400');
    } catch (error) {
      this.assert(error.response?.status === 400, 'Invalid org_code - returns 400');
      this.assert(
        error.response?.data?.error === 'Invalid org code',
        'Invalid org_code - correct error message',
        `Error: ${error.response?.data?.error}`
      );
    }
  }

  /**
   * Expired org_code returns 400.
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
      this.assert(false, 'Expired org_code - should have returned 400');
    } catch (error) {
      this.assert(error.response?.status === 400, 'Expired org_code - returns 400');
      this.assert(
        error.response?.data?.error === 'Org code has expired',
        'Expired org_code - correct error message'
      );
    }
  }

  /**
   * org_code can be submitted alongside other profile fields in a single request.
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
      ({ user: freshUser, token: freshToken } = await this.createFreshUser('orgcode_combo'));

      const res = await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        {
          org_code: this.testData.activeOrgCode.org_code,
          user_name: 'Test User',
          partner_name: 'Test Partner'
        },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      this.assert(res.status === 200, 'Combo update - status 200');
      this.assert(res.data.user.premium === true, 'Combo update - premium is true');
      this.assert(
        res.data.user.org_code_id === this.testData.activeOrgCode.id,
        'Combo update - org_code_id set'
      );
      this.assert(res.data.user.user_name === 'Test User', 'Combo update - user_name set');
      this.assert(res.data.user.partner_name === 'Test Partner', 'Combo update - partner_name set');
    } catch (error) {
      this.assert(false, 'Combo update test', `Error: ${error.response?.data?.error || error.message}`);
    } finally {
      if (!this.keepData && freshUser) await this.deleteUser(freshUser.id, freshToken);
    }
  }

  /**
   * Detaching with org_code: null clears org_code_id, org fields, and premium.
   */
  async testDetachOrgCodeWithNull() {
    this.log('Testing detach via org_code: null removes org link and premium...', 'section');

    if (!this.testData.activeOrgCode) {
      this.log('Skipping - no active org code available', 'warn');
      return;
    }

    let freshUser = null;
    let freshToken = null;
    try {
      ({ user: freshUser, token: freshToken } = await this.createFreshUser('orgcode_detach_null'));

      // First attach
      await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { org_code: this.testData.activeOrgCode.org_code },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      // Now detach with null
      const detachRes = await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { org_code: null },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      this.assert(detachRes.status === 200, 'Detach null - status 200');
      this.assert(
        detachRes.data.user.org_code_id === null || detachRes.data.user.org_code_id === undefined,
        'Detach null - org_code_id cleared',
        `org_code_id: ${detachRes.data.user.org_code_id}`
      );
      this.assert(detachRes.data.user.premium === false, 'Detach null - premium false');
      this.assert(
        detachRes.data.user.org_name === null || detachRes.data.user.org_name === undefined,
        'Detach null - org_name cleared'
      );
      this.assert(
        detachRes.data.user.org_city === null || detachRes.data.user.org_city === undefined,
        'Detach null - org_city cleared'
      );
      this.assert(
        detachRes.data.user.org_state === null || detachRes.data.user.org_state === undefined,
        'Detach null - org_state cleared'
      );
    } catch (error) {
      this.assert(false, 'Detach null test', `Error: ${error.response?.data?.error || error.message}`);
    } finally {
      if (!this.keepData && freshUser) await this.deleteUser(freshUser.id, freshToken);
    }
  }

  /**
   * Detaching with org_code: '' (empty string) has the same effect as null.
   */
  async testDetachOrgCodeWithEmptyString() {
    this.log('Testing detach via org_code: "" removes org link and premium...', 'section');

    if (!this.testData.activeOrgCode) {
      this.log('Skipping - no active org code available', 'warn');
      return;
    }

    let freshUser = null;
    let freshToken = null;
    try {
      ({ user: freshUser, token: freshToken } = await this.createFreshUser('orgcode_detach_empty'));

      // Attach
      await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { org_code: this.testData.activeOrgCode.org_code },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      // Detach via empty string
      const detachRes = await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { org_code: '' },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      this.assert(detachRes.status === 200, 'Detach empty - status 200');
      this.assert(
        detachRes.data.user.org_code_id === null || detachRes.data.user.org_code_id === undefined,
        'Detach empty - org_code_id cleared'
      );
      this.assert(detachRes.data.user.premium === false, 'Detach empty - premium false');
    } catch (error) {
      this.assert(false, 'Detach empty string test', `Error: ${error.response?.data?.error || error.message}`);
    } finally {
      if (!this.keepData && freshUser) await this.deleteUser(freshUser.id, freshToken);
    }
  }

  /**
   * Setting org_code on a user who had custom org fields should clear those fields.
   */
  async testOrgCodeClearsCustomFields() {
    this.log('Testing org_code link clears custom org fields...', 'section');

    if (!this.testData.activeOrgCode) {
      this.log('Skipping - no active org code available', 'warn');
      return;
    }

    let freshUser = null;
    let freshToken = null;
    try {
      ({ user: freshUser, token: freshToken } = await this.createFreshUser('orgcode_clears_custom'));

      // Set custom org fields first
      await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { org_name: 'My Church', org_city: 'My City', org_state: 'MC' },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      // Now link an admin org — custom fields should be cleared
      const res = await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { org_code: this.testData.activeOrgCode.org_code },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      this.assert(res.status === 200, 'Org_code clears custom - status 200');
      this.assert(
        res.data.user.org_code_id === this.testData.activeOrgCode.id,
        'Org_code clears custom - org_code_id set to admin org'
      );
      this.assert(
        res.data.user.org_name === 'Test Active Org',
        'Org_code clears custom - org_name is from admin record (not custom)',
        `org_name: ${res.data.user.org_name}`
      );
      this.assert(
        res.data.user.org_city === 'Test City',
        'Org_code clears custom - org_city is from admin record',
        `org_city: ${res.data.user.org_city}`
      );
    } catch (error) {
      this.assert(false, 'Org code clears custom fields test', `Error: ${error.response?.data?.error || error.message}`);
    } finally {
      if (!this.keepData && freshUser) await this.deleteUser(freshUser.id, freshToken);
    }
  }

  // ─── Path B: custom user org fields ───────────────────────────────────────

  /**
   * org_name + org_city + org_state saves to user columns, no org_code_id, premium true.
   */
  async testCustomOrgFieldsSavedToUser() {
    this.log('Testing custom org fields are saved directly on the user record...', 'section');

    let freshUser = null;
    let freshToken = null;
    try {
      ({ user: freshUser, token: freshToken } = await this.createFreshUser('orgcode_custom'));

      const res = await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { org_name: 'My Local Church', org_city: 'Springfield', org_state: 'IL' },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      this.assert(res.status === 200, 'Custom org - status 200');
      this.assert(
        res.data.user.org_name === 'My Local Church',
        'Custom org - org_name saved',
        `org_name: ${res.data.user.org_name}`
      );
      this.assert(
        res.data.user.org_city === 'Springfield',
        'Custom org - org_city saved',
        `org_city: ${res.data.user.org_city}`
      );
      this.assert(
        res.data.user.org_state === 'IL',
        'Custom org - org_state saved',
        `org_state: ${res.data.user.org_state}`
      );
      this.assert(
        res.data.user.org_code_id === null || res.data.user.org_code_id === undefined,
        'Custom org - org_code_id remains null',
        `org_code_id: ${res.data.user.org_code_id}`
      );
      this.assert(
        res.data.user.premium === true,
        'Custom org - premium granted when all custom org fields are set',
        `premium: ${res.data.user.premium}`
      );
    } catch (error) {
      this.assert(false, 'Custom org fields saved test', `Error: ${error.response?.data?.error || error.message}`);
    } finally {
      if (!this.keepData && freshUser) await this.deleteUser(freshUser.id, freshToken);
    }
  }

  /**
   * Partial custom org fields (any subset) are each saved independently.
   */
  async testPartialCustomOrgFields() {
    this.log('Testing partial custom org fields are saved individually...', 'section');

    let freshUser = null;
    let freshToken = null;
    try {
      ({ user: freshUser, token: freshToken } = await this.createFreshUser('orgcode_partial'));

      // Set only org_name
      const res1 = await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { org_name: 'Just A Name', user_name: 'Partial Tester' },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      this.assert(res1.status === 200, 'Partial org (name only) - status 200');
      this.assert(
        res1.data.user.org_name === 'Just A Name',
        'Partial org (name only) - org_name saved',
        `org_name: ${res1.data.user.org_name}`
      );
      this.assert(
        res1.data.user.premium === false,
        'Partial org (name only) - premium false'
      );

      // Add org_city separately
      const res2 = await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { org_city: 'Added City' },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      this.assert(res2.status === 200, 'Partial org (add city) - status 200');
      this.assert(
        res2.data.user.org_city === 'Added City',
        'Partial org (add city) - org_city saved',
        `org_city: ${res2.data.user.org_city}`
      );
      this.assert(
        res2.data.user.org_name === 'Just A Name',
        'Partial org (add city) - org_name preserved from previous request'
      );
    } catch (error) {
      this.assert(false, 'Partial custom org fields test', `Error: ${error.response?.data?.error || error.message}`);
    } finally {
      if (!this.keepData && freshUser) await this.deleteUser(freshUser.id, freshToken);
    }
  }

  /**
   * Custom org fields alongside other profile fields apply in one request.
   */
  async testCustomOrgFieldsAlongsideOtherFields() {
    this.log('Testing custom org fields alongside other profile fields...', 'section');

    let freshUser = null;
    let freshToken = null;
    try {
      ({ user: freshUser, token: freshToken } = await this.createFreshUser('orgcode_custom_combo'));

      const res = await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        {
          org_name: 'Combo Church',
          org_city: 'Combo City',
          org_state: 'CC',
          user_name: 'Combo User',
          partner_name: 'Combo Partner'
        },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      this.assert(res.status === 200, 'Custom org combo - status 200');
      this.assert(res.data.user.org_name === 'Combo Church', 'Custom org combo - org_name set');
      this.assert(res.data.user.org_city === 'Combo City', 'Custom org combo - org_city set');
      this.assert(res.data.user.org_state === 'CC', 'Custom org combo - org_state set');
      this.assert(res.data.user.user_name === 'Combo User', 'Custom org combo - user_name set');
      this.assert(res.data.user.partner_name === 'Combo Partner', 'Custom org combo - partner_name set');
      this.assert(
        res.data.user.org_code_id === null || res.data.user.org_code_id === undefined,
        'Custom org combo - org_code_id null'
      );
      this.assert(res.data.user.premium === true, 'Custom org combo - premium true');
    } catch (error) {
      this.assert(false, 'Custom org combo test', `Error: ${error.response?.data?.error || error.message}`);
    } finally {
      if (!this.keepData && freshUser) await this.deleteUser(freshUser.id, freshToken);
    }
  }

  /**
   * GET /users/:id returns user custom org fields when no admin org is linked.
   */
  async testCustomOrgFieldsInGetUserResponse() {
    this.log('Testing custom org fields returned in GET /users/:id...', 'section');

    let freshUser = null;
    let freshToken = null;
    try {
      ({ user: freshUser, token: freshToken } = await this.createFreshUser('orgcode_get_custom'));

      // Set custom org fields
      await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { org_name: 'GET Church', org_city: 'GET City', org_state: 'GC' },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      // Verify via GET
      const getRes = await axios.get(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      this.assert(
        getRes.data.org_name === 'GET Church',
        'GET user - custom org_name returned',
        `org_name: ${getRes.data.org_name}`
      );
      this.assert(
        getRes.data.org_city === 'GET City',
        'GET user - custom org_city returned',
        `org_city: ${getRes.data.org_city}`
      );
      this.assert(
        getRes.data.org_state === 'GC',
        'GET user - custom org_state returned',
        `org_state: ${getRes.data.org_state}`
      );
      this.assert(
        getRes.data.org_code_id === null || getRes.data.org_code_id === undefined,
        'GET user - org_code_id null'
      );
    } catch (error) {
      this.assert(false, 'Custom org fields GET user test', `Error: ${error.response?.data?.error || error.message}`);
    } finally {
      if (!this.keepData && freshUser) await this.deleteUser(freshUser.id, freshToken);
    }
  }

  /**
   * GET /profile returns user custom org fields when no admin org is linked.
   */
  async testCustomOrgFieldsInProfile() {
    this.log('Testing custom org fields returned in GET /profile...', 'section');

    let freshUser = null;
    let freshToken = null;
    try {
      ({ user: freshUser, token: freshToken } = await this.createFreshUser('orgcode_profile_custom'));

      // Set custom org
      await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { org_name: 'Profile Church', org_city: 'Profile City', org_state: 'PC' },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      const profileRes = await axios.get(
        `${this.baseURL}/api/profile`,
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      this.assert(profileRes.status === 200, 'Profile custom org - status 200');
      this.assert(
        profileRes.data.profile.premium === true,
        'Profile custom org - premium true when all custom org fields are set',
        `premium: ${profileRes.data.profile.premium}`
      );
      this.assert(
        profileRes.data.profile.org_name === 'Profile Church',
        'Profile custom org - org_name returned',
        `org_name: ${profileRes.data.profile.org_name}`
      );
      this.assert(
        profileRes.data.profile.org_city === 'Profile City',
        'Profile custom org - org_city returned',
        `org_city: ${profileRes.data.profile.org_city}`
      );
      this.assert(
        profileRes.data.profile.org_state === 'PC',
        'Profile custom org - org_state returned',
        `org_state: ${profileRes.data.profile.org_state}`
      );
      this.assert(
        profileRes.data.profile.org_code_id === null || profileRes.data.profile.org_code_id === undefined,
        'Profile custom org - org_code_id null'
      );
    } catch (error) {
      this.assert(false, 'Custom org fields in profile test', `Error: ${error.response?.data?.error || error.message}`);
    } finally {
      if (!this.keepData && freshUser) await this.deleteUser(freshUser.id, freshToken);
    }
  }

  /**
   * GET /profile returns admin org details (from organizations table) when org_code_id is set.
   */
  async testAdminOrgFieldsInProfile() {
    this.log('Testing admin org fields returned in GET /profile when org_code linked...', 'section');

    if (!this.testData.activeOrgCode) {
      this.log('Skipping - no active org code available', 'warn');
      return;
    }

    let freshUser = null;
    let freshToken = null;
    try {
      ({ user: freshUser, token: freshToken } = await this.createFreshUser('orgcode_profile_admin'));

      // Link admin org
      await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { org_code: this.testData.activeOrgCode.org_code },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      const profileRes = await axios.get(
        `${this.baseURL}/api/profile`,
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      this.assert(profileRes.status === 200, 'Profile admin org - status 200');
      this.assert(
        profileRes.data.profile.org_id === this.testData.activeOrgCode.id,
        'Profile admin org - org_id set',
        `org_id: ${profileRes.data.profile.org_id}`
      );
      this.assert(
        profileRes.data.profile.org_name === 'Test Active Org',
        'Profile admin org - org_name from admin record',
        `org_name: ${profileRes.data.profile.org_name}`
      );
      this.assert(
        profileRes.data.profile.org_city === 'Test City',
        'Profile admin org - org_city from admin record',
        `org_city: ${profileRes.data.profile.org_city}`
      );
      this.assert(
        profileRes.data.profile.org_state === 'TC',
        'Profile admin org - org_state from admin record',
        `org_state: ${profileRes.data.profile.org_state}`
      );
    } catch (error) {
      this.assert(false, 'Admin org fields in profile test', `Error: ${error.response?.data?.error || error.message}`);
    } finally {
      if (!this.keepData && freshUser) await this.deleteUser(freshUser.id, freshToken);
    }
  }

  /**
   * Admin org details take precedence over custom org fields in the response.
   */
  async testAdminOrgTakesPrecedenceOverCustom() {
    this.log('Testing admin org takes precedence over custom org fields in response...', 'section');

    if (!this.testData.activeOrgCode) {
      this.log('Skipping - no active org code available', 'warn');
      return;
    }

    let freshUser = null;
    let freshToken = null;
    try {
      ({ user: freshUser, token: freshToken } = await this.createFreshUser('orgcode_precedence'));

      // Set custom org fields first
      await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { org_name: 'My Custom Church', org_city: 'Custom City', org_state: 'CU' },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      // Link admin org (should clear custom fields and use admin org in response)
      const res = await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { org_code: this.testData.activeOrgCode.org_code },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      this.assert(
        res.data.user.org_name === 'Test Active Org',
        'Precedence - org_name is from admin record (not custom)',
        `org_name: ${res.data.user.org_name}`
      );
      this.assert(
        res.data.user.org_city === 'Test City',
        'Precedence - org_city is from admin record (not custom)',
        `org_city: ${res.data.user.org_city}`
      );
      this.assert(
        res.data.user.org_state === 'TC',
        'Precedence - org_state is from admin record (not custom)',
        `org_state: ${res.data.user.org_state}`
      );

      // Verify on GET too
      const getRes = await axios.get(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      this.assert(
        getRes.data.org_name === 'Test Active Org',
        'Precedence GET - org_name from admin record'
      );
    } catch (error) {
      this.assert(false, 'Admin org precedence test', `Error: ${error.response?.data?.error || error.message}`);
    } finally {
      if (!this.keepData && freshUser) await this.deleteUser(freshUser.id, freshToken);
    }
  }

  // ─── Audit log ────────────────────────────────────────────────────────────

  /**
   * Admin audit endpoint returns a log entry after an org linkage change.
   */
  async testAuditLogCreatedOnAttach() {
    this.log('Testing audit log entry created when org_code linked...', 'section');

    if (!this.testData.activeOrgCode || !this.testData.adminToken) {
      this.log('Skipping - admin token or active org code not available', 'warn');
      return;
    }

    let freshUser = null;
    let freshToken = null;
    try {
      ({ user: freshUser, token: freshToken } = await this.createFreshUser('orgcode_audit_attach'));

      // Attach org code
      await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { org_code: this.testData.activeOrgCode.org_code },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      // Query audit log filtered by this user
      const auditRes = await axios.get(
        `${this.baseURL}/api/org-codes/audit/org-linkages?user_id=${freshUser.id}`,
        { headers: { Authorization: `Bearer ${this.testData.adminToken}` }, timeout: this.timeout }
      );

      this.assert(auditRes.status === 200, 'Audit log attach - status 200');
      this.assert(
        Array.isArray(auditRes.data.audit_logs),
        'Audit log attach - audit_logs is an array'
      );
      this.assert(
        auditRes.data.audit_logs.length >= 1,
        'Audit log attach - at least one log entry',
        `count: ${auditRes.data.audit_logs.length}`
      );

      const attachEntry = auditRes.data.audit_logs.find(l => l.change_type === 'attach');
      this.assert(
        !!attachEntry,
        'Audit log attach - entry has change_type=attach',
        `change_type: ${auditRes.data.audit_logs[0]?.change_type}`
      );
      this.assert(
        attachEntry?.new_org_code_id === this.testData.activeOrgCode.id,
        'Audit log attach - new_org_code_id matches org',
        `new_org_code_id: ${attachEntry?.new_org_code_id}`
      );
      this.assert(
        attachEntry?.previous_org_code_id === null,
        'Audit log attach - previous_org_code_id is null'
      );
    } catch (error) {
      this.assert(false, 'Audit log attach test', `Error: ${error.response?.data?.error || error.message}`);
    } finally {
      if (!this.keepData && freshUser) await this.deleteUser(freshUser.id, freshToken);
    }
  }

  /**
   * Audit log records a detach event (change_type = detach).
   */
  async testAuditLogCreatedOnDetach() {
    this.log('Testing audit log entry created when org_code detached...', 'section');

    if (!this.testData.activeOrgCode || !this.testData.adminToken) {
      this.log('Skipping - admin token or active org code not available', 'warn');
      return;
    }

    let freshUser = null;
    let freshToken = null;
    try {
      ({ user: freshUser, token: freshToken } = await this.createFreshUser('orgcode_audit_detach'));

      // Attach then detach
      await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { org_code: this.testData.activeOrgCode.org_code },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { org_code: null },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      const auditRes = await axios.get(
        `${this.baseURL}/api/org-codes/audit/org-linkages?user_id=${freshUser.id}`,
        { headers: { Authorization: `Bearer ${this.testData.adminToken}` }, timeout: this.timeout }
      );

      this.assert(auditRes.status === 200, 'Audit log detach - status 200');
      const detachEntry = auditRes.data.audit_logs.find(l => l.change_type === 'detach');
      this.assert(!!detachEntry, 'Audit log detach - entry has change_type=detach');
      this.assert(
        detachEntry?.new_org_code_id === null,
        'Audit log detach - new_org_code_id is null'
      );
      this.assert(
        detachEntry?.previous_org_code_id === this.testData.activeOrgCode.id,
        'Audit log detach - previous_org_code_id set correctly',
        `previous: ${detachEntry?.previous_org_code_id}`
      );
    } catch (error) {
      this.assert(false, 'Audit log detach test', `Error: ${error.response?.data?.error || error.message}`);
    } finally {
      if (!this.keepData && freshUser) await this.deleteUser(freshUser.id, freshToken);
    }
  }

  /**
   * Non-admin cannot access the audit log endpoint.
   */
  async testAuditLogRequiresAdmin() {
    this.log('Testing audit log endpoint requires admin token...', 'section');

    try {
      await axios.get(
        `${this.baseURL}/api/org-codes/audit/org-linkages`,
        { headers: { Authorization: `Bearer ${this.testData.userToken}` }, timeout: this.timeout }
      );
      this.assert(false, 'Audit log auth - should have returned 403');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Audit log auth - non-admin gets 403',
        `Status: ${error.response?.status}`
      );
    }

    try {
      await axios.get(
        `${this.baseURL}/api/org-codes/audit/org-linkages`,
        { timeout: this.timeout }
      );
      this.assert(false, 'Audit log auth - no token should return 401');
    } catch (error) {
      this.assert(
        error.response?.status === 401,
        'Audit log auth - no token gets 401',
        `Status: ${error.response?.status}`
      );
    }
  }

  // ─── General ──────────────────────────────────────────────────────────────

  /**
   * PUT /users/:id without any org fields updates normally (regression check).
   */
  async testUpdateWithoutOrgFields() {
    this.log('Testing PUT without org fields has no org side-effects...', 'section');

    let freshUser = null;
    let freshToken = null;
    try {
      ({ user: freshUser, token: freshToken } = await this.createFreshUser('orgcode_noorg'));

      const res = await axios.put(
        `${this.baseURL}/api/users/${freshUser.id}`,
        { user_name: 'Name Only Update' },
        { headers: { Authorization: `Bearer ${freshToken}` }, timeout: this.timeout }
      );

      this.assert(res.status === 200, 'No org fields - status 200');
      this.assert(res.data.user.user_name === 'Name Only Update', 'No org fields - user_name updated');
      this.assert(
        res.data.user.org_code_id === null || res.data.user.org_code_id === undefined,
        'No org fields - org_code_id null'
      );
      this.assert(res.data.user.premium === false, 'No org fields - premium false');
      this.assert(
        res.data.user.org_name === null || res.data.user.org_name === undefined,
        'No org fields - org_name null'
      );
    } catch (error) {
      this.assert(false, 'No org fields test', `Error: ${error.response?.data?.error || error.message}`);
    } finally {
      if (!this.keepData && freshUser) await this.deleteUser(freshUser.id, freshToken);
    }
  }

  /**
   * PUT /users/:id requires authentication.
   */
  async testAuthenticationRequired() {
    this.log('Testing PUT /users/:id requires authentication...', 'section');

    try {
      await axios.put(
        `${this.baseURL}/api/users/${this.testData.user.id}`,
        { org_code: 'ANYTHING' },
        { timeout: this.timeout }
      );
      this.assert(false, 'No token - should return 401');
    } catch (error) {
      this.assert(error.response?.status === 401, 'No token - returns 401');
    }

    try {
      await axios.put(
        `${this.baseURL}/api/users/${this.testData.user.id}`,
        { org_code: 'ANYTHING' },
        { headers: { Authorization: 'Bearer invalid-token' }, timeout: this.timeout }
      );
      this.assert(false, 'Invalid token - should fail');
    } catch (error) {
      this.assert(
        error.response?.status === 401 || error.response?.status === 403,
        'Invalid token - returns 401 or 403'
      );
    }
  }

  /**
   * Users cannot update another user's profile.
   */
  async testCannotUpdateOtherUser() {
    this.log('Testing users cannot update another user\'s org fields...', 'section');

    let otherUser = null;
    let otherToken = null;
    try {
      ({ user: otherUser, token: otherToken } = await this.createFreshUser('orgcode_other'));

      await axios.put(
        `${this.baseURL}/api/users/${this.testData.user.id}`,
        { org_code: 'ANYTHING' },
        { headers: { Authorization: `Bearer ${otherToken}` }, timeout: this.timeout }
      );
      this.assert(false, 'Cross-user update - should return 403');
    } catch (error) {
      this.assert(error.response?.status === 403, 'Cross-user update - returns 403');
    } finally {
      if (!this.keepData && otherUser) await this.deleteUser(otherUser.id, otherToken);
    }
  }

  /**
   * Sensitive fields (is_premium, password_hash) are never returned.
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

      this.assert(!res.data.user.hasOwnProperty('password_hash'), 'Response - password_hash not exposed');
      this.assert(!res.data.user.hasOwnProperty('is_premium'), 'Response - is_premium not exposed');
      this.assert(typeof res.data.user.premium === 'boolean', 'Response - premium is boolean');
    } catch (error) {
      this.assert(false, 'Sensitive fields test', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Rate limiter returns 429 after exceeding the configured limit.
   * Skipped when USER_UPDATE_RATE_LIMIT is set >= 20 (high-limit mode).
   */
  async testRateLimiting() {
    this.log('Testing PUT /users/:id rate limiting...', 'section');

    const configuredLimit = parseInt(process.env.USER_UPDATE_RATE_LIMIT || '3', 10);
    if (configuredLimit >= 20) {
      this.log(`Skipping - server running with USER_UPDATE_RATE_LIMIT=${configuredLimit}`, 'warn');
      return;
    }

    let rlUser = null;
    let rlToken = null;
    try {
      ({ user: rlUser, token: rlToken } = await this.createFreshUser('orgcode_ratelimit'));
    } catch (err) {
      this.log('Rate limit test - could not create user, skipping', 'warn');
      return;
    }

    let hitRateLimit = false;
    let requestCount = 0;

    for (let i = 0; i < configuredLimit + 2; i++) {
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
      `Rate limiter - 429 received after exceeding ${configuredLimit} requests`,
      hitRateLimit ? 'Rate limit triggered correctly' : 'NOT triggered'
    );

    if (this.keepData && rlUser) {
      this.log(`Rate-limit test user ${rlUser.email} preserved (--keep-data)`, 'data');
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
      await this.deleteUser(this.testData.user.id, this.testData.userToken);
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
    this.log("SELECT id, email, org_code_id, org_name, org_city, org_state, is_premium FROM users WHERE email LIKE 'orgcode_%@example.com';", 'data');
    this.log("SELECT id, org_code, organization, city, state, expires_at FROM organizations WHERE org_code LIKE 'TESTORG%';", 'data');
    this.log("SELECT * FROM user_org_code_audit_logs ORDER BY created_at DESC LIMIT 20;", 'data');
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
      console.log('\n🎉 All org code tests passed!');
    } else {
      console.log('\n⚠️  Some tests failed. Review output above.');
    }
    console.log('='.repeat(60) + '\n');
  }

  // ─── Runner ───────────────────────────────────────────────────────────────

  async runAllTests() {
    this.log('🧪 Starting User Org Code Test Suite', 'section');
    if (this.keepData) this.log('🔒 KEEP DATA MODE: test data will NOT be cleaned up', 'data');
    console.log('='.repeat(60));

    try {
      const setupOk = await this.setup();
      if (!setupOk) {
        this.log('Setup failed — aborting', 'fail');
        return false;
      }

      const tests = [
        // Path A: admin org_code
        () => this.testValidOrgCode(),
        () => this.testInvalidOrgCode(),
        () => this.testExpiredOrgCode(),
        () => this.testOrgCodeAlongsideOtherFields(),
        () => this.testDetachOrgCodeWithNull(),
        () => this.testDetachOrgCodeWithEmptyString(),
        () => this.testOrgCodeClearsCustomFields(),
        // Path B: custom user org fields
        () => this.testCustomOrgFieldsSavedToUser(),
        () => this.testPartialCustomOrgFields(),
        () => this.testCustomOrgFieldsAlongsideOtherFields(),
        () => this.testCustomOrgFieldsInGetUserResponse(),
        () => this.testCustomOrgFieldsInProfile(),
        // Response precedence
        () => this.testAdminOrgFieldsInProfile(),
        () => this.testAdminOrgTakesPrecedenceOverCustom(),
        // Audit log
        () => this.testAuditLogCreatedOnAttach(),
        () => this.testAuditLogCreatedOnDetach(),
        () => this.testAuditLogRequiresAdmin(),
        // General
        () => this.testUpdateWithoutOrgFields(),
        () => this.testAuthenticationRequired(),
        () => this.testCannotUpdateOtherUser(),
        () => this.testSensitiveFieldsNotExposed(),
        // Rate limit last — exhausts request allowance
        () => this.testRateLimiting()
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
