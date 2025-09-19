const axios = require('axios');
const jwt = require('jsonwebtoken');

/**
 * Pairings Endpoint Test Suite
 * Tests the updated GET /api/pairings endpoint that now includes both accepted and pending pairings
 * 
 * Run with: node tests/pairings-endpoint-test.js
 */

class PairingsEndpointTestRunner {
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

  // Create test users for pairing tests
  async createTestUsers() {
    const timestamp = Date.now();
    
    // Create first test user
    const user1Data = {
      email: `pairings.user1.${timestamp}@example.com`,
      first_name: 'Pairings',
      last_name: 'User1',
      password: 'Test1!@#'
    };
    
    // Create second test user for pairing tests
    const user2Data = {
      email: `pairings.user2.${timestamp}@example.com`,
      first_name: 'Pairings',
      last_name: 'User2',
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

  // Test basic pairings endpoint functionality
  async testBasicPairingsEndpoint() {
    this.log('Testing Basic Pairings Endpoint', 'section');
    
    const user = this.testData.user1;
    if (!user) {
      this.log('Skipping pairings tests - no user available', 'warn');
      return;
    }

    try {
      const pairingsResponse = await axios.get(`${this.baseURL}/api/pairings`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      
      this.assert(
        pairingsResponse.status === 200,
        'Pairings endpoint returns 200',
        `Status: ${pairingsResponse.status}`
      );
      
      this.assert(
        !!pairingsResponse.data.pairings,
        'Pairings endpoint returns pairings array',
        'Pairings array present'
      );
      
      this.assert(
        Array.isArray(pairingsResponse.data.pairings),
        'Pairings response contains array',
        `Type: ${typeof pairingsResponse.data.pairings}`
      );
      
      this.assert(
        !!pairingsResponse.data.message,
        'Pairings response contains message',
        `Message: ${pairingsResponse.data.message}`
      );

      // Store initial count for later comparison
      this.testData.initialPairingsCount = pairingsResponse.data.pairings.length;
      
    } catch (error) {
      this.assert(false, 'Basic pairings endpoint functionality', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test pairings endpoint with pending requests
  async testPairingsWithPendingRequests() {
    this.log('Testing Pairings with Pending Requests', 'section');
    
    const user = this.testData.user1;
    if (!user) {
      this.log('Skipping pending pairings tests - no user available', 'warn');
      return;
    }

    try {
      // Create a pairing request (generates partner code)
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

      // Get pairings - should now include the pending request
      const pairingsResponse = await axios.get(`${this.baseURL}/api/pairings`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      
      this.assert(
        pairingsResponse.status === 200,
        'Pairings with pending requests returns 200',
        `Status: ${pairingsResponse.status}`
      );
      
      const pairings = pairingsResponse.data.pairings;
      this.assert(
        pairings.length > this.testData.initialPairingsCount,
        'Pairings count increased after creating request',
        `Count: ${pairings.length} (was ${this.testData.initialPairingsCount})`
      );

      // Find the new pending pairing
      const pendingPairing = pairings.find(p => p.partner_code === partnerCode);
      
      if (pendingPairing) {
        this.assert(
          pendingPairing.status === 'pending',
          'Pending pairing has correct status',
          `Status: ${pendingPairing.status}`
        );
        
        this.assert(
          pendingPairing.partner === null,
          'Pending pairing has null partner (no one accepted yet)',
          `Partner: ${pendingPairing.partner}`
        );
        
        this.assert(
          !!pendingPairing.id,
          'Pending pairing contains ID',
          `ID: ${pendingPairing.id}`
        );
        
        this.assert(
          !!pendingPairing.created_at,
          'Pending pairing contains created_at timestamp',
          `Created: ${pendingPairing.created_at}`
        );

        // Store for later tests
        this.testData.pendingPairingId = pendingPairing.id;
        this.testData.partnerCode = partnerCode;
      } else {
        this.assert(false, 'Could not find the pending pairing in response', `Partner code: ${partnerCode}`);
      }
      
    } catch (error) {
      this.assert(false, 'Pairings with pending requests', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test pairings endpoint with accepted pairings
  async testPairingsWithAcceptedPairings() {
    this.log('Testing Pairings with Accepted Pairings', 'section');
    
    const user1 = this.testData.user1;
    const user2 = this.testData.user2;
    
    if (!user1 || !user2) {
      this.log('Skipping accepted pairings tests - users not available', 'warn');
      return;
    }

    try {
      // Create a new pairing request from user1
      const pairingResponse = await axios.post(`${this.baseURL}/api/pairing/request`, {}, {
        headers: { Authorization: `Bearer ${user1.token}` },
        timeout: this.timeout
      });
      
      const partnerCode = pairingResponse.data.partner_code;
      
      // User2 accepts the pairing
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

      // Wait for pairing to be processed
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Test user1's pairings (should include the accepted pairing)
      const user1PairingsResponse = await axios.get(`${this.baseURL}/api/pairings`, {
        headers: { Authorization: `Bearer ${user1.token}` },
        timeout: this.timeout
      });
      
      this.assert(
        user1PairingsResponse.status === 200,
        'User 1 pairings with accepted pairing returns 200',
        `Status: ${user1PairingsResponse.status}`
      );
      
      const user1Pairings = user1PairingsResponse.data.pairings;
      const acceptedPairing = user1Pairings.find(p => p.status === 'accepted');
      
      if (acceptedPairing) {
        this.assert(
          acceptedPairing.status === 'accepted',
          'Accepted pairing has correct status',
          `Status: ${acceptedPairing.status}`
        );
        
        this.assert(
          !!acceptedPairing.partner,
          'Accepted pairing has partner object',
          'Partner object present'
        );
        
        this.assert(
          acceptedPairing.partner.id === user2.id,
          'Accepted pairing has correct partner ID',
          `Partner ID: ${acceptedPairing.partner.id}`
        );
        
        this.assert(
          acceptedPairing.partner.email === user2.email,
          'Accepted pairing has correct partner email',
          `Partner email: ${acceptedPairing.partner.email}`
        );
      } else {
        this.assert(false, 'Could not find accepted pairing in user1 pairings', 'No accepted pairing found');
      }

      // Test user2's pairings (should also include the accepted pairing)
      const user2PairingsResponse = await axios.get(`${this.baseURL}/api/pairings`, {
        headers: { Authorization: `Bearer ${user2.token}` },
        timeout: this.timeout
      });
      
      const user2Pairings = user2PairingsResponse.data.pairings;
      const user2AcceptedPairing = user2Pairings.find(p => p.status === 'accepted');
      
      if (user2AcceptedPairing) {
        this.assert(
          user2AcceptedPairing.partner.id === user1.id,
          'User 2 accepted pairing has correct partner ID',
          `Partner ID: ${user2AcceptedPairing.partner.id}`
        );
      }
      
    } catch (error) {
      this.assert(false, 'Pairings with accepted pairings', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test pairings endpoint sorting and structure
  async testPairingsStructureAndSorting() {
    this.log('Testing Pairings Structure and Sorting', 'section');
    
    const user = this.testData.user1;
    if (!user) {
      this.log('Skipping structure tests - no user available', 'warn');
      return;
    }

    try {
      const pairingsResponse = await axios.get(`${this.baseURL}/api/pairings`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      
      const pairings = pairingsResponse.data.pairings;
      
      // Test structure of each pairing
      if (pairings.length > 0) {
        const pairing = pairings[0];
        const requiredFields = ['id', 'status', 'partner_code', 'created_at', 'updated_at', 'partner'];
        
        requiredFields.forEach(field => {
          this.assert(
            pairing.hasOwnProperty(field),
            `Pairing contains ${field} field`,
            `Value: ${pairing[field]}`
          );
        });

        // Test sorting (should be sorted by created_at descending)
        if (pairings.length > 1) {
          const firstDate = new Date(pairings[0].created_at);
          const secondDate = new Date(pairings[1].created_at);
          
          this.assert(
            firstDate >= secondDate,
            'Pairings are sorted by created_at descending (most recent first)',
            `First: ${pairings[0].created_at}, Second: ${pairings[1].created_at}`
          );
        }
      }
      
    } catch (error) {
      this.assert(false, 'Pairings structure and sorting', `Error: ${error.response?.data?.error || error.message}`);
    }
  }

  // Test pairings endpoint authentication
  async testPairingsAuthentication() {
    this.log('Testing Pairings Authentication', 'section');
    
    // Test without token
    try {
      await axios.get(`${this.baseURL}/api/pairings`, { timeout: this.timeout });
      this.assert(false, 'Pairings without token should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 401,
        'Pairings without token returns 401',
        `Status: ${error.response?.status}`
      );
    }

    // Test with invalid token
    try {
      await axios.get(`${this.baseURL}/api/pairings`, {
        headers: { Authorization: 'Bearer invalid-token' },
        timeout: this.timeout
      });
      this.assert(false, 'Pairings with invalid token should fail', 'Request succeeded unexpectedly');
    } catch (error) {
      this.assert(
        error.response?.status === 403,
        'Pairings with invalid token returns 403',
        `Status: ${error.response?.status}`
      );
    }
  }

  // Run all pairings endpoint tests
  async runAllTests() {
    this.log('🧪 Starting Pairings Endpoint Test Suite', 'section');
    
    try {
      // Create test users
      const usersCreated = await this.createTestUsers();
      if (!usersCreated) {
        this.log('Failed to create test users, aborting tests', 'fail');
        return false;
      }
      
      console.log('');
      await this.testBasicPairingsEndpoint();
      console.log('');
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.testPairingsAuthentication();
      console.log('');
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.testPairingsWithPendingRequests();
      console.log('');
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.testPairingsWithAcceptedPairings();
      console.log('');
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.testPairingsStructureAndSorting();
      console.log('');
      
      this.printSummary();
      
      return this.testResults.failed === 0;
      
    } catch (error) {
      this.log(`Test suite failed with error: ${error.message}`, 'fail');
      return false;
    }
  }

  printSummary() {
    this.log('📊 Pairings Endpoint Test Results Summary', 'section');
    this.log(`Total Tests: ${this.testResults.total}`);
    this.log(`Passed: ${this.testResults.passed}`, this.testResults.passed === this.testResults.total ? 'pass' : 'info');
    this.log(`Failed: ${this.testResults.failed}`, this.testResults.failed === 0 ? 'pass' : 'fail');
    
    const successRate = this.testResults.total > 0 
      ? ((this.testResults.passed / this.testResults.total) * 100).toFixed(1)
      : '0';
    
    this.log(`Success Rate: ${successRate}%`, successRate === '100.0' ? 'pass' : 'warn');
    
    if (this.testResults.failed === 0) {
      this.log('🎉 All pairings endpoint tests passed! The endpoint is working correctly.', 'pass');
    } else {
      this.log('⚠️ Some pairings endpoint tests failed. Review the failures above.', 'fail');
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const testRunner = new PairingsEndpointTestRunner();
  testRunner.runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Pairings endpoint test runner failed:', error);
    process.exit(1);
  });
}

module.exports = PairingsEndpointTestRunner;
