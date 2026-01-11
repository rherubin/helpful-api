const axios = require('axios');
const jwt = require('jsonwebtoken');

/**
 * User Profile Endpoint Test Suite
 * Comprehensive tests for the GET /api/profile endpoint
 * 
 * Tests include:
 * - Basic profile retrieval functionality
 * - Authentication and authorization scenarios
 * - Profile with pending pairing requests (partner codes)
 * - Profile with accepted pairings
 * - Response structure validation
 * - Edge cases and error scenarios
 * - Performance and concurrent request handling
 * 
 * Run with: node tests/user-profile-test.js
 */

class UserProfileTestRunner {
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

  // Generate JWT token for testing
  generateToken(userId = 'test-user-id', email = 'test@example.com') {
    return jwt.sign({ id: userId, email }, this.JWT_SECRET, { expiresIn: '24h' });
  }

  // Create test users for profile testing
  async createTestUsers() {
    const timestamp = Date.now();
    
    // Create first test user
    const user1Data = {
      email: `profile.user1.${timestamp}@example.com`,
      password: 'Test1!@#'
    };
    
    // Create second test user for pairing tests
    const user2Data = {
      email: `profile.user2.${timestamp}@example.com`,
      password: 'Test2!@#'
    };

    try {
      // Create user 1
      const user1Response = await axios.post(`${this.baseURL}/api/users`, user1Data, {
        timeout: this.timeout
      });
      
      this.assert(
        user1Response.status === 201,
        'Test user 1 creation',
        `Status: ${user1Response.status}`
      );

      // Create user 2
      const user2Response = await axios.post(`${this.baseURL}/api/users`, user2Data, {
        timeout: this.timeout
      });
      
      this.assert(
        user2Response.status === 201,
        'Test user 2 creation',
        `Status: ${user2Response.status}`
      );

      // Store test data
      this.testData.user1 = {
        ...user1Response.data.user,
        token: user1Response.data.access_token,
        refreshToken: user1Response.data.refresh_token
      };

      this.testData.user2 = {
        ...user2Response.data.user,
        token: user2Response.data.access_token,
        refreshToken: user2Response.data.refresh_token
      };

      return true;
    } catch (error) {
      this.assert(false, 'Test users creation', `Error: ${error.response?.data?.error || error.message}`);
      return false;
    }
  }

