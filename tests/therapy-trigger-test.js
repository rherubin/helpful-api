/**
 * Therapy Trigger Test Suite
 * Tests the checkAndTriggerTherapyResponse functionality
 * 
 * This test verifies that when both users in a pairing post messages to the same
 * program step, a therapy response is automatically generated and added as a
 * system message.
 * 
 * Run with: node tests/therapy-trigger-test.js
 * 
 * Environment Variables:
 * - TEST_BASE_URL: API base URL (default: http://127.0.0.1:9000)
 * - TEST_MOCK_OPENAI: When 'true', skips waiting for OpenAI-generated content
 */

const axios = require('axios');
const { generateTestEmail } = require('./test-helpers');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:9000';
const MOCK_OPENAI = process.env.TEST_MOCK_OPENAI === 'true';

class TherapyTriggerTestRunner {
  constructor() {
    this.baseURL = BASE_URL;
    this.timeout = 15000;
    this.testResults = {
      passed: 0,
      failed: 0,
      total: 0
    };
    this.testData = {
      user1: null,
      user2: null,
      pairingId: null,
      programId: null,
      stepId: null
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
   * Poll for system message in step messages
   */
  async pollForSystemMessage(stepId, token, maxWait = 10000) {
    if (MOCK_OPENAI) {
      this.log('TEST_MOCK_OPENAI=true, skipping system message wait', 'info');
      return { found: false, skipped: true, message: null };
    }

    const start = Date.now();
    while (Date.now() - start < maxWait) {
      try {
        const response = await axios.get(
          `${this.baseURL}/api/programSteps/${stepId}/messages`,
          {
            headers: { Authorization: `Bearer ${token}` },
            timeout: this.timeout
          }
        );
        
        // Look for a system message
        const systemMessage = response.data.messages?.find(
          msg => msg.message_type === 'system'
        );
        
        if (systemMessage) {
          return { found: true, message: systemMessage };
        }
      } catch (error) {
        // Continue polling
      }
      await this.sleep(500);
    }
    return { found: false, skipped: false, message: null };
  }

  /**
   * Setup: Create two users and establish a pairing
   */
  async setup() {
    this.log('Setting up test data for therapy trigger test...', 'section');
    
    try {
      // Create user 1
      const user1Email = generateTestEmail('therapy-trigger-1');
      const user1Response = await axios.post(`${this.baseURL}/api/users`, {
        email: user1Email,
        password: 'SecurePass987!',
        first_name: 'Alice',
        user_name: 'Alice'
      }, { timeout: this.timeout });
      
      this.testData.user1 = {
        id: user1Response.data.user.id,
        email: user1Email,
        token: user1Response.data.access_token,
        name: 'Alice'
      };
      this.log(`Created user 1: ${user1Email}`, 'info');

      // Create user 2
      const user2Email = generateTestEmail('therapy-trigger-2');
      const user2Response = await axios.post(`${this.baseURL}/api/users`, {
        email: user2Email,
        password: 'SecurePass987!',
        first_name: 'Bob',
        user_name: 'Bob'
      }, { timeout: this.timeout });
      
      this.testData.user2 = {
        id: user2Response.data.user.id,
        email: user2Email,
        token: user2Response.data.access_token,
        name: 'Bob'
      };
      this.log(`Created user 2: ${user2Email}`, 'info');

      // User 1 requests a pairing
      const pairingRequestResponse = await axios.post(
        `${this.baseURL}/api/pairing/request`,
        {},
        {
          headers: { Authorization: `Bearer ${this.testData.user1.token}` },
          timeout: this.timeout
        }
      );
      
      const partnerCode = pairingRequestResponse.data.partner_code;
      this.log(`User 1 created pairing request with code: ${partnerCode}`, 'info');

      // User 2 accepts the pairing
      await axios.post(
        `${this.baseURL}/api/pairing/accept`,
        { partner_code: partnerCode },
        {
          headers: { Authorization: `Bearer ${this.testData.user2.token}` },
          timeout: this.timeout
        }
      );
      this.log('User 2 accepted the pairing', 'info');

      // Get the accepted pairing ID
      const pairingsResponse = await axios.get(
        `${this.baseURL}/api/pairing/accepted`,
        {
          headers: { Authorization: `Bearer ${this.testData.user1.token}` },
          timeout: this.timeout
        }
      );
      
      if (pairingsResponse.data.pairings?.length > 0) {
        this.testData.pairingId = pairingsResponse.data.pairings[0].id;
        this.log(`Pairing established with ID: ${this.testData.pairingId}`, 'info');
      } else {
        throw new Error('No accepted pairing found');
      }

      return true;
    } catch (error) {
      this.log(`Setup failed: ${error.response?.data?.error || error.message}`, 'fail');
      return false;
    }
  }

  /**
   * Test: Both users post to same step triggers therapy response
   */
  async testBothUsersPostTriggersTherapyResponse() {
    this.log('Testing: Both users post to same step triggers therapy response', 'section');

    // Create a program with the pairing
    try {
      const programResponse = await axios.post(
        `${this.baseURL}/api/programs`,
        {
          user_input: 'We want to improve our communication and emotional connection.',
          pairing_id: this.testData.pairingId
        },
        {
          headers: { Authorization: `Bearer ${this.testData.user1.token}` },
          timeout: this.timeout
        }
      );

      this.testData.programId = programResponse.data.program.id;
      this.log(`Created program: ${this.testData.programId}`, 'info');

      this.assert(
        !!this.testData.programId,
        'Program created with pairing_id',
        `Program ID: ${this.testData.programId}`
      );
    } catch (error) {
      this.assert(false, 'Create program with pairing', `Error: ${error.response?.data?.error || error.message}`);
      return;
    }

    // Wait for program steps
    const pollResult = await this.pollForSteps(this.testData.programId, this.testData.user1.token);
    
    if (pollResult.found && pollResult.steps.length > 0) {
      this.testData.stepId = pollResult.steps[0].id;
      this.log(`Using step ID: ${this.testData.stepId}`, 'info');
    } else if (pollResult.skipped) {
      // Try to get steps anyway
      try {
        const stepsResponse = await axios.get(
          `${this.baseURL}/api/programs/${this.testData.programId}/programSteps`,
          {
            headers: { Authorization: `Bearer ${this.testData.user1.token}` },
            timeout: this.timeout
          }
        );
        if (stepsResponse.data.program_steps?.length > 0) {
          this.testData.stepId = stepsResponse.data.program_steps[0].id;
          this.log(`Found step ID: ${this.testData.stepId}`, 'info');
        }
      } catch (e) {
        // Ignore
      }
    }

    if (!this.testData.stepId) {
      this.log('No program steps available, cannot test therapy trigger', 'warn');
      if (!MOCK_OPENAI) {
        this.assert(false, 'Program steps available for therapy trigger test', 'No steps generated');
      }
      return;
    }

    // User 1 posts a message
    try {
      await axios.post(
        `${this.baseURL}/api/programSteps/${this.testData.stepId}/messages`,
        { content: 'I feel like we need to spend more quality time together. Sometimes I feel disconnected.' },
        {
          headers: { Authorization: `Bearer ${this.testData.user1.token}` },
          timeout: this.timeout
        }
      );
      this.log('User 1 posted message to step', 'info');

      this.assert(
        true,
        'User 1 can post message to shared program step',
        'Message posted successfully'
      );
    } catch (error) {
      this.assert(false, 'User 1 post message', `Error: ${error.response?.data?.error || error.message}`);
      return;
    }

    // Check messages - should only have user 1's message, no system message yet
    try {
      const messagesResponse = await axios.get(
        `${this.baseURL}/api/programSteps/${this.testData.stepId}/messages`,
        {
          headers: { Authorization: `Bearer ${this.testData.user1.token}` },
          timeout: this.timeout
        }
      );

      const systemMessages = messagesResponse.data.messages.filter(m => m.message_type === 'system');
      
      this.assert(
        systemMessages.length === 0,
        'No system message after only user 1 posts',
        `System messages: ${systemMessages.length}`
      );
    } catch (error) {
      this.assert(false, 'Check messages after user 1 post', `Error: ${error.response?.data?.error || error.message}`);
    }

    // User 2 posts a message
    try {
      await axios.post(
        `${this.baseURL}/api/programSteps/${this.testData.stepId}/messages`,
        { content: 'I agree, I have also been feeling that we should prioritize our time together more.' },
        {
          headers: { Authorization: `Bearer ${this.testData.user2.token}` },
          timeout: this.timeout
        }
      );
      this.log('User 2 posted message to step', 'info');

      this.assert(
        true,
        'User 2 can post message to shared program step',
        'Message posted successfully'
      );
    } catch (error) {
      this.assert(false, 'User 2 post message', `Error: ${error.response?.data?.error || error.message}`);
      return;
    }

    // Wait for therapy response to be generated (async, takes ~2 seconds)
    this.log('Waiting for therapy response to be generated...', 'info');
    const systemMsgResult = await this.pollForSystemMessage(this.testData.stepId, this.testData.user1.token, 10000);

    if (systemMsgResult.found) {
      this.assert(
        true,
        'System message generated after both users post',
        `Message type: ${systemMsgResult.message.message_type}`
      );

      this.assert(
        systemMsgResult.message.content && systemMsgResult.message.content.length > 0,
        'System message has content (therapy response)',
        `Content length: ${systemMsgResult.message.content?.length}`
      );

      this.assert(
        systemMsgResult.message.sender_id === null,
        'System message has null sender_id',
        `Sender ID: ${systemMsgResult.message.sender_id}`
      );
    } else if (systemMsgResult.skipped) {
      this.log('Skipped system message verification (TEST_MOCK_OPENAI=true)', 'warn');
    } else {
      this.assert(
        false,
        'System message generated after both users post',
        'No system message found within timeout'
      );
    }
  }

  /**
   * Test: Single user program (no pairing) does not trigger therapy response
   */
  async testSingleUserProgramNoTherapyTrigger() {
    this.log('Testing: Single user program (no pairing) does not trigger therapy response', 'section');

    // Skip if OpenAI is mocked
    if (MOCK_OPENAI) {
      this.log('Skipping single user test (TEST_MOCK_OPENAI=true)', 'warn');
      return;
    }

    let singleUserProgramId;
    let singleUserStepId;

    // Create a program WITHOUT pairing
    try {
      const programResponse = await axios.post(
        `${this.baseURL}/api/programs`,
        {
          user_input: 'Single user program for testing - no pairing.'
        },
        {
          headers: { Authorization: `Bearer ${this.testData.user1.token}` },
          timeout: this.timeout
        }
      );

      singleUserProgramId = programResponse.data.program.id;
      this.log(`Created single-user program: ${singleUserProgramId}`, 'info');
    } catch (error) {
      this.assert(false, 'Create single-user program', `Error: ${error.response?.data?.error || error.message}`);
      return;
    }

    // Wait for program steps
    const pollResult = await this.pollForSteps(singleUserProgramId, this.testData.user1.token);
    
    if (pollResult.found && pollResult.steps.length > 0) {
      singleUserStepId = pollResult.steps[0].id;
    } else {
      this.log('No steps for single-user program, skipping test', 'warn');
      return;
    }

    // User posts a message
    try {
      await axios.post(
        `${this.baseURL}/api/programSteps/${singleUserStepId}/messages`,
        { content: 'This is a message in a single-user program.' },
        {
          headers: { Authorization: `Bearer ${this.testData.user1.token}` },
          timeout: this.timeout
        }
      );
      this.log('User posted message to single-user step', 'info');
    } catch (error) {
      this.assert(false, 'Post message to single-user step', `Error: ${error.response?.data?.error || error.message}`);
      return;
    }

    // Wait a bit and check for system message (should NOT appear)
    await this.sleep(3000);

    try {
      const messagesResponse = await axios.get(
        `${this.baseURL}/api/programSteps/${singleUserStepId}/messages`,
        {
          headers: { Authorization: `Bearer ${this.testData.user1.token}` },
          timeout: this.timeout
        }
      );

      const systemMessages = messagesResponse.data.messages.filter(m => m.message_type === 'system');
      
      this.assert(
        systemMessages.length === 0,
        'No therapy response triggered for single-user program',
        `System messages: ${systemMessages.length}`
      );
    } catch (error) {
      this.assert(false, 'Check messages for single-user program', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Test: User 2 has access to shared program
   */
  async testPairedUserHasAccessToProgram() {
    this.log('Testing: Paired user has access to shared program', 'section');

    if (!this.testData.programId) {
      this.log('No program available, skipping access test', 'warn');
      return;
    }

    // User 2 should be able to access the program
    try {
      const response = await axios.get(
        `${this.baseURL}/api/programs/${this.testData.programId}`,
        {
          headers: { Authorization: `Bearer ${this.testData.user2.token}` },
          timeout: this.timeout
        }
      );

      this.assert(
        response.status === 200,
        'User 2 can access shared program',
        `Status: ${response.status}`
      );

      this.assert(
        response.data.program?.id === this.testData.programId,
        'User 2 sees correct program',
        `Program ID: ${response.data.program?.id}`
      );

    } catch (error) {
      this.assert(false, 'User 2 access shared program', `Error: ${error.response?.data?.error || error.message}`);
    }

    // User 2 should be able to access program steps
    if (this.testData.stepId) {
      try {
        const response = await axios.get(
          `${this.baseURL}/api/programSteps/${this.testData.stepId}`,
          {
            headers: { Authorization: `Bearer ${this.testData.user2.token}` },
            timeout: this.timeout
          }
        );

        this.assert(
          response.status === 200,
          'User 2 can access shared program step',
          `Status: ${response.status}`
        );

      } catch (error) {
        this.assert(false, 'User 2 access shared step', `Error: ${error.response?.data?.error || error.message}`);
      }
    }
  }

  /**
   * Test: Messages from both users are visible to both
   */
  async testBothUsersCanSeeAllMessages() {
    this.log('Testing: Both users can see all messages in shared step', 'section');

    if (!this.testData.stepId) {
      this.log('No step available, skipping message visibility test', 'warn');
      return;
    }

    // User 1 gets messages
    let user1Messages = [];
    try {
      const response = await axios.get(
        `${this.baseURL}/api/programSteps/${this.testData.stepId}/messages`,
        {
          headers: { Authorization: `Bearer ${this.testData.user1.token}` },
          timeout: this.timeout
        }
      );
      user1Messages = response.data.messages;
    } catch (error) {
      this.assert(false, 'User 1 get messages', `Error: ${error.response?.data?.error || error.message}`);
      return;
    }

    // User 2 gets messages
    let user2Messages = [];
    try {
      const response = await axios.get(
        `${this.baseURL}/api/programSteps/${this.testData.stepId}/messages`,
        {
          headers: { Authorization: `Bearer ${this.testData.user2.token}` },
          timeout: this.timeout
        }
      );
      user2Messages = response.data.messages;
    } catch (error) {
      this.assert(false, 'User 2 get messages', `Error: ${error.response?.data?.error || error.message}`);
      return;
    }

    // Both should see the same messages
    this.assert(
      user1Messages.length === user2Messages.length,
      'Both users see same number of messages',
      `User 1: ${user1Messages.length}, User 2: ${user2Messages.length}`
    );

    // Check that both user messages are present
    const user1Msgs = user1Messages.filter(m => m.sender_id === this.testData.user1.id);
    const user2Msgs = user1Messages.filter(m => m.sender_id === this.testData.user2.id);

    this.assert(
      user1Msgs.length > 0,
      'User 1 message is visible',
      `User 1 messages: ${user1Msgs.length}`
    );

    this.assert(
      user2Msgs.length > 0,
      'User 2 message is visible',
      `User 2 messages: ${user2Msgs.length}`
    );
  }

  /**
   * Print test summary
   */
  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 THERAPY TRIGGER TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Tests:  ${this.testResults.total}`);
    console.log(`Passed:       ${this.testResults.passed}`);
    console.log(`Failed:       ${this.testResults.failed}`);
    
    const successRate = this.testResults.total > 0 
      ? (this.testResults.passed / this.testResults.total * 100).toFixed(1) 
      : 0;
    console.log(`Success Rate: ${successRate}%`);
    
    if (MOCK_OPENAI) {
      console.log('\n⚠️  Note: TEST_MOCK_OPENAI=true - therapy response generation not verified');
    }
    
    console.log('='.repeat(60));
    
    return this.testResults.failed === 0;
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('🚀 Starting Therapy Trigger Test Suite');
    console.log(`📅 ${new Date().toISOString()}`);
    console.log(`🔗 Base URL: ${this.baseURL}`);
    console.log(`🤖 Mock OpenAI: ${MOCK_OPENAI}`);
    console.log('='.repeat(60));

    const setupSuccess = await this.setup();
    if (!setupSuccess) {
      this.log('Setup failed, aborting tests', 'fail');
      return false;
    }

    await this.testBothUsersPostTriggersTherapyResponse();
    await this.testPairedUserHasAccessToProgram();
    await this.testBothUsersCanSeeAllMessages();
    await this.testSingleUserProgramNoTherapyTrigger();

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
  
  const runner = new TherapyTriggerTestRunner();
  const success = await runner.runAllTests();
  process.exit(success ? 0 : 1);
})();

module.exports = TherapyTriggerTestRunner;

