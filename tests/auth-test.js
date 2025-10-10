const axios = require('axios');
const assert = require('assert');
const { v4: uuidv4 } = require('uuid');

/**
 * Authentication Test Suite for MySQL
 * Tests authentication functionality against the running MySQL-backed server
 * Run with: node tests/auth-test.js
 */

class AuthTest {
  constructor() {
    this.testResults = [];
    this.BASE_URL = process.env.BASE_URL || 'http://localhost:9000';
    this.testData = {};
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : type === 'section' ? '📋' : 'ℹ️';
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  async checkServer() {
    try {
      const response = await axios.get(`${this.BASE_URL}/health`, { timeout: 2000 });
      if (response.status === 200) {
        this.log('Server is running', 'success');
        return true;
      }
    } catch (error) {
      this.log('Server is not running. Please start the server before running tests.', 'error');
      return false;
    }
    return false;
  }

  async testUserRegistration() {
    this.log('Testing user registration...', 'section');
    
    try {
      const userData = {
        email: `test-${uuidv4()}@example.com`,
        password: 'MyVerySecureP@ssw0rd2024!'
      };

      const response = await axios.post(`${this.BASE_URL}/api/users`, userData);

      assert.ok([200, 201].includes(response.status), 'Registration should return 200 or 201');
      assert.ok(response.data.message.includes('created'), 'Registration message should indicate success');
      assert.ok(response.data.access_token, 'Access token not provided');
      assert.ok(response.data.refresh_token, 'Refresh token not provided');
      assert.ok(response.data.user, 'User object not provided');
      assert.ok(response.data.user.id, 'User ID not provided');
      assert.strictEqual(response.data.user.email, userData.email, 'User email mismatch');
      assert.ok(!response.data.user.password, 'Password should not be returned');
      assert.ok(!response.data.user.password_hash, 'Password hash should not be returned');

      this.log('✓ User registration successful', 'success');
      this.testData.registrationUser = {
        ...userData,
        ...response.data
      };
      return { success: true, userData, tokens: response.data };
    } catch (error) {
      this.log(`✗ User registration failed: ${error.response?.data?.error || error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async testUserLogin() {
    this.log('Testing user login...', 'section');
    
    try {
      // First register a user
      const userData = {
        email: `login-test-${uuidv4()}@example.com`,
        password: 'MyVerySecureP@ssw0rd2024!'
      };

      await axios.post(`${this.BASE_URL}/api/users`, userData);

      // Now test login
      const loginResponse = await axios.post(`${this.BASE_URL}/api/login`, {
        email: userData.email,
        password: userData.password
      });

      assert.strictEqual(loginResponse.status, 200, 'Login should return 200');
      assert.strictEqual(loginResponse.data.message, 'Login successful', 'Login message incorrect');
      assert.ok(loginResponse.data.data.access_token, 'Access token not provided');
      assert.ok(loginResponse.data.data.refresh_token, 'Refresh token not provided');
      assert.strictEqual(loginResponse.data.data.user.email, userData.email, 'User email mismatch');
      assert.ok(!loginResponse.data.data.user.password, 'Password should not be returned');

      this.log('✓ User login successful', 'success');
      this.testData.loginUser = {
        ...userData,
        ...loginResponse.data.data
      };
      return { success: true, userData, tokens: loginResponse.data.data };
    } catch (error) {
      this.log(`✗ User login failed: ${error.response?.data?.error || error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async testInvalidLogin() {
    this.log('Testing invalid login scenarios...', 'section');
    
    try {
      // Test with non-existent user
      try {
        await axios.post(`${this.BASE_URL}/api/login`, {
          email: 'nonexistent@example.com',
          password: 'wrongpassword'
        });
        throw new Error('Should have failed');
      } catch (error) {
        assert.strictEqual(error.response?.status, 401, 'Non-existent user should return 401');
      }

      // Register a user first
      const userData = {
        email: `invalid-test-${uuidv4()}@example.com`,
        password: 'MyVerySecureP@ssw0rd2024!'
      };

      await axios.post(`${this.BASE_URL}/api/users`, userData);

      // Test with wrong password
      try {
        await axios.post(`${this.BASE_URL}/api/login`, {
          email: userData.email,
          password: 'wrongpassword'
        });
        throw new Error('Should have failed');
      } catch (error) {
        assert.strictEqual(error.response?.status, 401, 'Wrong password should return 401');
      }

      // Test with missing fields
      try {
        await axios.post(`${this.BASE_URL}/api/login`, {
          email: userData.email
        });
        throw new Error('Should have failed');
      } catch (error) {
        assert.strictEqual(error.response?.status, 400, 'Missing password should return 400');
      }

      try {
        await axios.post(`${this.BASE_URL}/api/login`, {
          password: userData.password
        });
        throw new Error('Should have failed');
      } catch (error) {
        assert.strictEqual(error.response?.status, 400, 'Missing email should return 400');
      }

      this.log('✓ Invalid login scenarios handled correctly', 'success');
      return { success: true };
    } catch (error) {
      this.log(`✗ Invalid login test failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async testTokenRefresh() {
    this.log('Testing token refresh...', 'section');
    
    try {
      // First register and login a user
      const userData = {
        email: `refresh-test-${uuidv4()}@example.com`,
        password: 'MyVerySecureP@ssw0rd2024!'
      };

      const registerResponse = await axios.post(`${this.BASE_URL}/api/users`, userData);

      const refreshToken = registerResponse.data.refresh_token;
      const originalAccessToken = registerResponse.data.access_token;

      // Wait a moment to ensure new token has different timestamp
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Test refresh token
      const refreshResponse = await axios.post(`${this.BASE_URL}/api/refresh`, {
        refresh_token: refreshToken
      });

      assert.strictEqual(refreshResponse.status, 200, 'Refresh should return 200');
      assert.strictEqual(refreshResponse.data.message, 'Token refreshed successfully', 'Refresh message incorrect');
      assert.ok(refreshResponse.data.access_token, 'New access token not provided');
      assert.strictEqual(refreshResponse.data.expires_in, '1h', 'Token expiry incorrect');

      this.log('✓ Token refresh successful', 'success');
      return { success: true, refreshToken, newAccessToken: refreshResponse.data.access_token };
    } catch (error) {
      this.log(`✗ Token refresh failed: ${error.response?.data?.error || error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async testInvalidTokenRefresh() {
    this.log('Testing invalid token refresh scenarios...', 'section');
    
    try {
      // Test with invalid token
      try {
        await axios.post(`${this.BASE_URL}/api/refresh`, {
          refresh_token: 'invalid.token.here'
        });
        throw new Error('Should have failed');
      } catch (error) {
        assert.strictEqual(error.response?.status, 403, 'Invalid token should return 403');
      }

      // Test with missing token
      try {
        await axios.post(`${this.BASE_URL}/api/refresh`, {});
        throw new Error('Should have failed');
      } catch (error) {
        assert.strictEqual(error.response?.status, 400, 'Missing token should return 400');
      }

      this.log('✓ Invalid token refresh scenarios handled correctly', 'success');
      return { success: true };
    } catch (error) {
      this.log(`✗ Invalid token refresh test failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async testLogout() {
    this.log('Testing user logout...', 'section');
    
    try {
      // Register a user and get tokens
      const userData = {
        email: `logout-test-${uuidv4()}@example.com`,
        password: 'MyVerySecureP@ssw0rd2024!'
      };

      const registerResponse = await axios.post(`${this.BASE_URL}/api/users`, userData);

      const refreshToken = registerResponse.data.refresh_token;

      // Test logout
      const logoutResponse = await axios.post(`${this.BASE_URL}/api/logout`, {
        refresh_token: refreshToken
      });

      assert.strictEqual(logoutResponse.status, 200, 'Logout should return 200');
      assert.strictEqual(logoutResponse.data.message, 'Logged out successfully', 'Logout message incorrect');

      // Try to use the refresh token after logout (should fail)
      try {
        await axios.post(`${this.BASE_URL}/api/refresh`, {
          refresh_token: refreshToken
        });
        throw new Error('Should have failed after logout');
      } catch (error) {
        assert.strictEqual(error.response?.status, 403, 'Refresh after logout should return 403');
      }

      this.log('✓ User logout successful', 'success');
      return { success: true };
    } catch (error) {
      this.log(`✗ User logout failed: ${error.response?.data?.error || error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async testUserProfile() {
    this.log('Testing user profile endpoint...', 'section');
    
    try {
      // Register a user and get tokens
      const userData = {
        email: `profile-test-${uuidv4()}@example.com`,
        password: 'MyVerySecureP@ssw0rd2024!'
      };

      const registerResponse = await axios.post(`${this.BASE_URL}/api/users`, userData);

      const accessToken = registerResponse.data.access_token;

      // Test profile endpoint with valid token
      const profileResponse = await axios.get(`${this.BASE_URL}/api/profile`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      assert.strictEqual(profileResponse.status, 200, 'Profile endpoint should return 200');
      assert.strictEqual(profileResponse.data.profile.email, userData.email, 'Profile email mismatch');
      assert.ok(!profileResponse.data.profile.password, 'Password should not be returned in profile');

      // Test profile endpoint without token
      try {
        await axios.get(`${this.BASE_URL}/api/profile`);
        throw new Error('Should have failed');
      } catch (error) {
        assert.strictEqual(error.response?.status, 401, 'No token should return 401');
      }

      // Test profile endpoint with invalid token
      try {
        await axios.get(`${this.BASE_URL}/api/profile`, {
          headers: { Authorization: 'Bearer invalid.token.here' }
        });
        throw new Error('Should have failed');
      } catch (error) {
        assert.strictEqual(error.response?.status, 403, 'Invalid token should return 403');
      }

      this.log('✓ User profile endpoint working correctly', 'success');
      return { success: true };
    } catch (error) {
      this.log(`✗ User profile test failed: ${error.response?.data?.error || error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async testTokenExpiry() {
    this.log('Testing token expiry behavior...', 'section');
    
    try {
      const userData = {
        email: `expiry-test-${uuidv4()}@example.com`,
        password: 'MyVerySecureP@ssw0rd2024!'
      };

      const registerResponse = await axios.post(`${this.BASE_URL}/api/users`, userData);

      const accessToken = registerResponse.data.access_token;
      
      // Verify token structure (should be a valid JWT)
      const tokenParts = accessToken.split('.');
      assert.strictEqual(tokenParts.length, 3, 'Access token should have 3 parts');
      
      // Decode and check token content
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      assert.ok(payload.id, 'Token should contain user ID');
      assert.strictEqual(payload.email, userData.email, 'Token should contain user email');
      assert.ok(payload.exp, 'Token should have expiration');
      assert.ok(payload.iat, 'Token should have issued at');

      this.log('✓ Token structure and content validation passed', 'success');
      return { success: true };
    } catch (error) {
      this.log(`✗ Token expiry test failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async runAllTests() {
    this.log('🚀 Starting Authentication Test Suite (MySQL)', 'section');
    
    const serverOk = await this.checkServer();
    if (!serverOk) {
      this.log('Cannot proceed without server running', 'error');
      return false;
    }

    const tests = [
      { name: 'User Registration', method: 'testUserRegistration' },
      { name: 'User Login', method: 'testUserLogin' },
      { name: 'Invalid Login', method: 'testInvalidLogin' },
      { name: 'Token Refresh', method: 'testTokenRefresh' },
      { name: 'Invalid Token Refresh', method: 'testInvalidTokenRefresh' },
      { name: 'User Logout', method: 'testLogout' },
      { name: 'User Profile', method: 'testUserProfile' },
      { name: 'Token Expiry', method: 'testTokenExpiry' }
    ];

    let passedTests = 0;
    let totalTests = tests.length;

    for (const test of tests) {
      try {
        this.log(`Running ${test.name}...`);
        const result = await this[test.method]();
        
        if (result.success) {
          passedTests++;
          this.testResults.push({ name: test.name, status: 'passed' });
        } else {
          this.testResults.push({ name: test.name, status: 'failed', error: result.error });
        }
      } catch (error) {
        this.log(`Test ${test.name} threw an error: ${error.message}`, 'error');
        this.testResults.push({ name: test.name, status: 'error', error: error.message });
      }
    }

    this.printSummary(passedTests, totalTests);
    return passedTests === totalTests;
  }

  printSummary(passed, total) {
    this.log('📊 Authentication Test Results Summary', 'section');
    
    this.testResults.forEach(result => {
      const status = result.status === 'passed' ? '✅' : '❌';
      const errorMsg = result.error ? ` (${result.error})` : '';
      this.log(`${status} ${result.name}${errorMsg}`);
    });

    const successRate = ((passed / total) * 100).toFixed(1);
    this.log(`\n🎯 Results: ${passed}/${total} tests passed (${successRate}%)`, 
             passed === total ? 'success' : 'error');
    
    if (passed === total) {
      this.log('🎉 All authentication tests passed!', 'success');
    } else {
      this.log(`❌ ${total - passed} test(s) failed`, 'error');
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  const authTest = new AuthTest();
  authTest.runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test suite failed:', error);
      process.exit(1);
    });
}

module.exports = AuthTest;