  // Test basic profile endpoint functionality
  async testBasicProfileEndpoint() {
    this.log('Testing Basic Profile Endpoint', 'section');
    
    const user = this.testData.user1;
    if (!user) {
      this.log('Skipping profile tests - no user available', 'warn');
      return;
    }

    // Test successful profile retrieval
    try {
      const profileResponse = await axios.get(`${this.baseURL}/api/profile`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      
      this.assert(
        profileResponse.status === 200,
        'Profile endpoint returns 200',
        `Status: ${profileResponse.status}`
      );
      
      this.assert(
        !!profileResponse.data.profile,
        'Profile endpoint returns profile object',
        'Profile object present'
      );
      
      this.assert(
        profileResponse.data.profile.id === user.id,
        'Profile contains correct user ID',
        `ID: ${profileResponse.data.profile.id}`
      );
      
      this.assert(
        profileResponse.data.profile.email === user.email,
        'Profile contains correct email',
        `Email: ${profileResponse.data.profile.email}`
      );
      
      this.assert(
        profileResponse.data.profile.user_name !== undefined || profileResponse.data.profile.user_name === null,
        'Profile contains user_name field (may be null)',
        `Name: ${profileResponse.data.profile.user_name}`
      );
      
      this.assert(
        Array.isArray(profileResponse.data.profile.pairings),
        'Profile contains pairings array',
        `Type: ${typeof profileResponse.data.profile.pairings}`
      );
      
      this.assert(
        profileResponse.data.profile.pairings.length >= 0,
        'New user has pairings array (may contain pending requests)',
        `Pairings count: ${profileResponse.data.profile.pairings.length}`
      );

      this.assert(
        Array.isArray(profileResponse.data.profile.pairing_codes),
        'Profile contains pairing_codes array',
        `Type: ${typeof profileResponse.data.profile.pairing_codes}`
      );
      
      this.assert(
        profileResponse.data.profile.pairing_codes.length >= 0,
        'New user has pairing_codes array (may be empty)',
        `Pairing codes count: ${profileResponse.data.profile.pairing_codes.length}`
      );

      // Store profile for later tests
      this.testData.user1Profile = profileResponse.data.profile;
      
    } catch (error) {
      this.assert(false, 'Profile endpoint basic functionality', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test profile endpoint authentication
  async testProfileAuthentication() {
    this.log('Testing Profile Authentication', 'section');
    
    // Test without token
    try {
      await axios.get(`${this.baseURL}/api/profile`, { timeout: this.timeout });
      this.assert(false, 'Profile without token should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 401,
        'Profile without token returns 401',
        `Status: ${error.response?.status}`
      );
    }

    // Test with invalid token
    try {
      await axios.get(`${this.baseURL}/api/profile`, {
        headers: { Authorization: 'Bearer invalid-token' },
        timeout: this.timeout
      });
      this.assert(false, 'Profile with invalid token should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Profile with invalid token returns 403',
        `Status: ${error.response?.status}`
      );
    }

    // Test with malformed Authorization header
    try {
      await axios.get(`${this.baseURL}/api/profile`, {
        headers: { Authorization: 'InvalidFormat token123' },
        timeout: this.timeout
      });
      this.assert(false, 'Profile with malformed auth header should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 401 || error.response?.status === 403,
        'Profile with malformed auth header returns 401 or 403',
        `Status: ${error.response?.status}`
      );
    }

    // Test with expired token
    const expiredToken = jwt.sign(
      { id: 'test-user', email: 'test@example.com' },
      this.JWT_SECRET,
      { expiresIn: '-1h' } // Expired 1 hour ago
    );
    
    try {
      await axios.get(`${this.baseURL}/api/profile`, {
        headers: { Authorization: `Bearer ${expiredToken}` },
        timeout: this.timeout
      });
      this.assert(false, 'Profile with expired token should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Profile with expired token returns 403',
        `Status: ${error.response?.status}`
      );
    }
  }

  // Test profile with pending pairing requests
  async testProfileWithPendingRequests() {
    this.log('Testing Profile with Pending Pairing Requests', 'section');
    
    // Create a new user for this test to avoid conflicts
    const timestamp = Date.now();
    const userData = {
      email: `pending.test.${timestamp}@example.com`,
      password: 'Test1!@#'
    };

    try {
      // Create test user
      const userResponse = await axios.post(`${this.baseURL}/api/users`, userData, {
        timeout: this.timeout
      });
      
      const user = {
        ...userResponse.data.user,
        token: userResponse.data.access_token
      };

      // Test profile before creating any pairing requests
      const initialProfileResponse = await axios.get(`${this.baseURL}/api/profile`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      
      const initialPairingsCount = initialProfileResponse.data.profile.pairings.length;
      this.assert(
        initialPairingsCount >= 0,
        'Profile contains pairings array initially',
        `Initial pairings: ${initialPairingsCount}`
      );

      // User creates a pairing request (partner code)
      const pairingResponse = await axios.post(`${this.baseURL}/api/pairing/request`, {}, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      
      this.assert(
        pairingResponse.status === 201,
        'Pairing request creation successful',
        `Status: ${pairingResponse.status}`
      );
      
      const partnerCode = pairingResponse.data.partner_code;
      this.assert(
        !!partnerCode,
        'Pairing request returns partner code',
        `Code: ${partnerCode}`
      );

      // Wait a moment for the request to be processed
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Test profile with pending pairing requests
      const profileResponse = await axios.get(`${this.baseURL}/api/profile`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      
      this.assert(
        profileResponse.status === 200,
        'Profile with pending requests returns 200',
        `Status: ${profileResponse.status}`
      );
      
      const profile = profileResponse.data.profile;
      this.assert(
        Array.isArray(profile.pairings),
        'Profile contains pairings array',
        `Type: ${typeof profile.pairings}`
      );
      
      this.assert(
        profile.pairings.length > initialPairingsCount,
        'User has more pairings after creating request',
        `Pairings count: ${profile.pairings.length} (was ${initialPairingsCount})`
      );

      // Find the new pairing request we just created
      const newRequest = profile.pairings.find(r => r.partner_code === partnerCode);
      
      if (newRequest) {
        this.assert(
          !!newRequest.id,
          'New pairing request contains ID',
          `ID: ${newRequest.id}`
        );
        
        this.assert(
          newRequest.status === 'pending',
          'New pairing request status is pending',
          `Status: ${newRequest.status}`
        );
        
        this.assert(
          newRequest.partner_code === partnerCode,
          'New pairing request contains correct partner code',
          `Code: ${newRequest.partner_code}`
        );
        
        this.assert(
          newRequest.partner === null,
          'New pairing request partner is null (no one accepted yet)',
          `Partner: ${newRequest.partner}`
        );
        
        this.assert(
          !!newRequest.created_at,
          'New pairing request contains created_at timestamp',
          `Created: ${newRequest.created_at}`
        );
        
        this.assert(
          !!newRequest.updated_at,
          'New pairing request contains updated_at timestamp',
          `Updated: ${newRequest.updated_at}`
        );
      } else {
        this.assert(false, 'Could not find the new pairing request in response', `Partner code: ${partnerCode}`);
      }

      // Test pairing_codes array contains the partner code
      this.assert(
        Array.isArray(profile.pairing_codes),
        'Profile contains pairing_codes array',
        `Type: ${typeof profile.pairing_codes}`
      );
      
      this.assert(
        profile.pairing_codes.includes(partnerCode),
        'Pairing codes array contains the new partner code',
        `Codes: ${profile.pairing_codes.join(', ')}, Looking for: ${partnerCode}`
      );
      
      this.assert(
        profile.pairing_codes.length > 0,
        'User with pending requests has pairing codes',
        `Pairing codes count: ${profile.pairing_codes.length}`
      );
      
    } catch (error) {
      this.assert(false, 'Profile with pending pairing requests', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test profile with accepted pairings
  async testProfileWithAcceptedPairings() {
    this.log('Testing Profile with Accepted Pairings', 'section');
    
    const user1 = this.testData.user1;
    const user2 = this.testData.user2;
    
    if (!user1 || !user2) {
      this.log('Skipping pairing tests - users not available', 'warn');
      return;
    }

    try {
      // User 1 requests a pairing
      const pairingResponse = await axios.post(`${this.baseURL}/api/pairing/request`, {}, {
        headers: { Authorization: `Bearer ${user1.token}` },
        timeout: this.timeout
      });
      
      this.assert(
        pairingResponse.status === 201,
        'Pairing request successful',
        `Status: ${pairingResponse.status}`
      );
      
      const partnerCode = pairingResponse.data.partner_code;
      this.assert(
        !!partnerCode,
        'Pairing request returns partner code',
        `Code: ${partnerCode}`
      );

      // User 2 accepts the pairing
      const acceptResponse = await axios.post(`${this.baseURL}/api/pairing/accept`, {
        partner_code: partnerCode
      }, {
        headers: { Authorization: `Bearer ${user2.token}` },
        timeout: this.timeout
      });
      
      this.assert(
        acceptResponse.status === 200,
        'Pairing acceptance successful',
        `Status: ${acceptResponse.status}`
      );

      // Wait a moment for pairing to be processed and to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Test user 1's profile with pairings
      const user1ProfileResponse = await axios.get(`${this.baseURL}/api/profile`, {
        headers: { Authorization: `Bearer ${user1.token}` },
        timeout: this.timeout
      });
      
      this.assert(
        user1ProfileResponse.status === 200,
        'User 1 profile with pairings returns 200',
        `Status: ${user1ProfileResponse.status}`
      );
      
      const user1Profile = user1ProfileResponse.data.profile;
      this.assert(
        Array.isArray(user1Profile.pairings),
        'User 1 profile contains pairings array',
        `Type: ${typeof user1Profile.pairings}`
      );
      
      this.assert(
        user1Profile.pairings.length > 0,
        'User 1 has pairings after accepting',
        `Pairings count: ${user1Profile.pairings.length}`
      );

      if (user1Profile.pairings.length > 0) {
        const pairing = user1Profile.pairings[0];
        
        this.assert(
          !!pairing.id,
          'Pairing contains ID',
          `ID: ${pairing.id}`
        );
        
        this.assert(
          pairing.status === 'accepted',
          'Pairing status is accepted',
          `Status: ${pairing.status}`
        );
        
        this.assert(
          !!pairing.partner,
          'Pairing contains partner object',
          'Partner object present'
        );
        
        this.assert(
          pairing.partner.id === user2.id,
          'Pairing partner ID is correct',
          `Partner ID: ${pairing.partner.id}`
        );
        
        this.assert(
          pairing.partner.email === user2.email,
          'Pairing partner email is correct',
          `Partner email: ${pairing.partner.email}`
        );
        
        this.assert(
          pairing.partner.user_name !== undefined,
          'Pairing partner has user_name field (may be null)',
          `User name: ${pairing.partner.user_name}`
        );
      }

      // Test user 2's profile with pairings
      const user2ProfileResponse = await axios.get(`${this.baseURL}/api/profile`, {
        headers: { Authorization: `Bearer ${user2.token}` },
        timeout: this.timeout
      });
      
      this.assert(
        user2ProfileResponse.status === 200,
        'User 2 profile with pairings returns 200',
        `Status: ${user2ProfileResponse.status}`
      );
      
      const user2Profile = user2ProfileResponse.data.profile;
      this.assert(
        user2Profile.pairings.length > 0,
        'User 2 has pairings after accepting',
        `Pairings count: ${user2Profile.pairings.length}`
      );

      if (user2Profile.pairings.length > 0) {
        const pairing = user2Profile.pairings[0];
        
        this.assert(
          pairing.partner.id === user1.id,
          'User 2 pairing partner ID is correct',
          `Partner ID: ${pairing.partner.id}`
        );
        
        this.assert(
          pairing.status === 'accepted',
          'User 2 pairing status is accepted',
          `Status: ${pairing.status}`
        );
      }

      // Test pairing_codes array for accepted pairings
      this.assert(
        Array.isArray(user2Profile.pairing_codes),
        'User 2 profile contains pairing_codes array',
        `Type: ${typeof user2Profile.pairing_codes}`
      );
      
      this.assert(
        user2Profile.pairing_codes.length > 0,
        'User 2 with accepted pairings has pairing codes',
        `Pairing codes count: ${user2Profile.pairing_codes.length}`
      );
      
    } catch (error) {
      this.assert(false, 'Profile with accepted pairings functionality', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test profile response structure
  async testProfileResponseStructure() {
    this.log('Testing Profile Response Structure', 'section');
    
    const user = this.testData.user1;
    if (!user) {
      this.log('Skipping structure tests - no user available', 'warn');
      return;
    }

    try {
      const profileResponse = await axios.get(`${this.baseURL}/api/profile`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      
      const response = profileResponse.data;
      const profile = response.profile;
      
      // Test response structure
      this.assert(
        !!response.message,
        'Response contains message field',
        `Message: ${response.message}`
      );
      
      this.assert(
        !!response.profile,
        'Response contains profile field',
        'Profile field present'
      );

      // Test profile structure - user fields
      const requiredUserFields = ['id', 'email', 'max_pairings', 'created_at', 'updated_at'];
      requiredUserFields.forEach(field => {
        this.assert(
          profile.hasOwnProperty(field),
          `Profile contains ${field} field`,
          `Value: ${profile[field]}`
        );
      });

      // Test profile structure - pairings field
      this.assert(
        profile.hasOwnProperty('pairings'),
        'Profile contains pairings field',
        'Pairings field present'
      );
      
      this.assert(
        Array.isArray(profile.pairings),
        'Profile pairings is an array',
        `Type: ${typeof profile.pairings}`
      );

      // Test profile structure - pairing_codes field
      this.assert(
        profile.hasOwnProperty('pairing_codes'),
        'Profile contains pairing_codes field',
        'Pairing codes field present'
      );
      
      this.assert(
        Array.isArray(profile.pairing_codes),
        'Profile pairing_codes is an array',
        `Type: ${typeof profile.pairing_codes}`
      );

      // Test that sensitive fields are excluded
      this.assert(
        !profile.hasOwnProperty('password_hash'),
        'Profile excludes password_hash (sensitive field filtered)',
        'Password hash correctly excluded'
      );
      
    } catch (error) {
      this.assert(false, 'Profile response structure validation', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test profile edge cases and error scenarios
  async testProfileEdgeCases() {
    this.log('Testing Profile Edge Cases and Error Scenarios', 'section');
    
    try {
      // Test profile for user that doesn't exist (invalid user ID in token)
      const fakeToken = jwt.sign(
        { id: 'nonexistent-user-id', email: 'fake@example.com' },
        this.JWT_SECRET,
        { expiresIn: '1h' }
      );
      
      try {
        await axios.get(`${this.baseURL}/api/profile`, {
          headers: { Authorization: `Bearer ${fakeToken}` },
          timeout: this.timeout
        });
        this.assert(false, 'Profile with nonexistent user should fail', 'Request succeeded unexpectedly');
      } catch (error) {
        this.assert(
          error.response?.status === 404,
          'Profile with nonexistent user returns 404',
          `Status: ${error.response?.status}`
        );
      }

      // Test profile endpoint consistency - multiple calls should return same data
      const user = this.testData.user1;
      if (user) {
        const profile1 = await axios.get(`${this.baseURL}/api/profile`, {
          headers: { Authorization: `Bearer ${user.token}` },
          timeout: this.timeout
        });
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const profile2 = await axios.get(`${this.baseURL}/api/profile`, {
          headers: { Authorization: `Bearer ${user.token}` },
          timeout: this.timeout
        });
        
        this.assert(
          profile1.data.profile.id === profile2.data.profile.id,
          'Multiple profile calls return consistent user ID',
          `ID1: ${profile1.data.profile.id}, ID2: ${profile2.data.profile.id}`
        );
        
        this.assert(
          profile1.data.profile.email === profile2.data.profile.email,
          'Multiple profile calls return consistent email',
          `Email consistent: ${profile1.data.profile.email === profile2.data.profile.email}`
        );
      }
      
    } catch (error) {
      this.assert(false, 'Profile edge cases testing', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test profile endpoint performance
  async testProfilePerformance() {
    this.log('Testing Profile Performance', 'section');
    
    const user = this.testData.user1;
    if (!user) {
      this.log('Skipping performance tests - no user available', 'warn');
      return;
    }

    try {
      const startTime = Date.now();
      
      const profileResponse = await axios.get(`${this.baseURL}/api/profile`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      this.assert(
        profileResponse.status === 200,
        'Profile endpoint performance test successful',
        `Status: ${profileResponse.status}`
      );
      
      this.assert(
        responseTime < 5000, // Should respond within 5 seconds
        'Profile endpoint responds within acceptable time',
        `Response time: ${responseTime}ms`
      );
      
      // Test multiple concurrent requests
      const concurrentRequests = Array.from({ length: 3 }, () =>
        axios.get(`${this.baseURL}/api/profile`, {
          headers: { Authorization: `Bearer ${user.token}` },
          timeout: this.timeout
        })
      );
      
      const concurrentStartTime = Date.now();
      const responses = await Promise.all(concurrentRequests);
      const concurrentEndTime = Date.now();
      const concurrentResponseTime = concurrentEndTime - concurrentStartTime;
      
      this.assert(
        responses.every(r => r.status === 200),
        'All concurrent requests successful',
        `Successful requests: ${responses.filter(r => r.status === 200).length}/3`
      );
      
      this.assert(
        concurrentResponseTime < 8000, // Should handle 3 concurrent requests within 8 seconds
        'Profile endpoint handles concurrent requests efficiently',
        `Concurrent response time: ${concurrentResponseTime}ms`
      );
      
    } catch (error) {
      this.assert(false, 'Profile endpoint performance', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Run all profile endpoint tests
  async runAllTests() {
    this.log('🧪 Starting User Profile Endpoint Test Suite', 'section');
    
    try {
      // Create test users
      const usersCreated = await this.createTestUsers();
      if (!usersCreated) {
        this.log('Failed to create test users, aborting tests', 'fail');
        return false;
      }
      
      console.log('');
      await this.testBasicProfileEndpoint();
      console.log('');
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.testProfileAuthentication();
      console.log('');
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.testProfileWithPendingRequests();
      console.log('');
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.testProfileWithAcceptedPairings();
      console.log('');
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.testProfileResponseStructure();
      console.log('');
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.testProfileEdgeCases();
      console.log('');
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.testProfilePerformance();
      console.log('');
      
      this.printSummary();
      
      return this.testResults.failed === 0;
      
    } catch (error) {
      this.log(`Test suite failed with error: ${error.message}`, 'fail');
      return false;
    }
  }

  printSummary() {
    this.log('📊 User Profile Test Results Summary', 'section');
    this.log(`Total Tests: ${this.testResults.total}`);
    this.log(`Passed: ${this.testResults.passed}`, this.testResults.passed === this.testResults.total ? 'pass' : 'info');
    this.log(`Failed: ${this.testResults.failed}`, this.testResults.failed === 0 ? 'pass' : 'fail');
    
    const successRate = this.testResults.total > 0 
      ? ((this.testResults.passed / this.testResults.total) * 100).toFixed(1)
      : '0';
    
    this.log(`Success Rate: ${successRate}%`, successRate === '100.0' ? 'pass' : 'warn');
    
    if (this.testResults.failed === 0) {
      this.log('🎉 All user profile tests passed! The endpoint is working correctly.', 'pass');
    } else {
      this.log('⚠️ Some user profile tests failed. Review the failures above.', 'fail');
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const testRunner = new UserProfileTestRunner();
  testRunner.runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('User profile test runner failed:', error);
    process.exit(1);
  });
}

module.exports = UserProfileTestRunner;
