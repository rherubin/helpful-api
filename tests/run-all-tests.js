const SecurityTestRunner = require('./security-test');
const LoadTestRunner = require('./load-test');
const AuthTestRunner = require('./auth-test');
const UserCreationTestRunner = require('./user-creation-test');
const PairingsEndpointTestRunner = require('./pairings-endpoint-test');
const UserProfileTestRunner = require('./user-profile-test');
const RefreshTokenResetTestRunner = require('./refresh-token-reset-test');
const ProgramsTestRunner = require('./programs-test');
const ProgramStepsTestRunner = require('./program-steps-test');
const MessagesTestRunner = require('./messages-test');
const TherapyTriggerTestRunner = require('./therapy-trigger-test');
const WWWAuthenticateTestRunner = require('./www-authenticate-test');
const SubscriptionTestRunner = require('./subscription-test');
const UserOrgCodeTestRunner = require('./user-org-code-test');
const DeviceTokenTestRunner = require('./device-tokens-test');
const HelpfulPromptServiceTestRunner = require('./helpful-prompt-service-test');
const HopefulPromptServiceTestRunner = require('./hopeful-prompt-service-test');
const ProgramOrgContextTestRunner = require('./program-org-context-test');

/**
 * Comprehensive test suite runner for CI/CD pipeline
 * Runs all test categories in sequence
 * Run with: node tests/run-all-tests.js
 */

class TestSuiteRunner {
  constructor(options = {}) {
    this.options = {
      runSecurity: options.runSecurity !== false, // Default true
      runLoad: options.runLoad !== false, // Default true
      runAuth: options.runAuth !== false, // Default true
      runUserCreation: options.runUserCreation !== false, // Default true
      runPairingsEndpoint: options.runPairingsEndpoint !== false, // Default true
      runUserProfile: options.runUserProfile !== false, // Default true
      runRefreshTokenReset: options.runRefreshTokenReset !== false, // Default true
      runPrograms: options.runPrograms !== false, // Default true
      runProgramSteps: options.runProgramSteps !== false, // Default true
      runMessages: options.runMessages !== false, // Default true
      runTherapyTrigger: options.runTherapyTrigger !== false, // Default true
      runWWWAuthenticate: options.runWWWAuthenticate !== false, // Default true
      runSubscription: options.runSubscription !== false, // Default true
      runUserOrgCode: options.runUserOrgCode !== false, // Default true
      runDeviceTokens: options.runDeviceTokens !== false, // Default true
      runHelpfulPromptService: options.runHelpfulPromptService !== false, // Default true
      runHopefulPromptService: options.runHopefulPromptService !== false, // Default true
      runProgramOrgContext: options.runProgramOrgContext !== false, // Default true
      baseURL: options.baseURL || 'http://127.0.0.1:9000',
      timeout: options.timeout || 30000,
      skipServerCheck: options.skipServerCheck || false
    };
    
    this.results = {
      security: null,
      load: null,
      auth: null,
      userCreation: null,
      pairingsEndpoint: null,
      userProfile: null,
      refreshTokenReset: null,
      programs: null,
      programSteps: null,
      messages: null,
      therapyTrigger: null,
      wwwAuthenticate: null,
      subscription: null,
      userOrgCode: null,
      deviceTokens: null,
      helpfulPromptService: null,
      hopefulPromptService: null,
      programOrgContext: null,
      startTime: Date.now(),
      endTime: null
    };
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
      info: '📝',
      success: '✅',
      error: '❌',
      warn: '⚠️',
      section: '🎯'
    }[type] || '📝';
    
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  // Check if server is running
  async checkServerHealth() {
    if (this.options.skipServerCheck) {
      this.log('Skipping server health check', 'warn');
      return true;
    }

    try {
      const axios = require('axios');
      const response = await axios.get(`${this.options.baseURL}/health`, { 
        timeout: 5000 
      });
      
      if (response.status === 200) {
        this.log(`Server is running at ${this.options.baseURL}`, 'success');
        return true;
      } else {
        this.log(`Server responded with status ${response.status}`, 'error');
        return false;
      }
    } catch (error) {
      this.log(`Server health check failed: ${error.message}`, 'error');
      this.log('Make sure the server is running with: node server.js', 'warn');
      return false;
    }
  }

  // Run security tests
  async runSecurityTests() {
    if (!this.options.runSecurity) {
      this.log('Skipping security tests', 'warn');
      return { skipped: true };
    }

    this.log('🔒 Running Security Test Suite', 'section');
    
    try {
      const securityRunner = new SecurityTestRunner();
      const success = await securityRunner.runAllTests();
      
      this.results.security = {
        success,
        passed: securityRunner.testResults.passed,
        failed: securityRunner.testResults.failed,
        total: securityRunner.testResults.total
      };
      
      return this.results.security;
    } catch (error) {
      this.log(`Security tests failed: ${error.message}`, 'error');
      this.results.security = { success: false, error: error.message };
      return this.results.security;
    }
  }

  // Run load tests
  async runLoadTests() {
    if (!this.options.runLoad) {
      this.log('Skipping load tests', 'warn');
      return { skipped: true };
    }

    this.log('🚀 Running Load Test Suite', 'section');
    
    try {
      const loadRunner = new LoadTestRunner({
        baseURL: this.options.baseURL,
        timeout: this.options.timeout
      });
      
      const success = await loadRunner.runFullTestSuite();
      
      this.results.load = {
        success,
        testResults: loadRunner.testResults
      };
      
      return this.results.load;
    } catch (error) {
      this.log(`Load tests failed: ${error.message}`, 'error');
      this.results.load = { success: false, error: error.message };
      return this.results.load;
    }
  }

