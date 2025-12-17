/**
 * Programs Test Suite
 * Tests all /api/programs endpoints
 * 
 * Run with: node tests/programs-test.js
 * 
 * Environment Variables:
 * - TEST_BASE_URL: API base URL (default: http://127.0.0.1:9000)
 * - TEST_MOCK_OPENAI: When 'true', skips waiting for OpenAI-generated content
 */

require('dotenv').config();
const axios = require('axios');
const { generateTestEmail } = require('./test-helpers');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:9000';
const MOCK_OPENAI = process.env.TEST_MOCK_OPENAI === 'true';

class ProgramsTestRunner {
  constructor() {
    this.baseURL = BASE_URL;
    this.timeout = MOCK_OPENAI ? 15000 : 60000; // Longer timeout for real OpenAI calls
    this.testResults = {
      passed: 0,
      failed: 0,
      total: 0
    };
    this.testData = {
      user1: null,
      user2: null,
      programId: null
    };
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
      info: '📝',
      pass: '✅',
      fail: '❌',
      warn: '⚠️',
      section: '🧪'
    }[type] || '📝';
    
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  assert(condition, testName, details = '') {
    this.testResults.total++;
    if (condition) {
      this.testResults.passed++;
      this.log(`${testName} - PASSED ${details}`, 'pass');
      return true;
    } else {
      this.testResults.failed++;
      this.log(`${testName} - FAILED ${details}`, 'fail');
      return false;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Poll for program steps to be created (async OpenAI generation)
   */
  async pollForSteps(programId, token, maxWait = this.timeout) {
    if (MOCK_OPENAI) {
      this.log('TEST_MOCK_OPENAI=true, skipping step generation wait', 'info');
      return { found: false, skipped: true };
    }

    const start = Date.now();
    while (Date.now() - start < maxWait) {
      try {
        const response = await axios.get(`${this.baseURL}/api/programs/${programId}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: this.timeout
        });
        
        if (response.data.program?.program_steps?.length > 0) {
          return { found: true, steps: response.data.program.program_steps };
        }
      } catch (error) {
        // Continue polling
      }
      await this.sleep(1000);
    }
    return { found: false, skipped: false };
  }

  /**
   * Setup: Create test users
   */
  async setup() {
    this.log('Setting up test data...', 'section');
    
    try {
      // Create user 1
      const user1Email = generateTestEmail('programs-test-1');
      const user1Response = await axios.post(`${this.baseURL}/api/users`, {
        email: user1Email,
        password: 'SecurePass987!'
      }, { timeout: this.timeout });
      
      this.testData.user1 = {
        id: user1Response.data.user.id,
        email: user1Email,
        token: user1Response.data.access_token
      };
      this.log(`Created test user 1: ${user1Email}`, 'info');

      // Create user 2 (for authorization tests)
      const user2Email = generateTestEmail('programs-test-2');
      const user2Response = await axios.post(`${this.baseURL}/api/users`, {
        email: user2Email,
        password: 'SecurePass987!'
      }, { timeout: this.timeout });
      
      this.testData.user2 = {
        id: user2Response.data.user.id,
        email: user2Email,
        token: user2Response.data.access_token
      };
      this.log(`Created test user 2: ${user2Email}`, 'info');

      return true;
    } catch (error) {
      this.log(`Setup failed: ${error.response?.data?.error || error.message}`, 'fail');
      return false;
    }
  }

  /**
   * Test POST /api/programs - Create program
   */
  async testCreateProgram() {
    this.log('Testing POST /api/programs (Create Program)', 'section');
    const token = this.testData.user1.token;

    // Test 1: Valid creation
    try {
      const response = await axios.post(`${this.baseURL}/api/programs`, {
        user_input: 'We want to improve our communication skills and spend more quality time together.'
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });

      this.assert(
        response.status === 201,
        'Create program returns 201',
        `Status: ${response.status}`
      );

      this.assert(
        !!response.data.program?.id,
        'Create program returns program ID',
        `ID: ${response.data.program?.id}`
      );

      this.assert(
        response.data.message === 'Program created successfully',
        'Create program returns success message',
        `Message: ${response.data.message}`
      );

      this.assert(
        response.data.program?.user_id === this.testData.user1.id,
        'Program has correct user_id',
        `User ID: ${response.data.program?.user_id}`
      );

      // Store for later tests
      this.testData.programId = response.data.program.id;

      // Test async step generation (if not mocking)
      if (!MOCK_OPENAI) {
        this.log('Waiting for async OpenAI step generation...', 'info');
        const pollResult = await this.pollForSteps(this.testData.programId, token);
        
        this.assert(
          pollResult.found,
          'Program steps generated asynchronously',
          pollResult.found ? `Steps: ${pollResult.steps.length}` : 'Steps not generated within timeout'
        );
      } else {
        this.log('Skipping async step verification (TEST_MOCK_OPENAI=true)', 'warn');
      }

    } catch (error) {
      this.assert(false, 'Create program', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Test 2: Missing user_input (400)
    try {
      await axios.post(`${this.baseURL}/api/programs`, {}, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      this.assert(false, 'Create program without user_input returns 400', 'Expected 400 but got success');
    } catch (error) {
      this.assert(
        error.response?.status === 400,
        'Create program without user_input returns 400',
        `Status: ${error.response?.status}, Error: ${error.response?.data?.error}`
      );
    }

    // Test 3: No authentication (401)
    try {
      await axios.post(`${this.baseURL}/api/programs`, {
        user_input: 'Test input'
      }, { timeout: this.timeout });
      this.assert(false, 'Create program without auth returns 401', 'Expected 401 but got success');
    } catch (error) {
      this.assert(
        error.response?.status === 401,
        'Create program without auth returns 401',
        `Status: ${error.response?.status}`
      );
    }
  }

  /**
   * Test GET /api/programs - List programs
   */
  async testListPrograms() {
    this.log('Testing GET /api/programs (List Programs)', 'section');
    const token = this.testData.user1.token;

    try {
      const response = await axios.get(`${this.baseURL}/api/programs`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });

      this.assert(
        response.status === 200,
        'List programs returns 200',
        `Status: ${response.status}`
      );

      this.assert(
        Array.isArray(response.data.programs),
        'List programs returns array',
        `Type: ${typeof response.data.programs}`
      );

      this.assert(
        response.data.programs.length > 0,
        'List programs includes created program',
        `Count: ${response.data.programs.length}`
      );

      // Verify program structure includes program_steps
      const program = response.data.programs.find(p => p.id === this.testData.programId);
      this.assert(
        program && Array.isArray(program.program_steps),
        'Program includes program_steps array',
        `Has program_steps: ${!!program?.program_steps}`
      );

      this.assert(
        typeof program?.next_program_unlocked === 'boolean',
        'Program has boolean next_program_unlocked field',
        `Type: ${typeof program?.next_program_unlocked}`
      );

    } catch (error) {
      this.assert(false, 'List programs', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Test empty list for user2
    try {
      const response = await axios.get(`${this.baseURL}/api/programs`, {
        headers: { Authorization: `Bearer ${this.testData.user2.token}` },
        timeout: this.timeout
      });

      this.assert(
        response.data.programs.length === 0,
        'User 2 has empty programs list',
        `Count: ${response.data.programs.length}`
      );

    } catch (error) {
      this.assert(false, 'List programs for user 2', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Test GET /api/programs/:id - Get program by ID
   */
  async testGetProgramById() {
    this.log('Testing GET /api/programs/:id (Get Program by ID)', 'section');
    const token = this.testData.user1.token;

    // Test 1: Valid ID
    try {
      const response = await axios.get(`${this.baseURL}/api/programs/${this.testData.programId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });

      this.assert(
        response.status === 200,
        'Get program by ID returns 200',
        `Status: ${response.status}`
      );

      this.assert(
        response.data.program?.id === this.testData.programId,
        'Get program returns correct program',
        `ID: ${response.data.program?.id}`
      );

      this.assert(
        Array.isArray(response.data.program?.program_steps),
        'Get program includes program_steps array',
        `Steps count: ${response.data.program?.program_steps?.length}`
      );

    } catch (error) {
      this.assert(false, 'Get program by ID', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Test 2: Not found (404)
    try {
      await axios.get(`${this.baseURL}/api/programs/nonexistent-id-12345`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      this.assert(false, 'Get nonexistent program returns 404', 'Expected 404 but got success');
    } catch (error) {
      this.assert(
        error.response?.status === 404,
        'Get nonexistent program returns 404',
        `Status: ${error.response?.status}`
      );
    }

    // Test 3: Unauthorized access (403)
    try {
      await axios.get(`${this.baseURL}/api/programs/${this.testData.programId}`, {
        headers: { Authorization: `Bearer ${this.testData.user2.token}` },
        timeout: this.timeout
      });
      this.assert(false, 'User 2 accessing user 1 program returns 403', 'Expected 403 but got success');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'User 2 accessing user 1 program returns 403',
        `Status: ${error.response?.status}`
      );
    }
  }

  /**
   * Test POST /api/programs/:id/therapy_response - Manual therapy response trigger
   */
  async testManualTherapyResponse() {
    this.log('Testing POST /api/programs/:id/therapy_response (Manual Trigger)', 'section');
    const token = this.testData.user1.token;

    // First, create a program without waiting for steps
    let newProgramId;
    try {
      const createResponse = await axios.post(`${this.baseURL}/api/programs`, {
        user_input: 'Test program for manual therapy response trigger'
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      newProgramId = createResponse.data.program.id;
    } catch (error) {
      this.assert(false, 'Create program for therapy response test', `Error: ${error.message}`);
      return;
    }

    // Wait a moment for async generation to potentially start
    await this.sleep(500);

    // Test: Try to trigger therapy response (may return 409 if steps already exist, or 202 if not)
    try {
      const response = await axios.post(
        `${this.baseURL}/api/programs/${newProgramId}/therapy_response`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: this.timeout
        }
      );

      // If we get here, it returned 202 (accepted)
      this.assert(
        response.status === 202,
        'Manual therapy response returns 202 Accepted',
        `Status: ${response.status}`
      );

      this.assert(
        response.data.status === 'processing',
        'Manual therapy response returns processing status',
        `Status: ${response.data.status}`
      );

    } catch (error) {
      if (error.response?.status === 409) {
        // Steps already exist - this is expected if OpenAI generated them quickly
        this.assert(
          true,
          'Manual therapy response returns 409 when steps exist',
          `Status: ${error.response?.status}, Steps count: ${error.response?.data?.existing_steps_count}`
        );
      } else if (error.response?.status === 503) {
        // OpenAI not configured
        this.assert(
          true,
          'Manual therapy response returns 503 when OpenAI not configured',
          `Status: ${error.response?.status}`
        );
      } else {
        this.assert(false, 'Manual therapy response', `Error: ${error.response?.data?.error || error.message}`);
      }
    }

    // Test: Unauthorized access (403)
    try {
      await axios.post(
        `${this.baseURL}/api/programs/${newProgramId}/therapy_response`,
        {},
        {
          headers: { Authorization: `Bearer ${this.testData.user2.token}` },
          timeout: this.timeout
        }
      );
      this.assert(false, 'User 2 triggering therapy on user 1 program returns 403', 'Expected 403');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'User 2 triggering therapy on user 1 program returns 403',
        `Status: ${error.response?.status}`
      );
    }

    // Test: Not found (404)
    try {
      await axios.post(
        `${this.baseURL}/api/programs/nonexistent-id-12345/therapy_response`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: this.timeout
        }
      );
      this.assert(false, 'Therapy response on nonexistent program returns 404', 'Expected 404');
    } catch (error) {
      this.assert(
        error.response?.status === 404,
        'Therapy response on nonexistent program returns 404',
        `Status: ${error.response?.status}`
      );
    }
  }

  /**
   * Test POST /api/programs/:id/next_program - Create next program
   */
  async testNextProgram() {
    this.log('Testing POST /api/programs/:id/next_program (Create Next Program)', 'section');
    const token = this.testData.user1.token;

    // Test 1: Previous program not unlocked (403)
    try {
      await axios.post(
        `${this.baseURL}/api/programs/${this.testData.programId}/next_program`,
        { user_input: 'Continue with next phase of our journey' },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: this.timeout
        }
      );
      this.assert(false, 'Next program with locked previous returns 403', 'Expected 403');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Next program with locked previous returns 403',
        `Status: ${error.response?.status}, Error: ${error.response?.data?.error}`
      );

      this.assert(
        error.response?.data?.current_unlock_status?.next_program_unlocked === false,
        'Error includes unlock status info',
        `Unlock status: ${JSON.stringify(error.response?.data?.current_unlock_status)}`
      );
    }

    // Test 2: Missing user_input (400)
    try {
      await axios.post(
        `${this.baseURL}/api/programs/${this.testData.programId}/next_program`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: this.timeout
        }
      );
      this.assert(false, 'Next program without user_input returns 400', 'Expected 400');
    } catch (error) {
      // Could be 400 or 403 depending on order of validation
      this.assert(
        error.response?.status === 400 || error.response?.status === 403,
        'Next program without user_input returns 400 or 403',
        `Status: ${error.response?.status}`
      );
    }

    // Test 3: Unauthorized access (403)
    try {
      await axios.post(
        `${this.baseURL}/api/programs/${this.testData.programId}/next_program`,
        { user_input: 'Test' },
        {
          headers: { Authorization: `Bearer ${this.testData.user2.token}` },
          timeout: this.timeout
        }
      );
      this.assert(false, 'User 2 creating next program on user 1 program returns 403', 'Expected 403');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'User 2 creating next program on user 1 program returns 403',
        `Status: ${error.response?.status}`
      );
    }

    // Test 4: Not found (404)
    try {
      await axios.post(
        `${this.baseURL}/api/programs/nonexistent-id-12345/next_program`,
        { user_input: 'Test' },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: this.timeout
        }
      );
      this.assert(false, 'Next program on nonexistent program returns 404', 'Expected 404');
    } catch (error) {
      this.assert(
        error.response?.status === 404,
        'Next program on nonexistent program returns 404',
        `Status: ${error.response?.status}`
      );
    }
  }

  /**
   * Test GET /api/programs/metrics - Get OpenAI metrics
   */
  async testGetMetrics() {
    this.log('Testing GET /api/programs/metrics (OpenAI Metrics)', 'section');
    const token = this.testData.user1.token;

    try {
      const response = await axios.get(`${this.baseURL}/api/programs/metrics`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });

      this.assert(
        response.status === 200,
        'Get metrics returns 200',
        `Status: ${response.status}`
      );

      this.assert(
        response.data.metrics !== undefined,
        'Get metrics returns metrics object',
        `Has metrics: ${!!response.data.metrics}`
      );

      this.assert(
        !!response.data.timestamp,
        'Get metrics includes timestamp',
        `Timestamp: ${response.data.timestamp}`
      );

    } catch (error) {
      // 503 is acceptable if ChatGPT service not available
      if (error.response?.status === 503) {
        this.assert(
          true,
          'Get metrics returns 503 when ChatGPT service unavailable',
          `Status: ${error.response?.status}`
        );
      } else {
        this.assert(false, 'Get metrics', `Error: ${error.response?.data?.error || error.message}`);
      }
    }
  }

  /**
   * Test DELETE /api/programs/:id - Delete program
   */
  async testDeleteProgram() {
    this.log('Testing DELETE /api/programs/:id (Delete Program)', 'section');
    const token = this.testData.user1.token;

    // Create a program to delete
    let deleteTargetId;
    try {
      const createResponse = await axios.post(`${this.baseURL}/api/programs`, {
        user_input: 'Program to be deleted'
      }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      deleteTargetId = createResponse.data.program.id;
    } catch (error) {
      this.assert(false, 'Create program for delete test', `Error: ${error.message}`);
      return;
    }

    // Test 1: User 2 cannot delete user 1's program (403)
    try {
      await axios.delete(`${this.baseURL}/api/programs/${deleteTargetId}`, {
        headers: { Authorization: `Bearer ${this.testData.user2.token}` },
        timeout: this.timeout
      });
      this.assert(false, 'User 2 deleting user 1 program returns 403', 'Expected 403');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'User 2 deleting user 1 program returns 403',
        `Status: ${error.response?.status}`
      );
    }

    // Test 2: Valid delete
    try {
      const response = await axios.delete(`${this.baseURL}/api/programs/${deleteTargetId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });

      this.assert(
        response.status === 200,
        'Delete program returns 200',
        `Status: ${response.status}`
      );

    } catch (error) {
      this.assert(false, 'Delete program', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Test 3: Verify program is deleted (should return 404 now)
    try {
      await axios.get(`${this.baseURL}/api/programs/${deleteTargetId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      this.assert(false, 'Get deleted program returns 404', 'Expected 404 but got success');
    } catch (error) {
      this.assert(
        error.response?.status === 404,
        'Get deleted program returns 404',
        `Status: ${error.response?.status}`
      );
    }

    // Test 4: Delete nonexistent program (404)
    try {
      await axios.delete(`${this.baseURL}/api/programs/nonexistent-id-12345`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: this.timeout
      });
      this.assert(false, 'Delete nonexistent program returns 404', 'Expected 404');
    } catch (error) {
      this.assert(
        error.response?.status === 404,
        'Delete nonexistent program returns 404',
        `Status: ${error.response?.status}`
      );
    }
  }

  /**
   * Print test summary
   */
  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 PROGRAMS TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Tests:  ${this.testResults.total}`);
    console.log(`Passed:       ${this.testResults.passed}`);
    console.log(`Failed:       ${this.testResults.failed}`);
    
    const successRate = this.testResults.total > 0 
      ? (this.testResults.passed / this.testResults.total * 100).toFixed(1) 
      : 0;
    console.log(`Success Rate: ${successRate}%`);
    
    if (MOCK_OPENAI) {
      console.log('\n⚠️  Note: TEST_MOCK_OPENAI=true - async step generation not verified');
    }
    
    console.log('='.repeat(60));
    
    return this.testResults.failed === 0;
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('🚀 Starting Programs Test Suite');
    console.log(`📅 ${new Date().toISOString()}`);
    console.log(`🔗 Base URL: ${this.baseURL}`);
    console.log(`🤖 Mock OpenAI: ${MOCK_OPENAI}`);
    console.log('='.repeat(60));

    const setupSuccess = await this.setup();
    if (!setupSuccess) {
      this.log('Setup failed, aborting tests', 'fail');
      return false;
    }

    await this.testCreateProgram();
    await this.testListPrograms();
    await this.testGetProgramById();
    await this.testManualTherapyResponse();
    await this.testNextProgram();
    await this.testGetMetrics();
    await this.testDeleteProgram();

    return this.printSummary();
  }
}

// Check if server is running
async function checkServer() {
  try {
    await axios.get(`${BASE_URL}/health`, { timeout: 3000 });
    return true;
  } catch (error) {
    return false;
  }
}

// Main
(async () => {
  console.log('Checking if server is running...');
  const running = await checkServer();
  
  if (!running) {
    console.error('❌ Server not running at', BASE_URL);
    console.error('Start the server with: npm start');
    process.exit(1);
  }
  
  console.log('✅ Server is running\n');
  
  const runner = new ProgramsTestRunner();
  const success = await runner.runAllTests();
  process.exit(success ? 0 : 1);
})();

module.exports = ProgramsTestRunner;

