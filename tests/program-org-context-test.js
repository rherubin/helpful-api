/**
 * Program Org Context Test Suite
 *
 * Tests that POST /api/programs (which triggers generateInitialProgram)
 * succeeds and resolves org context correctly across every possible
 * org configuration on a user record:
 *
 *   Scenario 1 – No org at all
 *   Scenario 2 – Admin org linked via org_code
 *   Scenario 3 – Custom org (all three fields: org_name + org_city + org_state)
 *   Scenario 4 – Custom org (partial fields only)
 *   Scenario 5 – Org detached before program creation
 *   Scenario 6 – Switched from custom → admin org before creating program
 *   Scenario 7 – Switched from admin → custom org before creating program
 *
 * For each scenario the test:
 *   (a) creates a dedicated user and sets up the correct org state
 *   (b) POSTs /api/programs and asserts 201 + valid program ID
 *   (c) when TEST_MOCK_OPENAI != 'true', polls for async step generation
 *       and asserts that steps were produced (confirming org context was
 *       successfully passed into the prompt without error)
 *
 * Run with:           node tests/program-org-context-test.js
 * Run with keep-data: node tests/program-org-context-test.js --keep-data
 * Skip OpenAI wait:   TEST_MOCK_OPENAI=true node tests/program-org-context-test.js
 */

require('dotenv').config();
const axios = require('axios');
const { generateTestEmail } = require('./test-helpers');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:9000';
const MOCK_OPENAI = process.env.TEST_MOCK_OPENAI === 'true';