  async runAuthTests() {
    this.log('🔐 Running Authentication Tests', 'section');
    
    try {
      const authRunner = new AuthTestRunner();
      const success = await authRunner.runAllTests();
      
      this.results.auth = { 
        success, 
        skipped: false,
        details: 'User registration, login, token refresh, and logout tests'
      };
      
      if (success) {
        this.log('Authentication tests completed successfully', 'success');
      } else {
        this.log('Authentication tests failed', 'error');
      }
      
      return this.results.auth;
    } catch (error) {
      this.log(`Authentication tests failed: ${error.message}`, 'error');
      this.results.auth = { success: false, error: error.message };
      return this.results.auth;
    }
  }

  async runUserCreationTests() {
    if (!this.options.runUserCreation) {
      this.log('Skipping user creation tests', 'warn');
      return { skipped: true };
    }

    this.log('👥 Running User Creation Test Suite', 'section');

    try {
      const userCreationRunner = new UserCreationTestRunner({
        baseURL: this.options.baseURL,
        timeout: this.options.timeout
      });
      const success = await userCreationRunner.runAllTests();

      this.results.userCreation = {
        success,
        skipped: false,
        details: 'POST /users endpoint functionality including pairings',
        passed: userCreationRunner.testResults.passed,
        failed: userCreationRunner.testResults.failed,
        total: userCreationRunner.testResults.total
      };

      if (success) {
        this.log('User creation tests completed successfully', 'success');
      } else {
        this.log('User creation tests failed', 'error');
      }

      return this.results.userCreation;
    } catch (error) {
      this.log(`User creation tests failed: ${error.message}`, 'error');
      this.results.userCreation = { success: false, error: error.message };
      return this.results.userCreation;
    }
  }

  async runPairingsEndpointTests() {
    if (!this.options.runPairingsEndpoint) {
      this.log('Skipping pairings endpoint tests', 'warn');
      return { skipped: true };
    }

    this.log('👫 Running Pairings Endpoint Test Suite', 'section');

    try {
      const pairingsEndpointRunner = new PairingsEndpointTestRunner({
        baseURL: this.options.baseURL,
        timeout: this.options.timeout
      });
      const success = await pairingsEndpointRunner.runAllTests();

      this.results.pairingsEndpoint = {
        success,
        skipped: false,
        details: 'GET /api/pairings endpoint with accepted and pending pairings',
        passed: pairingsEndpointRunner.testResults.passed,
        failed: pairingsEndpointRunner.testResults.failed,
        total: pairingsEndpointRunner.testResults.total
      };

      if (success) {
        this.log('Pairings endpoint tests completed successfully', 'success');
      } else {
        this.log('Pairings endpoint tests failed', 'error');
      }

      return this.results.pairingsEndpoint;
    } catch (error) {
      this.log(`Pairings endpoint tests failed: ${error.message}`, 'error');
      this.results.pairingsEndpoint = { success: false, error: error.message };
      return this.results.pairingsEndpoint;
    }
  }

  async runUserProfileTests() {
    if (!this.options.runUserProfile) {
      this.log('Skipping user profile tests', 'warn');
      return { skipped: true };
    }

    this.log('👤 Running User Profile Test Suite', 'section');

    try {
      const userProfileRunner = new UserProfileTestRunner({
        baseURL: this.options.baseURL,
        timeout: this.options.timeout
      });
      const success = await userProfileRunner.runAllTests();

      this.results.userProfile = {
        success,
        skipped: false,
        details: 'GET /api/profile endpoint with pairings integration',
        passed: userProfileRunner.testResults.passed,
        failed: userProfileRunner.testResults.failed,
        total: userProfileRunner.testResults.total
      };

      if (success) {
        this.log('User profile tests completed successfully', 'success');
      } else {
        this.log('User profile tests failed', 'error');
      }

      return this.results.userProfile;
    } catch (error) {
      this.log(`User profile tests failed: ${error.message}`, 'error');
      this.results.userProfile = { success: false, error: error.message };
      return this.results.userProfile;
    }
  }

  async runRefreshTokenResetTests() {
    if (!this.options.runRefreshTokenReset) {
      this.log('Skipping refresh token reset tests', 'warn');
      return { skipped: true };
    }

    this.log('🔄 Running Refresh Token Reset Test Suite', 'section');

    try {
      const refreshTokenResetRunner = new RefreshTokenResetTestRunner({
        baseURL: this.options.baseURL,
        timeout: this.options.timeout
      });
      const success = await refreshTokenResetRunner.runAllTests();

      this.results.refreshTokenReset = {
        success,
        skipped: false,
        details: 'Automatic refresh token expiration reset on API calls',
        passed: refreshTokenResetRunner.testResults.passed,
        failed: refreshTokenResetRunner.testResults.failed,
        total: refreshTokenResetRunner.testResults.total
      };

      if (success) {
        this.log('Refresh token reset tests completed successfully', 'success');
      } else {
        this.log('Refresh token reset tests failed', 'error');
      }

      return this.results.refreshTokenReset;
    } catch (error) {
      this.log(`Refresh token reset tests failed: ${error.message}`, 'error');
      this.results.refreshTokenReset = { success: false, error: error.message };
      return this.results.refreshTokenReset;
    }
  }

  async runProgramsTests() {
    if (!this.options.runPrograms) {
      this.log('Skipping programs tests', 'warn');
      return { skipped: true };
    }

    this.log('📋 Running Programs Test Suite', 'section');

    try {
      const programsRunner = new ProgramsTestRunner();
      const success = await programsRunner.runAllTests();

      this.results.programs = {
        success,
        skipped: false,
        details: 'Program CRUD endpoints and async OpenAI generation',
        passed: programsRunner.testResults.passed,
        failed: programsRunner.testResults.failed,
        total: programsRunner.testResults.total
      };

      if (success) {
        this.log('Programs tests completed successfully', 'success');
      } else {
        this.log('Programs tests failed', 'error');
      }

      return this.results.programs;
    } catch (error) {
      this.log(`Programs tests failed: ${error.message}`, 'error');
      this.results.programs = { success: false, error: error.message };
      return this.results.programs;
    }
  }

