/**
 * Org Codes Test Suite
 * Tests all CRUD operations on org_codes and related user functionality
 *
 * Run with: node tests/org-codes-test.js
 *
 * Environment Variables:
 * - TEST_BASE_URL: API base URL (default: http://127.0.0.1:9000)
 */

require('dotenv').config();
const axios = require('axios');
const { generateTestEmail } = require('./test-helpers');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:9000';

class OrgCodesTestRunner {
  constructor() {
    this.baseURL = BASE_URL;
    this.testResults = {
      passed: 0,
      failed: 0,
      total: 0
    };
    this.testData = {
      user: null,
      userToken: null,
      orgCode1: null,
      orgCode2: null,
      expiredOrgCode: null
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

  async cleanup() {
    this.log('Cleaning up test data...', 'section');

    try {
      // Delete org codes
      if (this.testData.orgCode1?.id) {
        await axios.delete(`${this.baseURL}/api/org-codes/${this.testData.orgCode1.id}`, {
          headers: { Authorization: `Bearer ${this.testData.userToken}` }
        }).catch(() => {}); // Ignore errors during cleanup
      }
      if (this.testData.orgCode2?.id) {
        await axios.delete(`${this.baseURL}/api/org-codes/${this.testData.orgCode2.id}`, {
          headers: { Authorization: `Bearer ${this.testData.userToken}` }
        }).catch(() => {});
      }
      if (this.testData.expiredOrgCode?.id) {
        await axios.delete(`${this.baseURL}/api/org-codes/${this.testData.expiredOrgCode.id}`, {
          headers: { Authorization: `Bearer ${this.testData.userToken}` }
        }).catch(() => {});
      }

      // Soft delete user
      if (this.testData.user?.id) {
        await axios.delete(`${this.baseURL}/api/users/${this.testData.user.id}`, {
          headers: { Authorization: `Bearer ${this.testData.userToken}` }
        }).catch(() => {});
      }
    } catch (error) {
      this.log(`Cleanup warning: ${error.message}`, 'warn');
    }
  }

  /**
   * Setup: Create test user
   */
  async setup() {
    this.log('Setting up test data...', 'section');

    try {
      const userEmail = generateTestEmail('orgcode_test');
      const userPassword = 'TestPass987!';

      // Create user
      const createResponse = await axios.post(`${this.baseURL}/api/users`, {
        email: userEmail,
        password: userPassword
      });

      this.assert(createResponse.status === 201, 'Create test user');
      this.testData.user = createResponse.data.user;
      this.testData.userToken = createResponse.data.access_token;

      this.log('Test data setup complete', 'pass');
      return true;
    } catch (error) {
      this.log(`Setup failed: ${error.message}`, 'fail');
      return false;
    }
  }

  /**
   * Test: Create org code
   */
  async testCreateOrgCode() {
    this.log('Testing org code creation...', 'section');

    try {
      // Test successful creation
      const createResponse = await axios.post(`${this.baseURL}/api/org-codes`, {
        org_code: 'TEST123',
        organization: 'Test Organization'
      }, {
        headers: { Authorization: `Bearer ${this.testData.userToken}` }
      });

      this.assert(createResponse.status === 201, 'Create org code - status 201');
      this.assert(createResponse.data.org_code.org_code === 'TEST123', 'Create org code - correct org_code');
      this.assert(createResponse.data.org_code.organization === 'Test Organization', 'Create org code - correct organization');
      this.assert(createResponse.data.org_code.id, 'Create org code - has ID');
      this.assert(createResponse.data.org_code.created_at, 'Create org code - has created_at');

      this.testData.orgCode1 = createResponse.data.org_code;

      // Test duplicate org_code error
      try {
        await axios.post(`${this.baseURL}/api/org-codes`, {
          org_code: 'TEST123',
          organization: 'Different Organization'
        }, {
          headers: { Authorization: `Bearer ${this.testData.userToken}` }
        });
        this.assert(false, 'Create duplicate org code - should fail');
      } catch (error) {
        this.assert(error.response?.status === 400, 'Create duplicate org code - correct error status');
        this.assert(error.response?.data?.error?.includes('already exists'), 'Create duplicate org code - correct error message');
      }

      // Test missing required fields
      try {
        await axios.post(`${this.baseURL}/api/org-codes`, {
          organization: 'Test Organization'
        }, {
          headers: { Authorization: `Bearer ${this.testData.userToken}` }
        });
        this.assert(false, 'Create org code without org_code - should fail');
      } catch (error) {
        this.assert(error.response?.status === 400, 'Create org code without org_code - correct error status');
      }

      return true;
    } catch (error) {
      this.log(`Create org code test failed: ${error.message}`, 'fail');
      return false;
    }
  }

  /**
   * Test: Get org code by ID
   */
  async testGetOrgCode() {
    this.log('Testing get org code...', 'section');

    try {
      const getResponse = await axios.get(`${this.baseURL}/api/org-codes/${this.testData.orgCode1.id}`, {
        headers: { Authorization: `Bearer ${this.testData.userToken}` }
      });

      this.assert(getResponse.status === 200, 'Get org code - status 200');
      this.assert(getResponse.data.org_code.id === this.testData.orgCode1.id, 'Get org code - correct ID');
      this.assert(getResponse.data.org_code.org_code === 'TEST123', 'Get org code - correct org_code');

      // Test non-existent ID
      try {
        await axios.get(`${this.baseURL}/api/org-codes/non-existent-id`, {
          headers: { Authorization: `Bearer ${this.testData.userToken}` }
        });
        this.assert(false, 'Get non-existent org code - should fail');
      } catch (error) {
        this.assert(error.response?.status === 404, 'Get non-existent org code - correct error status');
      }

      return true;
    } catch (error) {
      this.log(`Get org code test failed: ${error.message}`, 'fail');
      return false;
    }
  }

  /**
   * Test: Update org code
   */
  async testUpdateOrgCode() {
    this.log('Testing update org code...', 'section');

    try {
      const updateResponse = await axios.put(`${this.baseURL}/api/org-codes/${this.testData.orgCode1.id}`, {
        organization: 'Updated Test Organization',
        initial_program_prompt: 'Custom initial prompt'
      }, {
        headers: { Authorization: `Bearer ${this.testData.userToken}` }
      });

      this.assert(updateResponse.status === 200, 'Update org code - status 200');
      this.assert(updateResponse.data.org_code.organization === 'Updated Test Organization', 'Update org code - organization updated');
      this.assert(updateResponse.data.org_code.initial_program_prompt === 'Custom initial prompt', 'Update org code - prompt updated');

      // Verify the update persisted
      const getResponse = await axios.get(`${this.baseURL}/api/org-codes/${this.testData.orgCode1.id}`, {
        headers: { Authorization: `Bearer ${this.testData.userToken}` }
      });

      this.assert(getResponse.data.org_code.organization === 'Updated Test Organization', 'Update org code - persisted correctly');

      // Test update non-existent org code
      try {
        await axios.put(`${this.baseURL}/api/org-codes/non-existent-id`, {
          organization: 'Should not work'
        }, {
          headers: { Authorization: `Bearer ${this.testData.userToken}` }
        });
        this.assert(false, 'Update non-existent org code - should fail');
      } catch (error) {
        this.assert(error.response?.status === 404, 'Update non-existent org code - correct error status');
      }

      return true;
    } catch (error) {
      this.log(`Update org code test failed: ${error.message}`, 'fail');
      return false;
    }
  }

  /**
   * Test: List all org codes
   */
  async testListOrgCodes() {
    this.log('Testing list org codes...', 'section');

    try {
      // Create a second org code for testing
      const createResponse2 = await axios.post(`${this.baseURL}/api/org-codes`, {
        org_code: 'TEST456',
        organization: 'Second Test Organization'
      }, {
        headers: { Authorization: `Bearer ${this.testData.userToken}` }
      });

      this.testData.orgCode2 = createResponse2.data.org_code;

      const listResponse = await axios.get(`${this.baseURL}/api/org-codes`, {
        headers: { Authorization: `Bearer ${this.testData.userToken}` }
      });

      this.assert(listResponse.status === 200, 'List org codes - status 200');
      this.assert(Array.isArray(listResponse.data.org_codes), 'List org codes - returns array');
      this.assert(listResponse.data.org_codes.length >= 2, 'List org codes - returns at least created org codes');

      const foundTest123 = listResponse.data.org_codes.some(oc => oc.org_code === 'TEST123');
      const foundTest456 = listResponse.data.org_codes.some(oc => oc.org_code === 'TEST456');

      this.assert(foundTest123, 'List org codes - contains TEST123');
      this.assert(foundTest456, 'List org codes - contains TEST456');

      return true;
    } catch (error) {
      this.log(`List org codes test failed: ${error.message}`, 'fail');
      return false;
    }
  }

  /**
   * Test: Delete org code
   */
  async testDeleteOrgCode() {
    this.log('Testing delete org code...', 'section');

    try {
      const deleteResponse = await axios.delete(`${this.baseURL}/api/org-codes/${this.testData.orgCode2.id}`, {
        headers: { Authorization: `Bearer ${this.testData.userToken}` }
      });

      this.assert(deleteResponse.status === 200, 'Delete org code - status 200');

      // Verify deletion
      try {
        await axios.get(`${this.baseURL}/api/org-codes/${this.testData.orgCode2.id}`, {
          headers: { Authorization: `Bearer ${this.testData.userToken}` }
        });
        this.assert(false, 'Delete org code - should not find deleted org code');
      } catch (error) {
        this.assert(error.response?.status === 404, 'Delete org code - correctly not found after deletion');
      }

      return true;
    } catch (error) {
      this.log(`Delete org code test failed: ${error.message}`, 'fail');
      return false;
    }
  }

  /**
   * Test: User org_code_id in GET /users/:id response
   */
  async testUserOrgCodeInGetUser() {
    this.log('Testing user org_code_id in GET /users/:id...', 'section');

    try {
      // First, assign org code to user
      const updateResponse = await axios.put(`${this.baseURL}/api/users/${this.testData.user.id}`, {
        org_code_id: this.testData.orgCode1.id
      }, {
        headers: { Authorization: `Bearer ${this.testData.userToken}` }
      });

      this.assert(updateResponse.status === 200, 'Assign org code to user - status 200');

      // Now get user and verify org_code_id is included
      const getUserResponse = await axios.get(`${this.baseURL}/api/users/${this.testData.user.id}`, {
        headers: { Authorization: `Bearer ${this.testData.userToken}` }
      });

      this.assert(getUserResponse.status === 200, 'Get user - status 200');
      this.assert(getUserResponse.data.org_code_id === this.testData.orgCode1.id, 'Get user - includes correct org_code_id');

      return true;
    } catch (error) {
      this.log(`User org_code_id test failed: ${error.message}`, 'fail');
      return false;
    }
  }

  /**
   * Test: User org_code_id in GET /profile response
   */
  async testUserOrgCodeInProfile() {
    this.log('Testing user org_code_id in GET /profile...', 'section');

    try {
      const profileResponse = await axios.get(`${this.baseURL}/api/profile`, {
        headers: { Authorization: `Bearer ${this.testData.userToken}` }
      });

      this.assert(profileResponse.status === 200, 'Get profile - status 200');
      this.assert(profileResponse.data.profile.org_code_id === this.testData.orgCode1.id, 'Get profile - includes correct org_code_id');

      return true;
    } catch (error) {
      this.log(`Profile org_code_id test failed: ${error.message}`, 'fail');
      return false;
    }
  }

  /**
   * Test: PUT /users/:id supports changing org_code_id
   */
  async testUpdateUserOrgCode() {
    this.log('Testing PUT /users/:id org_code_id update...', 'section');

    try {
      // Create another org code to switch to
      const createResponse3 = await axios.post(`${this.baseURL}/api/org-codes`, {
        org_code: 'TEST789',
        organization: 'Third Test Organization'
      }, {
        headers: { Authorization: `Bearer ${this.testData.userToken}` }
      });

      this.testData.orgCode2 = createResponse3.data.org_code;

      // Update user to use the new org code
      const updateResponse = await axios.put(`${this.baseURL}/api/users/${this.testData.user.id}`, {
        org_code_id: this.testData.orgCode2.id
      }, {
        headers: { Authorization: `Bearer ${this.testData.userToken}` }
      });

      this.assert(updateResponse.status === 200, 'Update user org_code_id - status 200');
      this.assert(updateResponse.data.user.org_code_id === this.testData.orgCode2.id, 'Update user org_code_id - correct value');

      // Verify the change persisted
      const profileResponse = await axios.get(`${this.baseURL}/api/profile`, {
        headers: { Authorization: `Bearer ${this.testData.userToken}` }
      });

      this.assert(profileResponse.data.profile.org_code_id === this.testData.orgCode2.id, 'Update user org_code_id - persisted correctly');

      // Test setting org_code_id to null
      const nullUpdateResponse = await axios.put(`${this.baseURL}/api/users/${this.testData.user.id}`, {
        org_code_id: null
      }, {
        headers: { Authorization: `Bearer ${this.testData.userToken}` }
      });

      this.assert(nullUpdateResponse.status === 200, 'Set user org_code_id to null - status 200');
      this.assert(nullUpdateResponse.data.user.org_code_id === null, 'Set user org_code_id to null - correct value');

      return true;
    } catch (error) {
      this.log(`Update user org_code_id test failed: ${error.message}`, 'fail');
      return false;
    }
  }


  /**
   * Run all tests
   */
  async runAllTests() {
    this.log('🧪 Starting Org Codes Test Suite', 'section');
    console.log('='.repeat(60));

    try {
      // Setup
      const setupSuccess = await this.setup();
      if (!setupSuccess) {
        throw new Error('Setup failed');
      }

      // Run tests
      const tests = [
        () => this.testCreateOrgCode(),
        () => this.testGetOrgCode(),
        () => this.testUpdateOrgCode(),
        () => this.testListOrgCodes(),
        () => this.testDeleteOrgCode(),
        () => this.testUserOrgCodeInGetUser(),
        () => this.testUserOrgCodeInProfile(),
        () => this.testUpdateUserOrgCode()
      ];

      for (const test of tests) {
        try {
          await test();
        } catch (error) {
          this.log(`Test execution error: ${error.message}`, 'fail');
          this.testResults.failed++;
          this.testResults.total++;
        }
      }

    } finally {
      // Cleanup
      await this.cleanup();
    }

    // Results
    console.log('\n' + '='.repeat(60));
    console.log('📊 ORG CODES TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${this.testResults.total}`);
    console.log(`Passed: ${this.testResults.passed}`);
    console.log(`Failed: ${this.testResults.failed}`);
    console.log(`Success Rate: ${this.testResults.total > 0 ? Math.round((this.testResults.passed / this.testResults.total) * 100) : 0}%`);

    return this.testResults.failed === 0;
  }
}

// Run tests if called directly
if (require.main === module) {
  const testRunner = new OrgCodesTestRunner();
  testRunner.runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test runner error:', error);
      process.exit(1);
    });
}

module.exports = OrgCodesTestRunner;