class ProgramOrgContextTestRunner {
  constructor(options = {}) {
    this.baseURL = options.baseURL || BASE_URL;
    this.pollTimeout = MOCK_OPENAI
      ? 0
      : (options.pollTimeout
         || (process.env.TEST_POLL_TIMEOUT_MS && parseInt(process.env.TEST_POLL_TIMEOUT_MS, 10))
         || 60000);
    this.timeout = 15000;
    this.keepData = process.argv.includes('--keep-data');
    this.testResults = { passed: 0, failed: 0, total: 0 };

    // Shared admin token + org code created once in setup
    this.adminToken = null;
    this.activeOrgCode = null;

    // All users created across scenarios — used for cleanup
    this.createdUsers = [];

    // Per-scenario program records: { scenario, userId, programId, expectedService }
    this.programRecords = [];
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

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
    return condition;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async createUser(emailPrefix) {
    const res = await axios.post(`${this.baseURL}/api/users`, {
      email: generateTestEmail(emailPrefix),
      password: 'TestPass987!'
    }, { timeout: this.timeout });

    const user = { id: res.data.user.id, token: res.data.access_token };
    this.createdUsers.push(user);

    // Give every user a user_name AND partner_name so program generation
    // requirements are met for both services:
    //   - HopefulPromptService (with org_code) uses only user_name
    //   - HelpfulPromptService (no org_code) requires partner_name for couples flow
    // Neither name may match the generic placeholder patterns in
    // BasePromptService.validateUserNames.
    await axios.put(`${this.baseURL}/api/users/${user.id}`, {
      user_name: 'Jordan',
      partner_name: 'Alex'
    }, {
      headers: { Authorization: `Bearer ${user.token}` },
      timeout: this.timeout
    });

    return user;
  }

  async deleteUser(user) {
    await axios.delete(`${this.baseURL}/api/users/${user.id}`, {
      headers: { Authorization: `Bearer ${user.token}` }
    }).catch(() => {});
  }

  /**
   * Create a program and return its ID.
   * Throws on non-201 so the caller can assert accordingly.
   */
  async createProgram(user, userInput = 'Help me grow in my faith and connect with my community.') {
    const res = await axios.post(`${this.baseURL}/api/programs`, {
      user_input: userInput
    }, {
      headers: { Authorization: `Bearer ${user.token}` },
      timeout: this.timeout
    });
    return res.data.program.id;
  }

  /**
   * Poll until program steps appear or the timeout expires.
   * Returns { found: boolean, count: number }.
   */
  async pollForSteps(programId, token) {
    if (MOCK_OPENAI) {
      this.log('TEST_MOCK_OPENAI=true — skipping step generation wait', 'warn');
      return { found: false, skipped: true };
    }

    const start = Date.now();
    while (Date.now() - start < this.pollTimeout) {
      try {
        const res = await axios.get(`${this.baseURL}/api/programs/${programId}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: this.timeout
        });
        const steps = res.data.program?.program_steps ?? [];
        if (steps.length > 0) return { found: true, count: steps.length };
      } catch { /* keep polling */ }
      await this.sleep(2000);
    }
    return { found: false, count: 0 };
  }

  // ─── Setup ────────────────────────────────────────────────────────────────

  async setup() {
    this.log('Setting up shared test fixtures...', 'section');

    // Admin token (needed for admin org scenarios)
    const adminLoginRes = await axios.post(`${this.baseURL}/api/admin/login`, {
      email: process.env.ADMIN_EMAIL || 'admin@example.com',
      password: process.env.ADMIN_PASSWORD || 'AdminPass1!'
    }).catch(() => null);

    if (adminLoginRes?.status === 200) {
      this.adminToken = adminLoginRes.data.access_token;
      this.log('Admin login successful', 'pass');

      // Create one shared admin org code
      const orgRes = await axios.post(`${this.baseURL}/api/org-codes`, {
        org_code: 'TESTORGCTX_ACTIVE',
        organization: 'Context Test Org',
        city: 'Context City',
        state: 'CT'
      }, { headers: { Authorization: `Bearer ${this.adminToken}` } });

      if (orgRes.status === 201) {
        this.activeOrgCode = orgRes.data.org_code;
        this.log(`Created shared admin org code: ${this.activeOrgCode.org_code}`, 'pass');
      } else {
        this.log('Could not create admin org code — admin org scenarios will be skipped', 'warn');
      }
    } else {
      this.log('Admin login unavailable — admin org scenarios will be skipped', 'warn');
    }

    return true;
  }

  // ─── Scenario helpers ─────────────────────────────────────────────────────

  /**
   * Run the common program-creation + step-polling assertions for a scenario.
   * Records the program in this.programRecords for the end-of-run summary.
   *
   * @param {string} scenarioLabel - Short label (e.g. "Scenario 1 (no org)")
   * @param {object} user - { id, token }
   * @param {string} userInput - user_input sent to POST /api/programs
   * @param {'hopeful'|'helpful'} expectedService - which prompt service the
   *   route is expected to pick for this scenario (hopeful = org_code/custom
   *   fields present; helpful = neither present)
   */
  async runProgramCreationAssertions(scenarioLabel, user, userInput, expectedService) {
    let programId = null;
    let stepCount = 0;
    let stepsFound = false;

    try {
      programId = await this.createProgram(user, userInput);
      this.assert(!!programId, `${scenarioLabel} - program created (201)`, `id: ${programId}`);
    } catch (error) {
      this.assert(false, `${scenarioLabel} - program created (201)`,
        `Error: ${error.response?.data?.error || error.message}`);
      this.programRecords.push({
        scenario: scenarioLabel,
        userId: user.id,
        programId: null,
        expectedService,
        stepCount: 0,
        status: 'create-failed'
      });
      return null;
    }

    // Step generation (skipped when MOCK_OPENAI=true)
    const poll = await this.pollForSteps(programId, user.token);
    if (!poll.skipped) {
      stepsFound = poll.found;
      stepCount = poll.count || 0;
      this.assert(
        poll.found,
        `${scenarioLabel} - steps generated async`,
        poll.found ? `count: ${poll.count}` : 'no steps within timeout'
      );
    }

    this.programRecords.push({
      scenario: scenarioLabel,
      userId: user.id,
      programId,
      expectedService,
      stepCount,
      status: poll.skipped ? 'step-poll-skipped' : (stepsFound ? 'ok' : 'no-steps')
    });

    return programId;
  }

  // ─── Scenario 1: No org at all ────────────────────────────────────────────

  async testNoOrg() {
    this.log('Scenario 1: No org on user record...', 'section');

    let user;
    try {
      user = await this.createUser('progorg_none');
    } catch (err) {
      this.assert(false, 'Scenario 1 - create user', err.message);
      return;
    }

    await this.runProgramCreationAssertions(
      'Scenario 1 (no org)',
      user,
      'We want to improve how we communicate during conflict and reconnect emotionally.',
      'helpful'
    );
  }

  // ─── Scenario 2: Admin org linked via org_code ────────────────────────────

  async testAdminOrgLinked() {
    this.log('Scenario 2: Admin org linked via org_code...', 'section');

    if (!this.activeOrgCode) {
      this.log('Skipping - no admin org code available', 'warn');
      return;
    }

    let user;
    try {
      user = await this.createUser('progorg_admin');
      await axios.put(`${this.baseURL}/api/users/${user.id}`, {
        org_code: this.activeOrgCode.org_code
      }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.log(`Linked admin org ${this.activeOrgCode.org_code} to user`, 'info');
    } catch (err) {
      this.assert(false, 'Scenario 2 - user setup', err.response?.data?.error || err.message);
      return;
    }

    await this.runProgramCreationAssertions(
      'Scenario 2 (admin org)',
      user,
      'I want to grow in my faith through the teachings of my church community.',
      'hopeful'
    );

    // Verify org_code_id is set (confirming admin org path was active)
    try {
      const getRes = await axios.get(`${this.baseURL}/api/users/${user.id}`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(
        getRes.data.org_code_id === this.activeOrgCode.id,
        'Scenario 2 - org_code_id set on user before generation',
        `org_code_id: ${getRes.data.org_code_id}`
      );
    } catch (err) {
      this.assert(false, 'Scenario 2 - verify org_code_id', err.message);
    }
  }

  // ─── Scenario 3: Custom org (all three fields) ────────────────────────────

  async testCustomOrgAllFields() {
    this.log('Scenario 3: Custom org — all three fields set on user record...', 'section');

    let user;
    try {
      user = await this.createUser('progorg_custom_full');
      await axios.put(`${this.baseURL}/api/users/${user.id}`, {
        org_name: 'Grace Community Church',
        org_city: 'Austin',
        org_state: 'TX'
      }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.log('Set custom org: Grace Community Church, Austin TX', 'info');
    } catch (err) {
      this.assert(false, 'Scenario 3 - user setup', err.response?.data?.error || err.message);
      return;
    }

    // Verify org fields are set and org_code_id is null
    try {
      const getRes = await axios.get(`${this.baseURL}/api/users/${user.id}`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(
        getRes.data.org_name === 'Grace Community Church',
        'Scenario 3 - org_name stored on user'
      );
      this.assert(
        getRes.data.org_code_id === null || getRes.data.org_code_id === undefined,
        'Scenario 3 - org_code_id null (custom path)',
        `org_code_id: ${getRes.data.org_code_id}`
      );
    } catch (err) {
      this.assert(false, 'Scenario 3 - verify org fields', err.message);
    }

    await this.runProgramCreationAssertions(
      'Scenario 3 (custom org, all fields)',
      user,
      'I want to connect more deeply with my church family and grow spiritually.',
      'hopeful'
    );
  }

  // ─── Scenario 4: Custom org (partial fields only) ─────────────────────────

  async testCustomOrgPartialFields() {
    this.log('Scenario 4: Custom org — only org_name set (partial)...', 'section');

    let user;
    try {
      user = await this.createUser('progorg_custom_partial');
      await axios.put(`${this.baseURL}/api/users/${user.id}`, {
        org_name: 'Hillside Fellowship'
      }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.log('Set partial custom org: org_name only', 'info');
    } catch (err) {
      this.assert(false, 'Scenario 4 - user setup', err.response?.data?.error || err.message);
      return;
    }

    await this.runProgramCreationAssertions(
      'Scenario 4 (custom org, partial)',
      user,
      'I want to serve my congregation and deepen my relationship with God.',
      'hopeful'
    );
  }

  // ─── Scenario 5: Org detached before program creation ─────────────────────

  async testOrgDetachedBeforeCreation() {
    this.log('Scenario 5: Org detached before program creation...', 'section');

    if (!this.activeOrgCode) {
      this.log('Skipping - no admin org code available', 'warn');
      return;
    }

    let user;
    try {
      user = await this.createUser('progorg_detached');

      // Attach then immediately detach
      await axios.put(`${this.baseURL}/api/users/${user.id}`, {
        org_code: this.activeOrgCode.org_code
      }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });

      await axios.put(`${this.baseURL}/api/users/${user.id}`, {
        org_code: null
      }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.log('Attached then detached admin org', 'info');
    } catch (err) {
      this.assert(false, 'Scenario 5 - user setup', err.response?.data?.error || err.message);
      return;
    }

    // Confirm org is cleared
    try {
      const getRes = await axios.get(`${this.baseURL}/api/users/${user.id}`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(
        getRes.data.org_code_id === null || getRes.data.org_code_id === undefined,
        'Scenario 5 - org_code_id null after detach'
      );
      this.assert(
        (getRes.data.org_name === null || getRes.data.org_name === undefined),
        'Scenario 5 - org_name null after detach'
      );
    } catch (err) {
      this.assert(false, 'Scenario 5 - verify detach', err.message);
    }

    await this.runProgramCreationAssertions(
      'Scenario 5 (org detached)',
      user,
      'We want to rebuild our connection after a rough patch and learn to listen better.',
      'helpful'
    );
  }

  // ─── Scenario 6: Custom org → admin org before program creation ───────────

  async testSwitchCustomToAdminOrg() {
    this.log('Scenario 6: Custom org switched to admin org before program creation...', 'section');

    if (!this.activeOrgCode) {
      this.log('Skipping - no admin org code available', 'warn');
      return;
    }

    let user;
    try {
      user = await this.createUser('progorg_custom_to_admin');

      // Set custom org fields
      await axios.put(`${this.baseURL}/api/users/${user.id}`, {
        org_name: 'Old Custom Church',
        org_city: 'Old City',
        org_state: 'OC'
      }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });

      // Switch to admin org (clears custom fields)
      await axios.put(`${this.baseURL}/api/users/${user.id}`, {
        org_code: this.activeOrgCode.org_code
      }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.log('Switched from custom org to admin org', 'info');
    } catch (err) {
      this.assert(false, 'Scenario 6 - user setup', err.response?.data?.error || err.message);
      return;
    }

    // Verify admin org is now active
    try {
      const getRes = await axios.get(`${this.baseURL}/api/users/${user.id}`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(
        getRes.data.org_code_id === this.activeOrgCode.id,
        'Scenario 6 - org_code_id set to admin org after switch',
        `org_code_id: ${getRes.data.org_code_id}`
      );
      this.assert(
        getRes.data.org_name === 'Context Test Org',
        'Scenario 6 - org_name from admin record (custom cleared)',
        `org_name: ${getRes.data.org_name}`
      );
    } catch (err) {
      this.assert(false, 'Scenario 6 - verify admin org active', err.message);
    }

    await this.runProgramCreationAssertions(
      'Scenario 6 (custom → admin)',
      user,
      'I want to grow in my faith within my new church home.',
      'hopeful'
    );
  }

  // ─── Scenario 7: Admin org → custom org before program creation ───────────

  async testSwitchAdminToCustomOrg() {
    this.log('Scenario 7: Admin org switched to custom org before program creation...', 'section');

    if (!this.activeOrgCode) {
      this.log('Skipping - no admin org code available', 'warn');
      return;
    }

    let user;
    try {
      user = await this.createUser('progorg_admin_to_custom');

      // Link admin org first
      await axios.put(`${this.baseURL}/api/users/${user.id}`, {
        org_code: this.activeOrgCode.org_code
      }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });

      // Switch to custom org (detaches admin org)
      await axios.put(`${this.baseURL}/api/users/${user.id}`, {
        org_name: 'New Custom Church',
        org_city: 'New City',
        org_state: 'NC'
      }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.log('Switched from admin org to custom org', 'info');
    } catch (err) {
      this.assert(false, 'Scenario 7 - user setup', err.response?.data?.error || err.message);
      return;
    }

    // Verify custom org is now active
    try {
      const getRes = await axios.get(`${this.baseURL}/api/users/${user.id}`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(
        getRes.data.org_code_id === null || getRes.data.org_code_id === undefined,
        'Scenario 7 - org_code_id null after switch to custom',
        `org_code_id: ${getRes.data.org_code_id}`
      );
      this.assert(
        getRes.data.org_name === 'New Custom Church',
        'Scenario 7 - org_name from custom fields',
        `org_name: ${getRes.data.org_name}`
      );
    } catch (err) {
      this.assert(false, 'Scenario 7 - verify custom org active', err.message);
    }

    await this.runProgramCreationAssertions(
      'Scenario 7 (admin → custom)',
      user,
      'I want to explore my faith in a new community and grow in wisdom.',
      'hopeful'
    );
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  async cleanup() {
    if (this.keepData) {
      this.log('KEEP DATA MODE: Skipping cleanup', 'data');
      this.printKeepDataInfo();
      return;
    }

    this.log('Cleaning up test data...', 'section');

    for (const user of this.createdUsers) {
      await this.deleteUser(user);
    }

    if (this.adminToken && this.activeOrgCode?.id) {
      await axios.delete(`${this.baseURL}/api/org-codes/${this.activeOrgCode.id}`, {
        headers: { Authorization: `Bearer ${this.adminToken}` }
      }).catch(() => {});
    }
  }

  printKeepDataInfo() {
    this.log('─── Program records (scenario → programId → expected service) ──────', 'data');
    if (this.programRecords.length === 0) {
      this.log('(no program records captured)', 'data');
    } else {
      const pad = (s, n) => String(s).padEnd(n);
      this.log(
        `${pad('EXPECTED SVC', 9)}  ${pad('STATUS', 17)}  ${pad('STEPS', 5)}  ${pad('PROGRAM_ID', 36)}  SCENARIO`,
        'data'
      );
      for (const rec of this.programRecords) {
        this.log(
          `${pad(rec.expectedService, 9)}  ${pad(rec.status, 17)}  ${pad(rec.stepCount, 5)}  ${pad(rec.programId || '-', 36)}  ${rec.scenario}`,
          'data'
        );
      }
    }
    this.log('─── Keep-data SQL queries ───────────────────────────────────────────', 'data');
    this.log("SELECT id, email, org_code_id, org_name, org_city, org_state FROM users WHERE email LIKE 'progorg_%@example.com';", 'data');
    this.log("SELECT id, org_code, organization, city, state FROM org_codes WHERE org_code LIKE 'TESTORGCTX%';", 'data');
    this.log("SELECT p.id, p.user_id, p.user_input, p.llm_used, LENGTH(p.therapy_response) AS therapy_len, COUNT(ps.id) AS step_count FROM programs p LEFT JOIN program_steps ps ON ps.program_id = p.id WHERE p.user_id IN (SELECT id FROM users WHERE email LIKE 'progorg_%@example.com') GROUP BY p.id ORDER BY p.created_at;", 'data');
    this.log("-- Inspect Hopeful (faith-based 7-day) output — expect reflection + bible_verse per day", 'data');
    this.log("SELECT p.id, SUBSTRING(p.therapy_response, 1, 600) AS preview FROM programs p WHERE p.id IN (" + this.programRecords.filter(r => r.expectedService === 'hopeful' && r.programId).map(r => `'${r.programId}'`).join(', ') + ");", 'data');
    this.log("-- Inspect Helpful (secular 14-day couples) output — expect conversation_starter + science_behind_it per day", 'data');
    this.log("SELECT p.id, SUBSTRING(p.therapy_response, 1, 600) AS preview FROM programs p WHERE p.id IN (" + this.programRecords.filter(r => r.expectedService === 'helpful' && r.programId).map(r => `'${r.programId}'`).join(', ') + ");", 'data');
    this.log('────────────────────────────────────────────────────────────────────', 'data');
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 PROGRAM ORG CONTEXT TEST RESULTS');
    console.log('='.repeat(60));
    if (this.programRecords.length > 0) {
      console.log('\nProgram records (scenario → expected service → program_id):');
      for (const rec of this.programRecords) {
        console.log(
          `  [${rec.expectedService.toUpperCase().padEnd(7)}] ` +
          `${rec.status.padEnd(17)} ` +
          `steps=${String(rec.stepCount).padEnd(2)} ` +
          `program_id=${rec.programId || '(none)'}  ` +
          `${rec.scenario}`
        );
      }
      console.log('');
    }
    console.log(`Total Tests:  ${this.testResults.total}`);
    console.log(`Passed:       ${this.testResults.passed}`);
    console.log(`Failed:       ${this.testResults.failed}`);
    const rate = this.testResults.total > 0
      ? Math.round((this.testResults.passed / this.testResults.total) * 100) : 0;
    console.log(`Success Rate: ${rate}%`);
    if (MOCK_OPENAI) {
      console.log('\n⚠️  Note: TEST_MOCK_OPENAI=true — async step generation not verified');
    }
    if (this.testResults.failed === 0) {
      console.log('\n🎉 All program org context tests passed!');
    } else {
      console.log('\n⚠️  Some tests failed. Review output above.');
    }
    console.log('='.repeat(60) + '\n');
  }

  // ─── Runner ───────────────────────────────────────────────────────────────

  async runAllTests() {
    this.log('🧪 Starting Program Org Context Test Suite', 'section');
    this.log(`OpenAI step verification: ${MOCK_OPENAI ? 'SKIPPED (TEST_MOCK_OPENAI=true)' : 'ENABLED'}`, 'info');
    if (this.keepData) this.log('🔒 KEEP DATA MODE: test data will NOT be cleaned up', 'data');
    console.log('='.repeat(60));

    try {
      await this.setup();

      const scenarios = [
        () => this.testNoOrg(),
        () => this.testAdminOrgLinked(),
        () => this.testCustomOrgAllFields(),
        () => this.testCustomOrgPartialFields(),
        () => this.testOrgDetachedBeforeCreation(),
        () => this.testSwitchCustomToAdminOrg(),
        () => this.testSwitchAdminToCustomOrg()
      ];

      for (const scenario of scenarios) {
        console.log('');
        await scenario();
        await this.sleep(500);
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
  const runner = new ProgramOrgContextTestRunner();
  runner.runAllTests()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error('Test runner error:', error);
      process.exit(1);
    });
}

module.exports = ProgramOrgContextTestRunner;