  async runProgramStepsTests() {
    if (!this.options.runProgramSteps) {
      this.log('Skipping program steps tests', 'warn');
      return { skipped: true };
    }

    this.log('📝 Running Program Steps Test Suite', 'section');

    try {
      const programStepsRunner = new ProgramStepsTestRunner();
      const success = await programStepsRunner.runAllTests();

      this.results.programSteps = {
        success,
        skipped: false,
        details: 'Program step endpoints and structure verification',
        passed: programStepsRunner.testResults.passed,
        failed: programStepsRunner.testResults.failed,
        total: programStepsRunner.testResults.total
      };

      if (success) {
        this.log('Program steps tests completed successfully', 'success');
      } else {
        this.log('Program steps tests failed', 'error');
      }

      return this.results.programSteps;
    } catch (error) {
      this.log(`Program steps tests failed: ${error.message}`, 'error');
      this.results.programSteps = { success: false, error: error.message };
      return this.results.programSteps;
    }
  }

  async runMessagesTests() {
    if (!this.options.runMessages) {
      this.log('Skipping messages tests', 'warn');
      return { skipped: true };
    }

    this.log('💬 Running Messages Test Suite', 'section');

    try {
      const messagesRunner = new MessagesTestRunner();
      const success = await messagesRunner.runAllTests();

      this.results.messages = {
        success,
        skipped: false,
        details: 'Message CRUD within program steps',
        passed: messagesRunner.testResults.passed,
        failed: messagesRunner.testResults.failed,
        total: messagesRunner.testResults.total
      };

      if (success) {
        this.log('Messages tests completed successfully', 'success');
      } else {
        this.log('Messages tests failed', 'error');
      }

      return this.results.messages;
    } catch (error) {
      this.log(`Messages tests failed: ${error.message}`, 'error');
      this.results.messages = { success: false, error: error.message };
      return this.results.messages;
    }
  }

  async runTherapyTriggerTests() {
    if (!this.options.runTherapyTrigger) {
      this.log('Skipping therapy trigger tests', 'warn');
      return { skipped: true };
    }

    this.log('💕 Running Therapy Trigger Test Suite', 'section');

    try {
      const therapyTriggerRunner = new TherapyTriggerTestRunner();
      const success = await therapyTriggerRunner.runAllTests();

      this.results.therapyTrigger = {
        success,
        skipped: false,
        details: 'Both users post triggers therapy response',
        passed: therapyTriggerRunner.testResults.passed,
        failed: therapyTriggerRunner.testResults.failed,
        total: therapyTriggerRunner.testResults.total
      };

      if (success) {
        this.log('Therapy trigger tests completed successfully', 'success');
      } else {
        this.log('Therapy trigger tests failed', 'error');
      }

      return this.results.therapyTrigger;
    } catch (error) {
      this.log(`Therapy trigger tests failed: ${error.message}`, 'error');
      this.results.therapyTrigger = { success: false, error: error.message };
      return this.results.therapyTrigger;
    }
  }

  async runWWWAuthenticateTests() {
    if (!this.options.runWWWAuthenticate) {
      this.log('Skipping WWW-Authenticate tests', 'warn');
      return { skipped: true };
    }

    this.log('🛡️ Running WWW-Authenticate Header Test Suite', 'section');

    try {
      const runner = new WWWAuthenticateTestRunner({
        baseURL: this.options.baseURL,
        timeout: this.options.timeout
      });
      const success = await runner.runAllTests();

      this.results.wwwAuthenticate = {
        success,
        skipped: false,
        details: 'WWW-Authenticate header present on 401 responses',
        passed: runner.testResults.passed,
        failed: runner.testResults.failed,
        total: runner.testResults.total
      };

      if (success) {
        this.log('WWW-Authenticate tests completed successfully', 'success');
      } else {
        this.log('WWW-Authenticate tests failed', 'error');
      }

      return this.results.wwwAuthenticate;
    } catch (error) {
      this.log(`WWW-Authenticate tests failed: ${error.message}`, 'error');
      this.results.wwwAuthenticate = { success: false, error: error.message };
      return this.results.wwwAuthenticate;
    }
  }

  async runSubscriptionTests() {
    if (!this.options.runSubscription) {
      this.log('Skipping subscription tests', 'warn');
      return { skipped: true };
    }

    this.log('💳 Running Subscription Test Suite', 'section');

    try {
      const runner = new SubscriptionTestRunner({
        baseURL: this.options.baseURL,
        timeout: this.options.timeout
      });
      const success = await runner.runAllTests();

      this.results.subscription = {
        success,
        skipped: false,
        details: 'POST /api/subscription iOS/Android receipt handling',
        passed: runner.testResults.passed,
        failed: runner.testResults.failed,
        total: runner.testResults.total
      };

      if (success) {
        this.log('Subscription tests completed successfully', 'success');
      } else {
        this.log('Subscription tests failed', 'error');
      }

      return this.results.subscription;
    } catch (error) {
      this.log(`Subscription tests failed: ${error.message}`, 'error');
      this.results.subscription = { success: false, error: error.message };
      return this.results.subscription;
    }
  }

