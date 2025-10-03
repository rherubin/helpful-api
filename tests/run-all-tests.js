const SecurityTestRunner = require('./security-test');
const LoadTestRunner = require('./load-test');
const APITestRunner = require('./api-test');
const OpenAITestRunner = require('./openai-test');
const TherapyTestRunner = require('./run-therapy-tests');
const AuthTestRunner = require('./auth-test');
const UserCreationTestRunner = require('./user-creation-test');

/**
 * Comprehensive test suite runner for CI/CD pipeline
 * Runs all test categories in sequence
 * Run with: node tests/run-all-tests.js
 */

class TestSuiteRunner {
  constructor(options = {}) {
    this.options = {
      runSecurity: options.runSecurity !== false, // Default true
      runAPI: options.runAPI !== false, // Default true
      runLoad: options.runLoad !== false, // Default true
      runOpenAI: options.runOpenAI !== false, // Default true
      runTherapy: options.runTherapy !== false, // Default true
      runAuth: options.runAuth !== false, // Default true
      runUserCreation: options.runUserCreation !== false, // Default true
      baseURL: options.baseURL || 'http://localhost:9000',
      timeout: options.timeout || 30000,
      skipServerCheck: options.skipServerCheck || false
    };
    
    this.results = {
      security: null,
      api: null,
      load: null,
      openai: null,
      therapy: null,
      auth: null,
      userCreation: null,
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

  // Run API functionality tests
  async runAPITests() {
    if (!this.options.runAPI) {
      this.log('Skipping API tests', 'warn');
      return { skipped: true };
    }

    this.log('🧪 Running API Functionality Test Suite', 'section');
    
    try {
      const apiRunner = new APITestRunner({
        baseURL: this.options.baseURL,
        timeout: this.options.timeout
      });
      
      const success = await apiRunner.runFullTestSuite();
      
      this.results.api = {
        success,
        passed: apiRunner.testResults.passed,
        failed: apiRunner.testResults.failed,
        total: apiRunner.testResults.total
      };
      
      return this.results.api;
    } catch (error) {
      this.log(`API tests failed: ${error.message}`, 'error');
      this.results.api = { success: false, error: error.message };
      return this.results.api;
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

  // Run OpenAI integration tests
  async runOpenAITests() {
    if (!this.options.runOpenAI) {
      this.log('Skipping OpenAI tests', 'warn');
      return { skipped: true };
    }

    this.log('🤖 Running OpenAI Integration Test Suite', 'section');
    
    try {
      const openaiRunner = new OpenAITestRunner({
        timeout: this.options.timeout
      });
      
      const success = await openaiRunner.runFullTestSuite();
      
      this.results.openai = {
        success,
        testResults: openaiRunner.testResults
      };
      
      return this.results.openai;
    } catch (error) {
      this.log(`OpenAI tests failed: ${error.message}`, 'error');
      this.results.openai = { success: false, error: error.message };
      return this.results.openai;
    }
  }

  // Run therapy response tests
  async runTherapyTests() {
    this.log('🧠 Running Therapy Response Tests', 'section');
    
    try {
      const therapyRunner = new TherapyTestRunner();
      const success = await therapyRunner.runAllTests();
      
      this.results.therapy = { 
        success, 
        skipped: false,
        details: 'Therapy response trigger and system message tests'
      };
      
      if (success) {
        this.log('Therapy response tests completed successfully', 'success');
      } else {
        this.log('Therapy response tests failed', 'error');
      }
      
      return this.results.therapy;
    } catch (error) {
      this.log(`Therapy response tests failed: ${error.message}`, 'error');
      this.results.therapy = { success: false, error: error.message };
      return this.results.therapy;
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

  // Run all test suites
  async runAllTests() {
    this.log('🎯 Starting Comprehensive Test Suite', 'section');
    this.log(`Test Configuration:`, 'info');
    this.log(`  Base URL: ${this.options.baseURL}`, 'info');
    this.log(`  Timeout: ${this.options.timeout}ms`, 'info');
    this.log(`  Security Tests: ${this.options.runSecurity ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  API Tests: ${this.options.runAPI ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  Load Tests: ${this.options.runLoad ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  OpenAI Tests: ${this.options.runOpenAI ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  Therapy Response Tests: ${this.options.runTherapy ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  Authentication Tests: ${this.options.runAuth ? 'Enabled' : 'Disabled'}`, 'info');
    this.log(`  User Creation Tests: ${this.options.runUserCreation ? 'Enabled' : 'Disabled'}`, 'info');
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

    // Run API tests
    if (this.options.runAPI) {
      await this.runAPITests();
      if (this.results.api && !this.results.api.success && !this.results.api.skipped) {
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

    // Run OpenAI tests
    if (this.options.runOpenAI) {
      await this.runOpenAITests();
      if (this.results.openai && !this.results.openai.success && !this.results.openai.skipped) {
        overallSuccess = false;
      }
      console.log('');
    }

    // Run therapy response tests
    if (this.options.runTherapy) {
      await this.runTherapyTests();
      if (this.results.therapy && !this.results.therapy.success && !this.results.therapy.skipped) {
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

    // API test results
    if (this.results.api) {
      if (this.results.api.skipped) {
        this.log('🧪 API Tests: SKIPPED', 'warn');
      } else if (this.results.api.success) {
        this.log(`🧪 API Tests: PASSED (${this.results.api.passed}/${this.results.api.total})`, 'success');
      } else {
        this.log(`🧪 API Tests: FAILED (${this.results.api.failed}/${this.results.api.total} failures)`, 'error');
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

    // OpenAI test results
    if (this.results.openai) {
      if (this.results.openai.skipped) {
        this.log('🤖 OpenAI Tests: SKIPPED', 'warn');
      } else if (this.results.openai.success) {
        const testResults = this.results.openai.testResults;
        this.log(`🤖 OpenAI Tests: PASSED (${testResults?.passed || 0}/${testResults?.total || 0})`, 'success');
      } else {
        this.log('🤖 OpenAI Tests: FAILED', 'error');
      }
    }

    // Therapy response test results
    if (this.results.therapy) {
      if (this.results.therapy.skipped) {
        this.log('🧠 Therapy Response Tests: SKIPPED', 'warn');
      } else if (this.results.therapy.success) {
        this.log('🧠 Therapy Response Tests: PASSED', 'success');
      } else {
        this.log('🧠 Therapy Response Tests: FAILED', 'error');
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
      success: this.results.security?.success && this.results.api?.success && this.results.load?.success && this.results.openai?.success,
      results: {
        security: this.results.security,
        api: this.results.api,
        load: this.results.load,
        openai: this.results.openai
      },
      summary: {
        totalTests: (this.results.security?.total || 0) + (this.results.api?.total || 0) + (this.results.openai?.testResults?.total || 0),
        totalPassed: (this.results.security?.passed || 0) + (this.results.api?.passed || 0) + (this.results.openai?.testResults?.passed || 0),
        totalFailed: (this.results.security?.failed || 0) + (this.results.api?.failed || 0) + (this.results.openai?.testResults?.failed || 0)
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
    if (arg === '--no-api') options.runAPI = false;
    if (arg === '--no-load') options.runLoad = false;
    if (arg === '--no-openai') options.runOpenAI = false;
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
