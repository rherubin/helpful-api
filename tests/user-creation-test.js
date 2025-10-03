const axios = require('axios');
const jwt = require('jsonwebtoken');

/**
 * User Creation Endpoint Test Suite
 * Comprehensive tests for the POST /api/users endpoint
 * 
 * Tests include:
 * - Basic user creation functionality
 * - Response structure validation (including pairings)
 * - Automatic pairing creation behavior
 * - Authentication token generation
 * - Input validation and error scenarios
 * - Email uniqueness constraints
 * - Password requirements
 * - Performance and edge cases
 * 
 * Run with: node tests/user-creation-test.js
 */

class UserCreationTestRunner {
  constructor(options = {}) {
    this.baseURL = options.baseURL || 'http://localhost:9000';
    this.timeout = options.timeout || 15000;
    this.JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    this.testResults = {
      passed: 0,
      failed: 0,
      total: 0
    };
    this.testData = {};
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

  // Test basic user creation functionality
  async testBasicUserCreation() {
    this.log('Testing Basic User Creation', 'section');
    
    const timestamp = Date.now();
    const userData = {
      email: `test.user.${timestamp}@example.com`,
      password: 'Test1!@#'
    };

    try {
      const response = await axios.post(`${this.baseURL}/api/users`, userData, {
        timeout: this.timeout
      });
      
      this.assert(
        response.status === 201,
        'User creation returns 201 status',
        `Status: ${response.status}`
      );
      
      this.assert(
        !!response.data.message,
        'Response contains message field',
        `Message: ${response.data.message}`
      );
      
      this.assert(
        response.data.message === 'Account created successfully',
        'Response message is correct',
        `Message: ${response.data.message}`
      );
      
      this.assert(
        !!response.data.user,
        'Response contains user object',
        'User object present'
      );
      
      this.assert(
        !!response.data.access_token,
        'Response contains access token',
        'Access token present'
      );
      
      this.assert(
        !!response.data.refresh_token,
        'Response contains refresh token',
        'Refresh token present'
      );
      
      this.assert(
        typeof response.data.expires_in === 'number',
        'Response contains expires_in as number',
        `Expires in: ${response.data.expires_in}`
      );
      
      this.assert(
        typeof response.data.refresh_expires_in === 'number',
        'Response contains refresh_expires_in as number',
        `Refresh expires in: ${response.data.refresh_expires_in}`
      );

      // Test new pairings field
      this.assert(
        response.data.hasOwnProperty('pairings'),
        'Response contains pairings field',
        'Pairings field present'
      );
      
      this.assert(
        Array.isArray(response.data.pairings),
        'Pairings is an array',
        `Type: ${typeof response.data.pairings}`
      );
      
      // Test user object structure
      const user = response.data.user;
      this.assert(
        !!user.id,
        'User object contains ID',
        `ID: ${user.id}`
      );
      
      this.assert(
        user.email === userData.email,
        'User object contains correct email',
        `Email: ${user.email}`
      );
      
      this.assert(
        !user.hasOwnProperty('max_pairings'),
        'User object excludes max_pairings field',
        'max_pairings properly excluded'
      );
      
      this.assert(
        !user.hasOwnProperty('created_at'),
        'User object excludes created_at field',
        'created_at properly excluded'
      );
      
      this.assert(
        !user.hasOwnProperty('password_hash'),
        'User object excludes password_hash field',
        'password_hash properly excluded'
      );

      // Test Authorization header
      this.assert(
        !!response.headers.authorization,
        'Response includes Authorization header',
        `Header: ${response.headers.authorization ? 'Present' : 'Missing'}`
      );

      // Store user data for other tests
      this.testData.createdUser = {
        ...user,
        token: response.data.access_token,
        refreshToken: response.data.refresh_token,
        pairings: response.data.pairings
      };
      
    } catch (error) {
      this.assert(false, 'Basic user creation functionality', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test automatic pairing creation
  async testAutomaticPairingCreation() {
    this.log('Testing Automatic Pairing Creation', 'section');
    
    const timestamp = Date.now();
    const userData = {
      email: `pairing.test.${timestamp}@example.com`,
      password: 'Test1!@#'
    };

    try {
      const response = await axios.post(`${this.baseURL}/api/users`, userData, {
        timeout: this.timeout
      });
      
      this.assert(
        response.status === 201,
        'User creation successful',
        `Status: ${response.status}`
      );
      
      // Check if pairing_code is included (automatic pairing creation)
      const hasPairingCode = response.data.hasOwnProperty('pairing_code');
      
      if (hasPairingCode) {
        this.assert(
          !!response.data.pairing_code,
          'Response contains pairing code from automatic pairing',
          `Code: ${response.data.pairing_code}`
        );
        
        this.assert(
          typeof response.data.pairing_code === 'string',
          'Pairing code is a string',
          `Type: ${typeof response.data.pairing_code}`
        );
        
        this.assert(
          response.data.pairing_code.length > 0,
          'Pairing code is not empty',
          `Length: ${response.data.pairing_code.length}`
        );
      }
      
      // Check pairings array
      this.assert(
        Array.isArray(response.data.pairings),
        'Response contains pairings array',
        `Type: ${typeof response.data.pairings}`
      );
      
      if (hasPairingCode) {
        this.assert(
          response.data.pairings.length > 0,
          'New user with pairing code has pairings in array',
          `Pairings count: ${response.data.pairings.length}`
        );
        
        // Find the pairing that matches the pairing code
        const matchingPairing = response.data.pairings.find(p => p.partner_code === response.data.pairing_code);
        
        if (matchingPairing) {
          this.assert(
            matchingPairing.status === 'pending',
            'Automatic pairing has pending status',
            `Status: ${matchingPairing.status}`
          );
          
          this.assert(
            matchingPairing.partner === null,
            'Automatic pairing has no partner yet',
            `Partner: ${matchingPairing.partner}`
          );
          
          this.assert(
            !!matchingPairing.id,
            'Automatic pairing has ID',
            `ID: ${matchingPairing.id}`
          );
          
          this.assert(
            !!matchingPairing.created_at,
            'Automatic pairing has created_at timestamp',
            `Created: ${matchingPairing.created_at}`
          );
        } else {
          this.assert(false, 'Could not find matching pairing in pairings array', `Code: ${response.data.pairing_code}`);
        }
      } else {
        this.log('No automatic pairing code created (acceptable behavior)', 'info');
        this.assert(
          response.data.pairings.length >= 0,
          'Pairings array is valid even without automatic pairing',
          `Pairings count: ${response.data.pairings.length}`
        );
      }
      
    } catch (error) {
      this.assert(false, 'Automatic pairing creation functionality', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test input validation
  async testInputValidation() {
    this.log('Testing Input Validation', 'section');
    
    // Test missing email
    try {
      await axios.post(`${this.baseURL}/api/users`, {
        password: 'Test1!@#'
      }, { timeout: this.timeout });
      this.assert(false, 'Missing email should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 400,
        'Missing email returns 400',
        `Status: ${error.response?.status}`
      );
      
      this.assert(
        error.response?.data?.error?.includes('Email and password are required'),
        'Missing email returns correct error message',
        `Error: ${error.response?.data?.error}`
      );
    }

    // Test missing password
    try {
      await axios.post(`${this.baseURL}/api/users`, {
        email: 'test@example.com'
      }, { timeout: this.timeout });
      this.assert(false, 'Missing password should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 400,
        'Missing password returns 400',
        `Status: ${error.response?.status}`
      );
    }

    // Test invalid email format
    try {
      await axios.post(`${this.baseURL}/api/users`, {
        email: 'invalid-email',
        password: 'Test1!@#'
      }, { timeout: this.timeout });
      this.assert(false, 'Invalid email format should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 400,
        'Invalid email format returns 400',
        `Status: ${error.response?.status}`
      );
      
      this.assert(
        error.response?.data?.error?.includes('Invalid email format'),
        'Invalid email returns correct error message',
        `Error: ${error.response?.data?.error}`
      );
    }

    // Test weak password
    try {
      await axios.post(`${this.baseURL}/api/users`, {
        email: `weak.password.${Date.now()}@example.com`,
        password: '123'
      }, { timeout: this.timeout });
      this.assert(false, 'Weak password should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 400,
        'Weak password returns 400',
        `Status: ${error.response?.status}`
      );
      
      this.assert(
        error.response?.data?.error?.includes('Password must'),
        'Weak password returns correct error message',
        `Error: ${error.response?.data?.error}`
      );
    }
  }

  // Test email uniqueness constraint
  async testEmailUniqueness() {
    this.log('Testing Email Uniqueness Constraint', 'section');
    
    const timestamp = Date.now();
    const email = `duplicate.test.${timestamp}@example.com`;
    const userData = {
      email: email,
      password: 'Test1!@#'
    };

    try {
      // Create first user
      const response1 = await axios.post(`${this.baseURL}/api/users`, userData, {
        timeout: this.timeout
      });
      
      this.assert(
        response1.status === 201,
        'First user creation successful',
        `Status: ${response1.status}`
      );

      // Try to create second user with same email
      try {
        await axios.post(`${this.baseURL}/api/users`, userData, {
          timeout: this.timeout
        });
        this.assert(false, 'Duplicate email should fail', 'Request succeeded unexpectedly');
      } catch (error) {
        this.assert(
          error.response?.status === 409,
          'Duplicate email returns 409',
          `Status: ${error.response?.status}`
        );
        
        this.assert(
          error.response?.data?.error === 'Email already exists',
          'Duplicate email returns correct error message',
          `Error: ${error.response?.data?.error}`
        );
      }
      
    } catch (error) {
      this.assert(false, 'Email uniqueness constraint testing', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test token validation
  async testTokenValidation() {
    this.log('Testing Token Validation', 'section');
    
    const user = this.testData.createdUser;
    if (!user) {
      this.log('Skipping token tests - no user available', 'warn');
      return;
    }

    try {
      // Validate access token structure
      const decodedToken = jwt.decode(user.token);
      
      this.assert(
        !!decodedToken,
        'Access token can be decoded',
        'Token decoded successfully'
      );
      
      this.assert(
        decodedToken.id === user.id,
        'Access token contains correct user ID',
        `Token ID: ${decodedToken.id}, User ID: ${user.id}`
      );
      
      this.assert(
        decodedToken.email === user.email,
        'Access token contains correct email',
        `Token email: ${decodedToken.email}`
      );
      
      this.assert(
        !!decodedToken.exp,
        'Access token contains expiration',
        `Expires: ${new Date(decodedToken.exp * 1000).toISOString()}`
      );
      
      // Test token can be used for authenticated requests
      const profileResponse = await axios.get(`${this.baseURL}/api/profile`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      
      this.assert(
        profileResponse.status === 200,
        'Generated token works for authenticated requests',
        `Status: ${profileResponse.status}`
      );
      
      this.assert(
        profileResponse.data.profile.id === user.id,
        'Token returns correct user profile',
        `Profile ID: ${profileResponse.data.profile.id}`
      );
      
    } catch (error) {
      this.assert(false, 'Token validation functionality', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test response structure consistency
  async testResponseStructure() {
    this.log('Testing Response Structure Consistency', 'section');
    
    const timestamp = Date.now();
    const userData = {
      email: `structure.test.${timestamp}@example.com`,
      password: 'Test1!@#'
    };

    try {
      const response = await axios.post(`${this.baseURL}/api/users`, userData, {
        timeout: this.timeout
      });
      
      const expectedFields = [
        'message',
        'user', 
        'access_token',
        'refresh_token',
        'expires_in',
        'refresh_expires_in',
        'pairings'
      ];
      
      expectedFields.forEach(field => {
        this.assert(
          response.data.hasOwnProperty(field),
          `Response contains ${field} field`,
          `Field: ${field}`
        );
      });
      
      // Test user object structure
      const requiredUserFields = ['id', 'email', 'user_name', 'partner_name', 'children'];
      requiredUserFields.forEach(field => {
        this.assert(
          response.data.user.hasOwnProperty(field),
          `User object contains ${field} field`,
          `Field: ${field}`
        );
      });
      
      // Test excluded fields
      const excludedFields = ['max_pairings', 'created_at', 'password_hash'];
      excludedFields.forEach(field => {
        this.assert(
          !response.data.user.hasOwnProperty(field),
          `User object excludes ${field} field`,
          `Field: ${field}`
        );
      });
      
      // Test pairings array structure
      this.assert(
        Array.isArray(response.data.pairings),
        'Pairings is an array',
        `Type: ${typeof response.data.pairings}`
      );
      
      if (response.data.pairings.length > 0) {
        const pairing = response.data.pairings[0];
        const requiredPairingFields = ['id', 'status', 'partner_code', 'created_at', 'updated_at', 'partner'];
        
        requiredPairingFields.forEach(field => {
          this.assert(
            pairing.hasOwnProperty(field),
            `Pairing object contains ${field} field`,
            `Field: ${field}`
          );
        });
      }
      
    } catch (error) {
      this.assert(false, 'Response structure consistency', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test performance and edge cases
  async testPerformanceAndEdgeCases() {
    this.log('Testing Performance and Edge Cases', 'section');
    
    try {
      // Test response time
      const timestamp = Date.now();
      const userData = {
        email: `perf.test.${timestamp}@example.com`,
        password: 'Test1!@#'
      };
      
      const startTime = Date.now();
      const response = await axios.post(`${this.baseURL}/api/users`, userData, {
        timeout: this.timeout
      });
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      this.assert(
        response.status === 201,
        'Performance test user creation successful',
        `Status: ${response.status}`
      );
      
      this.assert(
        responseTime < 5000, // Should complete within 5 seconds
        'User creation completes within acceptable time',
        `Response time: ${responseTime}ms`
      );
      
      // Test with various email formats
      const emailFormats = [
        'test.dots.in.name@example.com',
        'test+plus@example.com',
        'test_underscore@example.com',
        'test-dash@example.com'
      ];
      
      for (const email of emailFormats) {
        try {
          const uniqueEmail = `${Date.now()}.${email}`;
          const emailResponse = await axios.post(`${this.baseURL}/api/users`, {
            email: uniqueEmail,
            password: 'Test1!@#'
          }, { timeout: this.timeout });
          
          this.assert(
            emailResponse.status === 201,
            `User creation with email format successful: ${email}`,
            `Status: ${emailResponse.status}`
          );
        } catch (error) {
          this.assert(false, `User creation with email format: ${email}`, `Error: ${error.response?.data?.error || error.message}`);
        }
      }
      
    } catch (error) {
      this.assert(false, 'Performance and edge cases testing', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Run all user creation tests
  async runAllTests() {
    this.log('🧪 Starting User Creation Endpoint Test Suite', 'section');
    
    try {
      await this.testBasicUserCreation();
      console.log('');
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.testAutomaticPairingCreation();
      console.log('');
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.testInputValidation();
      console.log('');
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.testEmailUniqueness();
      console.log('');
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.testTokenValidation();
      console.log('');
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.testResponseStructure();
      console.log('');
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.testPerformanceAndEdgeCases();
      console.log('');
      
      this.printSummary();
      
      return this.testResults.failed === 0;
      
    } catch (error) {
      this.log(`Test suite failed with error: ${error.message}`, 'fail');
      return false;
    }
  }

  printSummary() {
    this.log('📊 User Creation Test Results Summary', 'section');
    this.log(`Total Tests: ${this.testResults.total}`);
    this.log(`Passed: ${this.testResults.passed}`, this.testResults.passed === this.testResults.total ? 'pass' : 'info');
    this.log(`Failed: ${this.testResults.failed}`, this.testResults.failed === 0 ? 'pass' : 'fail');
    
    const successRate = this.testResults.total > 0 
      ? ((this.testResults.passed / this.testResults.total) * 100).toFixed(1)
      : '0';
    
    this.log(`Success Rate: ${successRate}%`, successRate === '100.0' ? 'pass' : 'warn');
    
    if (this.testResults.failed === 0) {
      this.log('🎉 All user creation tests passed! The endpoint is working correctly.', 'pass');
    } else {
      this.log('⚠️ Some user creation tests failed. Review the failures above.', 'fail');
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const testRunner = new UserCreationTestRunner();
  testRunner.runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('User creation test runner failed:', error);
    process.exit(1);
  });
}

module.exports = UserCreationTestRunner;

