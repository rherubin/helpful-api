const axios = require('axios');

/**
 * WWW-Authenticate Header Test Suite
 *
 * Verifies that 401 responses from auth-protected endpoints include a
 * well-formed `WWW-Authenticate: Bearer ...` header per RFC 6750.
 *
 * Run with: node tests/www-authenticate-test.js
 */
class WWWAuthenticateTestRunner {
  constructor(options = {}) {
    this.baseURL = options.baseURL || 'http://127.0.0.1:9000';
    this.timeout = options.timeout || 10000;
    this.testResults = { passed: 0, failed: 0, total: 0 };
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
    } else {
      this.testResults.failed++;
      this.log(`${testName} - FAILED ${details}`, 'fail');
    }
  }

  async testMissingAuthHeader() {
    this.log('Testing 401 on missing Authorization header', 'section');
    try {
      const response = await axios.get(`${this.baseURL}/api/profile`, {
        validateStatus: () => true,
        timeout: this.timeout
      });
      const wwwAuth = response.headers['www-authenticate'];
      this.assert(response.status === 401, 'Missing auth returns 401', `Status: ${response.status}`);
      this.assert(
        !!wwwAuth && wwwAuth.includes('Bearer'),
        'WWW-Authenticate contains Bearer scheme',
        `Header: ${wwwAuth || 'none'}`
      );
    } catch (error) {
      this.assert(false, 'Missing auth request', `Error: ${error.message}`);
    }
  }

  async testInvalidBearerToken() {
    this.log('Testing 401 on invalid bearer token', 'section');
    try {
      const response = await axios.get(`${this.baseURL}/api/profile`, {
        headers: { Authorization: 'Bearer invalid_token_12345' },
        validateStatus: () => true,
        timeout: this.timeout
      });
      const wwwAuth = response.headers['www-authenticate'];
      this.assert(response.status === 401, 'Invalid token returns 401', `Status: ${response.status}`);
      this.assert(
        !!wwwAuth && wwwAuth.includes('Bearer') && wwwAuth.includes('invalid_token'),
        'WWW-Authenticate includes error="invalid_token"',
        `Header: ${wwwAuth || 'none'}`
      );
    } catch (error) {
      this.assert(false, 'Invalid token request', `Error: ${error.message}`);
    }
  }

  async testInvalidLoginCredentials() {
    this.log('Testing 401 on invalid login credentials', 'section');
    try {
      const response = await axios.post(
        `${this.baseURL}/api/login`,
        { email: 'nonexistent@example.com', password: 'wrongpassword' },
        { validateStatus: () => true, timeout: this.timeout }
      );
      const wwwAuth = response.headers['www-authenticate'];
      this.assert(response.status === 401, 'Invalid login returns 401', `Status: ${response.status}`);
      this.assert(
        !!wwwAuth && wwwAuth.includes('Bearer'),
        'WWW-Authenticate contains Bearer on login failure',
        `Header: ${wwwAuth || 'none'}`
      );
    } catch (error) {
      this.assert(false, 'Invalid login request', `Error: ${error.message}`);
    }
  }

  async testInvalidRefreshToken() {
    this.log('Testing 401 on invalid refresh token', 'section');
    try {
      const response = await axios.post(
        `${this.baseURL}/api/refresh`,
        { refresh_token: 'invalid_refresh_token_12345' },
        { validateStatus: () => true, timeout: this.timeout }
      );
      const wwwAuth = response.headers['www-authenticate'];
      this.assert(response.status === 401, 'Invalid refresh returns 401', `Status: ${response.status}`);
      this.assert(
        !!wwwAuth && wwwAuth.includes('Bearer') && wwwAuth.includes('invalid_token'),
        'WWW-Authenticate includes error="invalid_token" on refresh failure',
        `Header: ${wwwAuth || 'none'}`
      );
    } catch (error) {
      this.assert(false, 'Invalid refresh request', `Error: ${error.message}`);
    }
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 WWW-AUTHENTICATE TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Tests:  ${this.testResults.total}`);
    console.log(`Passed:       ${this.testResults.passed}`);
    console.log(`Failed:       ${this.testResults.failed}`);
    const rate = this.testResults.total > 0
      ? Math.round((this.testResults.passed / this.testResults.total) * 100)
      : 0;
    console.log(`Success Rate: ${rate}%`);
    console.log('='.repeat(60) + '\n');
  }

  async runAllTests() {
    this.log('🧪 Starting WWW-Authenticate Header Test Suite', 'section');
    console.log('='.repeat(60));

    await this.testMissingAuthHeader();
    await this.testInvalidBearerToken();
    await this.testInvalidLoginCredentials();
    await this.testInvalidRefreshToken();

    this.printSummary();
    return this.testResults.failed === 0;
  }
}

if (require.main === module) {
  const runner = new WWWAuthenticateTestRunner();
  runner.runAllTests()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      console.error('Test runner error:', error);
      process.exit(1);
    });
}

module.exports = WWWAuthenticateTestRunner;
