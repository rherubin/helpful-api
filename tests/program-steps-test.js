/**
 * Program Steps Test Suite
 * Tests all /api/programSteps endpoints
 * 
 * Run with: node tests/program-steps-test.js
 * 
 * Environment Variables:
 * - TEST_BASE_URL: API base URL (default: http://127.0.0.1:9000)
 * - TEST_MOCK_OPENAI: When 'true', skips waiting for OpenAI-generated steps
 */

require('dotenv').config();
const axios = require('axios');
const { generateTestEmail } = require('./test-helpers');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:9000';
const MOCK_OPENAI = process.env.TEST_MOCK_OPENAI === 'true';

class ProgramStepsTestRunner {
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
      programId: null,
      programSteps: []
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
  async pollForSteps(programId, token, maxWait = 15000) {
    if (MOCK_OPENAI) {
      this.log('TEST_MOCK_OPENAI=true, skipping step generation wait', 'info');
      return { found: false, skipped: true, steps: [] };
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
    return { found: false, skipped: false, steps: [] };
  }

  /**
   * Setup: Create test users and a program with steps
   */
  async setup() {
    this.log('Setting up test data...', 'section');
    
    try {
      // Create user 1
      const user1Email = generateTestEmail('steps-test-1');
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
      const user2Email = generateTestEmail('steps-test-2');
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

      // Create a program
      const programResponse = await axios.post(`${this.baseURL}/api/programs`, {
        user_input: 'We want to work on building trust and emotional intimacy in our relationship.'
      }, {
        headers: { Authorization: `Bearer ${this.testData.user1.token}` },
        timeout: this.timeout
      });
      
      this.testData.programId = programResponse.data.program.id;
      this.log(`Created program: ${this.testData.programId}`, 'info');

      // Wait for program steps to be generated
      const pollResult = await this.pollForSteps(this.testData.programId, this.testData.user1.token);
      
      if (pollResult.found) {
        this.testData.programSteps = pollResult.steps;
        this.log(`Program steps generated: ${this.testData.programSteps.length} steps`, 'info');
      } else if (pollResult.skipped) {
        this.log('OpenAI mocked - program steps may not be available', 'warn');
      } else {
        this.log('Program steps not generated within timeout', 'warn');
      }

      return true;
    } catch (error) {
      this.log(`Setup failed: ${error.response?.data?.error || error.message}`, 'fail');
      return false;
    }
  }

  /**
   * Test GET /api/programs/:programId/programSteps - List program steps
   */
  async testListProgramSteps() {
    this.log('Testing GET /api/programs/:programId/programSteps (List Steps)', 'section');
    const token = this.testData.user1.token;

    // Test 1: Valid request
    try {
      const response = await axios.get(
        `${this.baseURL}/api/programs/${this.testData.programId}/programSteps`,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: this.timeout
        }
      );

      this.assert(
        response.status === 200,
        'List program steps returns 200',
        `Status: ${response.status}`
      );

      this.assert(
        Array.isArray(response.data.program_steps),
        'List program steps returns array',
        `Type: ${typeof response.data.program_steps}`
      );

      this.assert(
        typeof response.data.total_steps === 'number',
        'List program steps includes total_steps count',
        `Total: ${response.data.total_steps}`
      );

      // Store steps for later tests
      if (response.data.program_steps.length > 0) {
        this.testData.programSteps = response.data.program_steps;
      }

      // Verify step structure if steps exist
      if (response.data.program_steps.length > 0) {
        const step = response.data.program_steps[0];
        
        this.assert(
          typeof step.id === 'string',
          'Program step has id field',
          `ID: ${step.id}`
        );

        this.assert(
          typeof step.day === 'number',
          'Program step has day field (number)',
          `Day: ${step.day}`
        );

        this.assert(
          typeof step.theme === 'string',
          'Program step has theme field',
          `Theme: ${step.theme?.substring(0, 30)}...`
        );

        this.assert(
          step.conversation_starter === undefined || typeof step.conversation_starter === 'string',
          'Program step has conversation_starter field (string or null)',
          `Has conversation_starter: ${!!step.conversation_starter}`
        );

        this.assert(
          step.science_behind_it === undefined || typeof step.science_behind_it === 'string',
          'Program step has science_behind_it field (string or null)',
          `Has science_behind_it: ${!!step.science_behind_it}`
        );

        this.assert(
          typeof step.started === 'boolean',
          'Program step has started field (boolean)',
          `Started: ${step.started}`
        );
      } else if (!MOCK_OPENAI) {
        this.assert(false, 'Program has steps', 'No steps generated');
      }

    } catch (error) {
      this.assert(false, 'List program steps', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Test 2: Unauthorized access (403)
    try {
      await axios.get(
        `${this.baseURL}/api/programs/${this.testData.programId}/programSteps`,
        {
          headers: { Authorization: `Bearer ${this.testData.user2.token}` },
          timeout: this.timeout
        }
      );
      this.assert(false, 'User 2 accessing user 1 program steps returns 403', 'Expected 403');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'User 2 accessing user 1 program steps returns 403',
        `Status: ${error.response?.status}`
      );
    }

    // Test 3: No authentication (401)
    try {
      await axios.get(
        `${this.baseURL}/api/programs/${this.testData.programId}/programSteps`,
        { timeout: this.timeout }
      );
      this.assert(false, 'Unauthenticated access returns 401', 'Expected 401');
    } catch (error) {
      this.assert(
        error.response?.status === 401,
        'Unauthenticated access returns 401',
        `Status: ${error.response?.status}`
      );
    }
  }

  /**
   * Test GET /api/programSteps/:id - Get program step by ID
   */
  async testGetProgramStepById() {
    this.log('Testing GET /api/programSteps/:id (Get Step by ID)', 'section');
    const token = this.testData.user1.token;

    // Skip if no steps available
    if (this.testData.programSteps.length === 0) {
      this.log('No program steps available, skipping get-by-id tests', 'warn');
      if (!MOCK_OPENAI) {
        this.assert(false, 'Program steps available for testing', 'No steps generated');
      }
      return;
    }

    const stepId = this.testData.programSteps[0].id;

    // Test 1: Valid request
    try {
      const response = await axios.get(
        `${this.baseURL}/api/programSteps/${stepId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: this.timeout
        }
      );

      this.assert(
        response.status === 200,
        'Get program step by ID returns 200',
        `Status: ${response.status}`
      );

      this.assert(
        response.data.step?.id === stepId,
        'Get program step returns correct step',
        `ID: ${response.data.step?.id}`
      );

      this.assert(
        response.data.message === 'Program step retrieved successfully',
        'Get program step returns success message',
        `Message: ${response.data.message}`
      );

      // Verify full step structure
      const step = response.data.step;
      
      this.assert(
        typeof step.program_id === 'string',
        'Program step includes program_id',
        `Program ID: ${step.program_id}`
      );

      this.assert(
        typeof step.day === 'number',
        'Program step includes day (number)',
        `Day: ${step.day}`
      );

      this.assert(
        typeof step.started === 'boolean',
        'Program step includes started (boolean)',
        `Started: ${step.started}`
      );

    } catch (error) {
      this.assert(false, 'Get program step by ID', `Error: ${error.response?.data?.error || error.message}`);
    }

    // Test 2: Not found (404)
    try {
      await axios.get(
        `${this.baseURL}/api/programSteps/nonexistent-step-id-12345`,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: this.timeout
        }
      );
      this.assert(false, 'Get nonexistent step returns 404', 'Expected 404');
    } catch (error) {
      this.assert(
        error.response?.status === 404,
        'Get nonexistent step returns 404',
        `Status: ${error.response?.status}`
      );
    }

    // Test 3: Unauthorized access (403)
    try {
      await axios.get(
        `${this.baseURL}/api/programSteps/${stepId}`,
        {
          headers: { Authorization: `Bearer ${this.testData.user2.token}` },
          timeout: this.timeout
        }
      );
      this.assert(false, 'User 2 accessing user 1 step returns 403', 'Expected 403');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'User 2 accessing user 1 step returns 403',
        `Status: ${error.response?.status}`
      );
    }

    // Test 4: No authentication (401)
    try {
      await axios.get(
        `${this.baseURL}/api/programSteps/${stepId}`,
        { timeout: this.timeout }
      );
      this.assert(false, 'Unauthenticated access to step returns 401', 'Expected 401');
    } catch (error) {
      this.assert(
        error.response?.status === 401,
        'Unauthenticated access to step returns 401',
        `Status: ${error.response?.status}`
      );
    }
  }

  /**
   * Test step ordering and structure
   */
  async testStepOrderingAndStructure() {
    this.log('Testing Program Step Ordering and Structure', 'section');

    // Skip if no steps available
    if (this.testData.programSteps.length === 0) {
      this.log('No program steps available, skipping ordering tests', 'warn');
      return;
    }

    // Test: Steps are ordered by day
    const days = this.testData.programSteps.map(s => s.day);
    const sortedDays = [...days].sort((a, b) => a - b);
    
    this.assert(
      JSON.stringify(days) === JSON.stringify(sortedDays),
      'Program steps are ordered by day',
      `Days order: ${days.join(', ')}`
    );

    // Test: Days are sequential (typically 1-14)
    const hasSequentialDays = days.every((day, index) => index === 0 || day >= days[index - 1]);
    this.assert(
      hasSequentialDays,
      'Program steps have sequential days',
      `First day: ${days[0]}, Last day: ${days[days.length - 1]}`
    );

    // Test: All steps have required fields
    const requiredFields = ['id', 'day', 'theme', 'started'];
    const allHaveRequiredFields = this.testData.programSteps.every(step =>
      requiredFields.every(field => step.hasOwnProperty(field))
    );

    this.assert(
      allHaveRequiredFields,
      'All program steps have required fields',
      `Required: ${requiredFields.join(', ')}`
    );

    // Test: All started fields are boolean
    const allStartedBoolean = this.testData.programSteps.every(step => 
      typeof step.started === 'boolean'
    );

    this.assert(
      allStartedBoolean,
      'All started fields are boolean type',
      `Checked ${this.testData.programSteps.length} steps`
    );
  }

  /**
   * Print test summary
   */
  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 PROGRAM STEPS TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Tests:  ${this.testResults.total}`);
    console.log(`Passed:       ${this.testResults.passed}`);
    console.log(`Failed:       ${this.testResults.failed}`);
    
    const successRate = this.testResults.total > 0 
      ? (this.testResults.passed / this.testResults.total * 100).toFixed(1) 
      : 0;
    console.log(`Success Rate: ${successRate}%`);
    
    if (MOCK_OPENAI) {
      console.log('\n⚠️  Note: TEST_MOCK_OPENAI=true - some step tests may be skipped');
    }
    
    if (this.testData.programSteps.length === 0) {
      console.log('\n⚠️  Note: No program steps were available for detailed testing');
    }
    
    console.log('='.repeat(60));
    
    return this.testResults.failed === 0;
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('🚀 Starting Program Steps Test Suite');
    console.log(`📅 ${new Date().toISOString()}`);
    console.log(`🔗 Base URL: ${this.baseURL}`);
    console.log(`🤖 Mock OpenAI: ${MOCK_OPENAI}`);
    console.log('='.repeat(60));

    const setupSuccess = await this.setup();
    if (!setupSuccess) {
      this.log('Setup failed, aborting tests', 'fail');
      return false;
    }

    await this.testListProgramSteps();
    await this.testGetProgramStepById();
    await this.testStepOrderingAndStructure();

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
  
  const runner = new ProgramStepsTestRunner();
  const success = await runner.runAllTests();
  process.exit(success ? 0 : 1);
})();

module.exports = ProgramStepsTestRunner;