  async runHelpfulPromptServiceTests() {
    if (!this.options.runHelpfulPromptService) {
      this.log('Skipping HelpfulPromptService unit tests', 'warn');
      return { skipped: true };
    }

    this.log('💞 Running HelpfulPromptService Unit Test Suite', 'section');

    try {
      const runner = new HelpfulPromptServiceTestRunner();
      const success = await runner.run();

      this.results.helpfulPromptService = {
        success,
        skipped: false,
        details: 'Secular 14-day couples EFT/Gottman prompt service - fully mocked fetch (no live OpenAI)',
        passed: runner.testResults.passed,
        failed: runner.testResults.failed,
        total: runner.testResults.total
      };

      if (success) {
        this.log('HelpfulPromptService unit tests completed successfully', 'success');
      } else {
        this.log('HelpfulPromptService unit tests failed', 'error');
      }

      return this.results.helpfulPromptService;
    } catch (error) {
      this.log(`HelpfulPromptService unit tests failed: ${error.message}`, 'error');
      this.results.helpfulPromptService = { success: false, error: error.message };
      return this.results.helpfulPromptService;
    }
  }

  async runProgramOrgContextTests() {
    if (!this.options.runProgramOrgContext) {
      this.log('Skipping program org context tests', 'warn');
      return { skipped: true };
    }

    this.log('🗂️ Running Program Org Context Test Suite', 'section');

    try {
      const runner = new ProgramOrgContextTestRunner({
        baseURL: this.options.baseURL
      });
      const success = await runner.runAllTests();

      this.results.programOrgContext = {
        success,
        skipped: false,
        details: 'End-to-end org-context routing: Helpful (14-day couples) vs Hopeful (7-day faith)',
        passed: runner.testResults.passed,
        failed: runner.testResults.failed,
        total: runner.testResults.total
      };

      if (success) {
        this.log('Program org context tests completed successfully', 'success');
      } else {
        this.log('Program org context tests failed', 'error');
      }

      return this.results.programOrgContext;
    } catch (error) {
      this.log(`Program org context tests failed: ${error.message}`, 'error');
      this.results.programOrgContext = { success: false, error: error.message };
      return this.results.programOrgContext;
    }
  }

  async runHopefulPromptServiceTests() {
    if (!this.options.runHopefulPromptService) {
      this.log('Skipping HopefulPromptService unit tests', 'warn');
      return { skipped: true };
    }

    this.log('🙏 Running HopefulPromptService Unit Test Suite', 'section');

    try {
      const runner = new HopefulPromptServiceTestRunner();
      const success = await runner.run();

      this.results.hopefulPromptService = {
        success,
        skipped: false,
        details: 'Faith-based 7-day reflection prompt service - fully mocked fetch (no live OpenAI)',
        passed: runner.testResults.passed,
        failed: runner.testResults.failed,
        total: runner.testResults.total
      };

      if (success) {
        this.log('HopefulPromptService unit tests completed successfully', 'success');
      } else {
        this.log('HopefulPromptService unit tests failed', 'error');
      }

      return this.results.hopefulPromptService;
    } catch (error) {
      this.log(`HopefulPromptService unit tests failed: ${error.message}`, 'error');
      this.results.hopefulPromptService = { success: false, error: error.message };
      return this.results.hopefulPromptService;
    }
  }

  async runUserOrgCodeTests() {
    if (!this.options.runUserOrgCode) {
      this.log('Skipping user org code tests', 'warn');
      return { skipped: true };
    }

    this.log('🏢 Running User Org Code Test Suite', 'section');

    try {
      const runner = new UserOrgCodeTestRunner({
        baseURL: this.options.baseURL,
        timeout: this.options.timeout
      });
      const success = await runner.runAllTests();

      this.results.userOrgCode = {
        success,
        skipped: false,
        details: 'PUT /api/users/:id org_code linking (admin + custom paths)',
        passed: runner.testResults.passed,
        failed: runner.testResults.failed,
        total: runner.testResults.total
      };

      if (success) {
        this.log('User org code tests completed successfully', 'success');
      } else {
        this.log('User org code tests failed', 'error');
      }

      return this.results.userOrgCode;
    } catch (error) {
      this.log(`User org code tests failed: ${error.message}`, 'error');
      this.results.userOrgCode = { success: false, error: error.message };
      return this.results.userOrgCode;
    }
  }

  async runDeviceTokenTests() {
    if (!this.options.runDeviceTokens) {
      this.log('Skipping device tokens tests', 'warn');
      return { skipped: true };
    }

    this.log('📱 Running Device Tokens Test Suite', 'section');

    try {
      const runner = new DeviceTokenTestRunner({
        baseURL: this.options.baseURL,
        timeout: this.options.timeout
      });
      const success = await runner.runAllTests();

      this.results.deviceTokens = {
        success,
        skipped: false,
        details: 'POST/GET/DELETE /api/device-tokens for push notification registration (multi-device support)',
        passed: runner.testResults.passed,
        failed: runner.testResults.failed,
        total: runner.testResults.total
      };

      if (success) {
        this.log('Device tokens tests completed successfully', 'success');
      } else {
        this.log('Device tokens tests failed', 'error');
      }

      return this.results.deviceTokens;
    } catch (error) {
      this.log(`Device tokens tests failed: ${error.message}`, 'error');
      this.results.deviceTokens = { success: false, error: error.message };
      return this.results.deviceTokens;
    }
  }

  // Run all test suites
  async runAllTests() {
    this.log('🎯 Starting Comprehensive Test Suite', 'section');
    this.log(`Test Configuration:`, 'info');
    this.log(`  Base URL: ${this.options.baseURL}`, 'info');
    this.log(`  Timeout: ${this.options.timeout}ms`, 'info');
    this.log(`  Security Tests: ${this.options.runSecurity ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  Load Tests: ${this.options.runLoad ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  Authentication Tests: ${this.options.runAuth ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  User Creation Tests: ${this.options.runUserCreation ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  Pairings Endpoint Tests: ${this.options.runPairingsEndpoint ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  User Profile Tests: ${this.options.runUserProfile ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  Refresh Token Reset Tests: ${this.options.runRefreshTokenReset ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  Programs Tests: ${this.options.runPrograms ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  Program Steps Tests: ${this.options.runProgramSteps ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  Messages Tests: ${this.options.runMessages ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  Therapy Trigger Tests: ${this.options.runTherapyTrigger ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  WWW-Authenticate Tests: ${this.options.runWWWAuthenticate ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  Subscription Tests: ${this.options.runSubscription ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  User Org Code Tests: ${this.options.runUserOrgCode ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  Device Tokens Tests: ${this.options.runDeviceTokens ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  HelpfulPromptService Unit Tests: ${this.options.runHelpfulPromptService ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  HopefulPromptService Unit Tests: ${this.options.runHopefulPromptService ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  Program Org Context Tests: ${this.options.runProgramOrgContext ? 'Enabled' : 'Disabled'}`, 'info');
    console.log('');

    // Check server health
    const serverOk = await this.checkServerHealth();
    if (!serverOk && !this.options.skipServerCheck) {
      this.log('Cannot proceed without server running', 'error');
      return false;
    }
    console.log('');

    let overallSuccess = true;

    // Run security tests
    if (this.options.runSecurity) {
      await this.runSecurityTests();
      if (this.results.security && !this.results.security.success && !this.results.security.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    // Run load tests
    if (this.options.runLoad) {
      await this.runLoadTests();
      if (this.results.load && !this.results.load.success && !this.results.load.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    // Run authentication tests
    if (this.options.runAuth) {
      await this.runAuthTests();
      if (this.results.auth && !this.results.auth.success && !this.results.auth.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    // Run user creation tests
    if (this.options.runUserCreation) {
      await this.runUserCreationTests();
      if (this.results.userCreation && !this.results.userCreation.success && !this.results.userCreation.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    // Run pairings endpoint tests
    if (this.options.runPairingsEndpoint) {
      await this.runPairingsEndpointTests();
      if (this.results.pairingsEndpoint && !this.results.pairingsEndpoint.success && !this.results.pairingsEndpoint.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    // Run user profile tests
    if (this.options.runUserProfile) {
      await this.runUserProfileTests();
      if (this.results.userProfile && !this.results.userProfile.success && !this.results.userProfile.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    // Run refresh token reset tests
    if (this.options.runRefreshTokenReset) {
      await this.runRefreshTokenResetTests();
      if (this.results.refreshTokenReset && !this.results.refreshTokenReset.success && !this.results.refreshTokenReset.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    // Run programs tests
    if (this.options.runPrograms) {
      await this.runProgramsTests();
      if (this.results.programs && !this.results.programs.success && !this.results.programs.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    // Run program steps tests
    if (this.options.runProgramSteps) {
      await this.runProgramStepsTests();
      if (this.results.programSteps && !this.results.programSteps.success && !this.results.programSteps.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    // Run messages tests
    if (this.options.runMessages) {
      await this.runMessagesTests();
      if (this.results.messages && !this.results.messages.success && !this.results.messages.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    // Run therapy trigger tests
    if (this.options.runTherapyTrigger) {
      await this.runTherapyTriggerTests();
      if (this.results.therapyTrigger && !this.results.therapyTrigger.success && !this.results.therapyTrigger.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    // Run WWW-Authenticate tests
    if (this.options.runWWWAuthenticate) {
      await this.runWWWAuthenticateTests();
      if (this.results.wwwAuthenticate && !this.results.wwwAuthenticate.success && !this.results.wwwAuthenticate.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    // Run subscription tests
    if (this.options.runSubscription) {
      await this.runSubscriptionTests();
      if (this.results.subscription && !this.results.subscription.success && !this.results.subscription.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    // Run user org code tests
    if (this.options.runUserOrgCode) {
      await this.runUserOrgCodeTests();
      if (this.results.userOrgCode && !this.results.userOrgCode.success && !this.results.userOrgCode.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    // Run device tokens tests
    if (this.options.runDeviceTokens) {
      await this.runDeviceTokenTests();
      if (this.results.deviceTokens && !this.results.deviceTokens.success && !this.results.deviceTokens.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    // Run HelpfulPromptService unit tests (fully mocked, no live OpenAI)
    if (this.options.runHelpfulPromptService) {
      await this.runHelpfulPromptServiceTests();
      if (this.results.helpfulPromptService && !this.results.helpfulPromptService.success && !this.results.helpfulPromptService.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    // Run HopefulPromptService unit tests (fully mocked, no live OpenAI)
    if (this.options.runHopefulPromptService) {
      await this.runHopefulPromptServiceTests();
      if (this.results.hopefulPromptService && !this.results.hopefulPromptService.success && !this.results.hopefulPromptService.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    // Run program org context tests (end-to-end service routing check)
    if (this.options.runProgramOrgContext) {
      await this.runProgramOrgContextTests();
      if (this.results.programOrgContext && !this.results.programOrgContext.success && !this.results.programOrgContext.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    this.results.endTime = Date.now();
    this.printOverallSummary(overallSuccess);

    return overallSuccess;
  }

  // Print comprehensive summary
  printOverallSummary(overallSuccess) {
    const duration = this.results.endTime - this.results.startTime;
    
    this.log('🎯 Comprehensive Test Suite Summary', 'section');
    this.log(`Total Duration: ${(duration / 1000).toFixed(2)} seconds`);
    console.log('');

    // Security test results
    if (this.results.security) {
      if (this.results.security.skipped) {
        this.log('🔒 Security Tests: SKIPPED', 'warn');
      } else if (this.results.security.success) {
        this.log(`🔒 Security Tests: PASSED (${this.results.security.passed}/${this.results.security.total})`, 'success');
      } else {
        this.log(`🔒 Security Tests: FAILED (${this.results.security.failed}/${this.results.security.total} failures)`, 'error');
      }
    }

    // Load test results
    if (this.results.load) {
      if (this.results.load.skipped) {
        this.log('🚀 Load Tests: SKIPPED', 'warn');
      } else if (this.results.load.success) {
        this.log('🚀 Load Tests: PASSED', 'success');
      } else {
        this.log('🚀 Load Tests: FAILED', 'error');
      }
    }

    // Authentication test results
    if (this.results.auth) {
      if (this.results.auth.skipped) {
        this.log('🔐 Authentication Tests: SKIPPED', 'warn');
      } else if (this.results.auth.success) {
        this.log('🔐 Authentication Tests: PASSED', 'success');
      } else {
        this.log('🔐 Authentication Tests: FAILED', 'error');
      }
    }

    // User creation test results
    if (this.results.userCreation) {
      if (this.results.userCreation.skipped) {
        this.log('👥 User Creation Tests: SKIPPED', 'warn');
      } else if (this.results.userCreation.success) {
        this.log(`👥 User Creation Tests: PASSED (${this.results.userCreation.passed}/${this.results.userCreation.total})`, 'success');
      } else {
        this.log(`👥 User Creation Tests: FAILED (${this.results.userCreation.failed}/${this.results.userCreation.total} failures)`, 'error');
      }
    }

    // Pairings endpoint test results
    if (this.results.pairingsEndpoint) {
      if (this.results.pairingsEndpoint.skipped) {
        this.log('👫 Pairings Endpoint Tests: SKIPPED', 'warn');
      } else if (this.results.pairingsEndpoint.success) {
        this.log(`👫 Pairings Endpoint Tests: PASSED (${this.results.pairingsEndpoint.passed}/${this.results.pairingsEndpoint.total})`, 'success');
      } else {
        this.log(`👫 Pairings Endpoint Tests: FAILED (${this.results.pairingsEndpoint.failed}/${this.results.pairingsEndpoint.total} failures)`, 'error');
      }
    }

    // User profile test results
    if (this.results.userProfile) {
      if (this.results.userProfile.skipped) {
        this.log('👤 User Profile Tests: SKIPPED', 'warn');
      } else if (this.results.userProfile.success) {
        this.log(`👤 User Profile Tests: PASSED (${this.results.userProfile.passed}/${this.results.userProfile.total})`, 'success');
      } else {
        this.log(`👤 User Profile Tests: FAILED (${this.results.userProfile.failed}/${this.results.userProfile.total} failures)`, 'error');
      }
    }

    // Refresh token reset test results
    if (this.results.refreshTokenReset) {
      if (this.results.refreshTokenReset.skipped) {
        this.log('🔄 Refresh Token Reset Tests: SKIPPED', 'warn');
      } else if (this.results.refreshTokenReset.success) {
        this.log(`🔄 Refresh Token Reset Tests: PASSED (${this.results.refreshTokenReset.passed}/${this.results.refreshTokenReset.total})`, 'success');
      } else {
        this.log(`🔄 Refresh Token Reset Tests: FAILED (${this.results.refreshTokenReset.failed}/${this.results.refreshTokenReset.total} failures)`, 'error');
      }
    }

    // Programs test results
    if (this.results.programs) {
      if (this.results.programs.skipped) {
        this.log('📋 Programs Tests: SKIPPED', 'warn');
      } else if (this.results.programs.success) {
        this.log(`📋 Programs Tests: PASSED (${this.results.programs.passed}/${this.results.programs.total})`, 'success');
      } else {
        this.log(`📋 Programs Tests: FAILED (${this.results.programs.failed}/${this.results.programs.total} failures)`, 'error');
      }
    }

    // Program steps test results
    if (this.results.programSteps) {
      if (this.results.programSteps.skipped) {
        this.log('📝 Program Steps Tests: SKIPPED', 'warn');
      } else if (this.results.programSteps.success) {
        this.log(`📝 Program Steps Tests: PASSED (${this.results.programSteps.passed}/${this.results.programSteps.total})`, 'success');
      } else {
        this.log(`📝 Program Steps Tests: FAILED (${this.results.programSteps.failed}/${this.results.programSteps.total} failures)`, 'error');
      }
    }

    // Messages test results
    if (this.results.messages) {
      if (this.results.messages.skipped) {
        this.log('💬 Messages Tests: SKIPPED', 'warn');
      } else if (this.results.messages.success) {
        this.log(`💬 Messages Tests: PASSED (${this.results.messages.passed}/${this.results.messages.total})`, 'success');
      } else {
        this.log(`💬 Messages Tests: FAILED (${this.results.messages.failed}/${this.results.messages.total} failures)`, 'error');
      }
    }

    // Therapy trigger test results
    if (this.results.therapyTrigger) {
      if (this.results.therapyTrigger.skipped) {
        this.log('💕 Therapy Trigger Tests: SKIPPED', 'warn');
      } else if (this.results.therapyTrigger.success) {
        this.log(`💕 Therapy Trigger Tests: PASSED (${this.results.therapyTrigger.passed}/${this.results.therapyTrigger.total})`, 'success');
      } else {
        this.log(`💕 Therapy Trigger Tests: FAILED (${this.results.therapyTrigger.failed}/${this.results.therapyTrigger.total} failures)`, 'error');
      }
    }

    // WWW-Authenticate test results
    if (this.results.wwwAuthenticate) {
      if (this.results.wwwAuthenticate.skipped) {
        this.log('🛡️ WWW-Authenticate Tests: SKIPPED', 'warn');
      } else if (this.results.wwwAuthenticate.success) {
        this.log(`🛡️ WWW-Authenticate Tests: PASSED (${this.results.wwwAuthenticate.passed}/${this.results.wwwAuthenticate.total})`, 'success');
      } else {
        this.log(`🛡️ WWW-Authenticate Tests: FAILED (${this.results.wwwAuthenticate.failed}/${this.results.wwwAuthenticate.total} failures)`, 'error');
      }
    }

    // Subscription test results
    if (this.results.subscription) {
      if (this.results.subscription.skipped) {
        this.log('💳 Subscription Tests: SKIPPED', 'warn');
      } else if (this.results.subscription.success) {
        this.log(`💳 Subscription Tests: PASSED (${this.results.subscription.passed}/${this.results.subscription.total})`, 'success');
      } else {
        this.log(`💳 Subscription Tests: FAILED (${this.results.subscription.failed}/${this.results.subscription.total} failures)`, 'error');
      }
    }

    // User org code test results
    if (this.results.userOrgCode) {
      if (this.results.userOrgCode.skipped) {
        this.log('🏢 User Org Code Tests: SKIPPED', 'warn');
      } else if (this.results.userOrgCode.success) {
        this.log(`🏢 User Org Code Tests: PASSED (${this.results.userOrgCode.passed}/${this.results.userOrgCode.total})`, 'success');
      } else {
        this.log(`🏢 User Org Code Tests: FAILED (${this.results.userOrgCode.failed}/${this.results.userOrgCode.total} failures)`, 'error');
      }
    }

    // Device tokens test results
    if (this.results.deviceTokens) {
      if (this.results.deviceTokens.skipped) {
        this.log('📱 Device Tokens Tests: SKIPPED', 'warn');
      } else if (this.results.deviceTokens.success) {
        this.log(`📱 Device Tokens Tests: PASSED (${this.results.deviceTokens.passed}/${this.results.deviceTokens.total})`, 'success');
      } else {
        this.log(`📱 Device Tokens Tests: FAILED (${this.results.deviceTokens.failed}/${this.results.deviceTokens.total} failures)`, 'error');
      }
    }

    // HelpfulPromptService unit test results
    if (this.results.helpfulPromptService) {
      if (this.results.helpfulPromptService.skipped) {
        this.log('💞 HelpfulPromptService Unit Tests: SKIPPED', 'warn');
      } else if (this.results.helpfulPromptService.success) {
        this.log(`💞 HelpfulPromptService Unit Tests: PASSED (${this.results.helpfulPromptService.passed}/${this.results.helpfulPromptService.total})`, 'success');
      } else {
        this.log(`💞 HelpfulPromptService Unit Tests: FAILED (${this.results.helpfulPromptService.failed}/${this.results.helpfulPromptService.total} failures)`, 'error');
      }
    }

    // HopefulPromptService unit test results
    if (this.results.hopefulPromptService) {
      if (this.results.hopefulPromptService.skipped) {
        this.log('🙏 HopefulPromptService Unit Tests: SKIPPED', 'warn');
      } else if (this.results.hopefulPromptService.success) {
        this.log(`🙏 HopefulPromptService Unit Tests: PASSED (${this.results.hopefulPromptService.passed}/${this.results.hopefulPromptService.total})`, 'success');
      } else {
        this.log(`🙏 HopefulPromptService Unit Tests: FAILED (${this.results.hopefulPromptService.failed}/${this.results.hopefulPromptService.total} failures)`, 'error');
      }
    }

    // Program org context test results
    if (this.results.programOrgContext) {
      if (this.results.programOrgContext.skipped) {
        this.log('🗂️ Program Org Context Tests: SKIPPED', 'warn');
      } else if (this.results.programOrgContext.success) {
        this.log(`🗂️ Program Org Context Tests: PASSED (${this.results.programOrgContext.passed}/${this.results.programOrgContext.total})`, 'success');
      } else {
        this.log(`🗂️ Program Org Context Tests: FAILED (${this.results.programOrgContext.failed}/${this.results.programOrgContext.total} failures)`, 'error');
      }
    }

    console.log('');

    // Overall result
    if (overallSuccess) {
      this.log('🎉 ALL TESTS PASSED - API is ready for production!', 'success');
      this.log('✅ Security: Prompt injection protection working', 'success');
      this.log('✅ Functionality: All endpoints working correctly', 'success');
      this.log('✅ Performance: API handles concurrent load well', 'success');
    } else {
      this.log('❌ SOME TESTS FAILED - Review failures before deployment', 'error');
      this.log('Please fix the failing tests before proceeding to production', 'warn');
    }

    // CI/CD recommendations
    console.log('');
    this.log('🔧 CI/CD Integration Tips:', 'section');
    this.log('• Add to package.json scripts: "test": "node tests/run-all-tests.js"');
    this.log('• Use exit codes for CI: 0 = success, 1 = failure');
    this.log('• Run security tests on every commit');
    this.log('• Run load tests before production deployments');
    this.log('• Set up automated testing in your deployment pipeline');
  }

  // Generate JSON report for CI systems
  generateJSONReport() {
    return {
      timestamp: new Date().toISOString(),
      duration: this.results.endTime - this.results.startTime,
      success: this.results.security?.success && this.results.load?.success &&
               this.results.auth?.success && this.results.userCreation?.success &&
               this.results.pairingsEndpoint?.success && this.results.userProfile?.success &&
               this.results.refreshTokenReset?.success &&
               this.results.programs?.success &&
               this.results.programSteps?.success && this.results.messages?.success &&
               this.results.therapyTrigger?.success &&
               this.results.wwwAuthenticate?.success && this.results.subscription?.success &&
               this.results.userOrgCode?.success && this.results.deviceTokens?.success &&
               this.results.helpfulPromptService?.success &&
               this.results.hopefulPromptService?.success && this.results.programOrgContext?.success,
      results: {
        security: this.results.security,
        load: this.results.load,
        auth: this.results.auth,
        userCreation: this.results.userCreation,
        pairingsEndpoint: this.results.pairingsEndpoint,
        userProfile: this.results.userProfile,
        refreshTokenReset: this.results.refreshTokenReset,
        programs: this.results.programs,
        programSteps: this.results.programSteps,
        messages: this.results.messages,
        therapyTrigger: this.results.therapyTrigger,
        wwwAuthenticate: this.results.wwwAuthenticate,
        subscription: this.results.subscription,
        userOrgCode: this.results.userOrgCode,
        deviceTokens: this.results.deviceTokens,
        helpfulPromptService: this.results.helpfulPromptService,
        hopefulPromptService: this.results.hopefulPromptService,
        programOrgContext: this.results.programOrgContext
      },
      summary: {
        totalTests: (this.results.security?.total || 0) +
                   (this.results.userCreation?.total || 0) + (this.results.pairingsEndpoint?.total || 0) + (this.results.userProfile?.total || 0) +
                   (this.results.refreshTokenReset?.total || 0) + (this.results.programs?.total || 0) + (this.results.programSteps?.total || 0) +
                   (this.results.messages?.total || 0) + (this.results.therapyTrigger?.total || 0) +
                   (this.results.wwwAuthenticate?.total || 0) + (this.results.subscription?.total || 0) +
                   (this.results.userOrgCode?.total || 0) + (this.results.deviceTokens?.total || 0) +
                   (this.results.helpfulPromptService?.total || 0) +
                   (this.results.hopefulPromptService?.total || 0) + (this.results.programOrgContext?.total || 0),
        totalPassed: (this.results.security?.passed || 0) +
                    (this.results.userCreation?.passed || 0) + (this.results.pairingsEndpoint?.passed || 0) + (this.results.userProfile?.passed || 0) +
                    (this.results.refreshTokenReset?.passed || 0) + (this.results.programs?.passed || 0) + (this.results.programSteps?.passed || 0) +
                    (this.results.messages?.passed || 0) + (this.results.therapyTrigger?.passed || 0) +
                    (this.results.wwwAuthenticate?.passed || 0) + (this.results.subscription?.passed || 0) +
                    (this.results.userOrgCode?.passed || 0) + (this.results.deviceTokens?.passed || 0) +
                    (this.results.helpfulPromptService?.passed || 0) +
                    (this.results.hopefulPromptService?.passed || 0) + (this.results.programOrgContext?.passed || 0),
        totalFailed: (this.results.security?.failed || 0) +
                    (this.results.userCreation?.failed || 0) + (this.results.pairingsEndpoint?.failed || 0) + (this.results.userProfile?.failed || 0) +
                    (this.results.refreshTokenReset?.failed || 0) + (this.results.programs?.failed || 0) + (this.results.programSteps?.failed || 0) +
                    (this.results.messages?.failed || 0) + (this.results.therapyTrigger?.failed || 0) +
                    (this.results.wwwAuthenticate?.failed || 0) + (this.results.subscription?.failed || 0) +
                    (this.results.userOrgCode?.failed || 0) + (this.results.deviceTokens?.failed || 0) +
                    (this.results.helpfulPromptService?.failed || 0) +
                    (this.results.hopefulPromptService?.failed || 0) + (this.results.programOrgContext?.failed || 0)
      }
    };
  }
}

// CLI argument parsing
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  
  args.forEach(arg => {
    if (arg === '--no-security') options.runSecurity = false;
    if (arg === '--no-load') options.runLoad = false;
    if (arg === '--no-auth') options.runAuth = false;
    if (arg === '--no-user-creation') options.runUserCreation = false;
    if (arg === '--no-pairings-endpoint') options.runPairingsEndpoint = false;
    if (arg === '--no-user-profile') options.runUserProfile = false;
    if (arg === '--no-refresh-token-reset') options.runRefreshTokenReset = false;
    if (arg === '--no-programs') options.runPrograms = false;
    if (arg === '--no-program-steps') options.runProgramSteps = false;
    if (arg === '--no-messages') options.runMessages = false;
    if (arg === '--no-therapy-trigger') options.runTherapyTrigger = false;
    if (arg === '--no-www-authenticate') options.runWWWAuthenticate = false;
    if (arg === '--no-subscription') options.runSubscription = false;
    if (arg === '--no-user-org-code') options.runUserOrgCode = false;
    if (arg === '--no-device-tokens') options.runDeviceTokens = false;
    if (arg === '--no-helpful-prompt-service') options.runHelpfulPromptService = false;
    if (arg === '--no-hopeful-prompt-service') options.runHopefulPromptService = false;
    if (arg === '--no-program-org-context') options.runProgramOrgContext = false;
    if (arg === '--skip-server-check') options.skipServerCheck = true;
    if (arg.startsWith('--url=')) options.baseURL = arg.split('=')[1];
    if (arg.startsWith('--timeout=')) options.timeout = parseInt(arg.split('=')[1]);
  });
  
  return options;
}

// Run tests if called directly
if (require.main === module) {
  const options = parseArgs();
  const testRunner = new TestSuiteRunner(options);
  
  testRunner.runAllTests().then(success => {
    // Generate JSON report for CI systems
    const report = testRunner.generateJSONReport();
    
    // Save report to file if requested
    if (process.env.TEST_REPORT_FILE) {
      const fs = require('fs');
      fs.writeFileSync(process.env.TEST_REPORT_FILE, JSON.stringify(report, null, 2));
      console.log(`Test report saved to: ${process.env.TEST_REPORT_FILE}`);
    }
    
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Test suite runner failed:', error);
    process.exit(1);
  });
}

module.exports = TestSuiteRunner;
