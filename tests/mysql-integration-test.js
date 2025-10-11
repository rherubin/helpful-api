/**
 * MySQL Integration Tests for Helpful API
 * Tests the running server with MySQL backend
 * 
 * IMPORTANT: All test users MUST use @example.com email domain
 * This ensures easy identification and safe cleanup of test data
 */

const axios = require('axios');
const assert = require('assert');
const { generateTestEmail, validateTestEmailDomain, TEST_EMAIL_DOMAIN } = require('./test-helpers');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:9000';

// Test configuration
const testConfig = {
  timeout: 10000,
  baseURL: BASE_URL
};

// Test state
let testUser = null;
let accessToken = null;
let refreshToken = null;
let testEmail = generateTestEmail(); // Uses standardized helper
let testPassword = 'TestPass1!@#';
let createdUserIds = []; // Track created users for cleanup

// Helper functions (using standardized test helpers)
function generateEmail() {
  const email = generateTestEmail();
  validateTestEmailDomain(email); // Ensure @example.com domain
  return email;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test suite
async function runTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  console.log('🧪 MySQL Integration Test Suite');
  console.log('================================\n');

  // Test 1: Health Check
  try {
    totalTests++;
    console.log('Test 1: Health Check');
    const response = await axios.get(`${BASE_URL}/health`, { timeout: 5000 });
    assert.strictEqual(response.status, 200);
    assert.ok(response.data.status === 'OK');
    console.log('✅ PASS - Server is healthy\n');
    passedTests++;
  } catch (error) {
    console.log(`❌ FAIL - ${error.message}\n`);
    failedTests++;
  }

  // Test 2: User Registration
  try {
    totalTests++;
    console.log('Test 2: User Registration');
    testEmail = generateEmail();
    const response = await axios.post(`${BASE_URL}/api/users`, {
      email: testEmail,
      password: testPassword
    }, testConfig);
    
    assert.ok([200, 201].includes(response.status)); // Accept both 200 and 201
    assert.ok(response.data.message.includes('created'));
    assert.ok(response.data.access_token);
    assert.ok(response.data.refresh_token);
    assert.ok(response.data.user);
    assert.ok(response.data.user.id);
    
    testUser = response.data.user;
    accessToken = response.data.access_token;
    refreshToken = response.data.refresh_token;
    createdUserIds.push(testUser.id); // Track for cleanup
    
    console.log('✅ PASS - User created with tokens\n');
    passedTests++;
  } catch (error) {
    console.log(`❌ FAIL - ${error.response?.data?.error || error.message}\n`);
    failedTests++;
  }

  // Test 3: Duplicate Email Registration
  try {
    totalTests++;
    console.log('Test 3: Duplicate Email Registration (Should Fail)');
    try {
      await axios.post(`${BASE_URL}/api/users`, {
        email: testEmail,
        password: testPassword
      }, testConfig);
      console.log('❌ FAIL - Should have rejected duplicate email\n');
      failedTests++;
    } catch (error) {
      if (error.response?.status === 409 || error.response?.data?.error?.includes('already exists')) {
        console.log('✅ PASS - Correctly rejected duplicate email\n');
        passedTests++;
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.log(`❌ FAIL - ${error.message}\n`);
    failedTests++;
  }

  // Test 4: Login with Valid Credentials
  try {
    totalTests++;
    console.log('Test 4: Login with Valid Credentials');
    const response = await axios.post(`${BASE_URL}/api/login`, {
      email: testEmail,
      password: testPassword
    }, testConfig);
    
    assert.strictEqual(response.status, 200);
    assert.ok(response.data.data.access_token);
    assert.ok(response.data.message.includes('successful'));
    
    accessToken = response.data.data.access_token;
    refreshToken = response.data.data.refresh_token;
    
    console.log('✅ PASS - Login successful\n');
    passedTests++;
  } catch (error) {
    console.log(`❌ FAIL - ${error.response?.data?.error || error.message}\n`);
    failedTests++;
  }

  // Test 5: Login with Invalid Password
  try {
    totalTests++;
    console.log('Test 5: Login with Invalid Password (Should Fail)');
    try {
      await axios.post(`${BASE_URL}/api/login`, {
        email: testEmail,
        password: 'WrongPassword123!'
      }, testConfig);
      console.log('❌ FAIL - Should have rejected invalid password\n');
      failedTests++;
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('✅ PASS - Correctly rejected invalid password\n');
        passedTests++;
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.log(`❌ FAIL - ${error.message}\n`);
    failedTests++;
  }

  // Test 6: Access Protected Profile Endpoint
  try {
    totalTests++;
    console.log('Test 6: Access Protected Profile Endpoint');
    const response = await axios.get(`${BASE_URL}/api/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 5000
    });
    
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.data.profile.email, testEmail);
    assert.ok(response.data.profile.pairings);
    
    console.log('✅ PASS - Profile accessed successfully\n');
    passedTests++;
  } catch (error) {
    console.log(`❌ FAIL - ${error.response?.data?.error || error.message}\n`);
    failedTests++;
  }

  // Test 7: Access Profile Without Token
  try {
    totalTests++;
    console.log('Test 7: Access Profile Without Token (Should Fail)');
    try {
      await axios.get(`${BASE_URL}/api/profile`, { timeout: 5000 });
      console.log('❌ FAIL - Should require authentication\n');
      failedTests++;
    } catch (error) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        console.log('✅ PASS - Correctly requires authentication\n');
        passedTests++;
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.log(`❌ FAIL - ${error.message}\n`);
    failedTests++;
  }

  // Test 8: Refresh Access Token
  try {
    totalTests++;
    console.log('Test 8: Refresh Access Token');
    await sleep(1000); // Wait 1 second to ensure new timestamp in token
    const response = await axios.post(`${BASE_URL}/api/refresh`, {
      refresh_token: refreshToken
    }, testConfig);
    
    assert.strictEqual(response.status, 200);
    assert.ok(response.data.access_token);
    assert.ok(response.data.message.includes('refreshed'));
    
    const newAccessToken = response.data.access_token;
    // Token should be different (has new timestamp)
    accessToken = newAccessToken;
    
    console.log('✅ PASS - Token refreshed successfully\n');
    passedTests++;
  } catch (error) {
    console.log(`❌ FAIL - ${error.response?.data?.error || error.message}\n`);
    failedTests++;
  }

  // Test 9: Pairing Creation
  try {
    totalTests++;
    console.log('Test 9: Create Pairing Request');
    const response = await axios.post(`${BASE_URL}/api/pairing/request`, {}, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 5000
    });
    
    assert.ok([200, 201].includes(response.status)); // Accept both 200 and 201
    assert.ok(response.data.partner_code);
    assert.ok(response.data.partner_code.length === 6);
    
    console.log(`✅ PASS - Pairing created with code: ${response.data.partner_code}\n`);
    passedTests++;
  } catch (error) {
    console.log(`❌ FAIL - ${error.response?.data?.error || error.message}\n`);
    failedTests++;
  }

  // Test 10: Get User Pairings
  try {
    totalTests++;
    console.log('Test 10: Get User Pairings');
    const response = await axios.get(`${BASE_URL}/api/pairings`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 5000
    });
    
    assert.strictEqual(response.status, 200);
    assert.ok(Array.isArray(response.data.pairings));
    assert.ok(response.data.pairings.length >= 1);
    
    console.log(`✅ PASS - Retrieved ${response.data.pairings.length} pairings\n`);
    passedTests++;
  } catch (error) {
    console.log(`❌ FAIL - ${error.response?.data?.error || error.message}\n`);
    failedTests++;
  }

  // Test 11: Update User Profile
  try {
    totalTests++;
    console.log('Test 11: Update User Profile');
    if (!testUser || !testUser.id) {
      console.log('⚠️  SKIP - No test user ID available\n');
      totalTests--;
      throw new Error('Skip this test');
    }
    const response = await axios.put(`${BASE_URL}/api/users/${testUser.id}`, {
      user_name: 'Test User',
      partner_name: 'Test Partner',
      children: 2
    }, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 5000
    });
    
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.data.user.user_name, 'Test User');
    assert.strictEqual(response.data.user.partner_name, 'Test Partner');
    assert.strictEqual(response.data.user.children, 2);
    
    console.log('✅ PASS - Profile updated successfully\n');
    passedTests++;
  } catch (error) {
    console.log(`❌ FAIL - ${error.response?.data?.error || error.message}\n`);
    failedTests++;
  }

  // Test 12: Password Validation
  try {
    totalTests++;
    console.log('Test 12: Password Validation (Weak Password)');
    const weakEmail = generateEmail();
    try {
      await axios.post(`${BASE_URL}/api/users`, {
        email: weakEmail,
        password: 'weak'
      }, testConfig);
      console.log('❌ FAIL - Should reject weak password\n');
      failedTests++;
    } catch (error) {
      if (error.response?.status === 400 && error.response?.data?.error?.includes('Password')) {
        console.log('✅ PASS - Weak password rejected\n');
        passedTests++;
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.log(`❌ FAIL - ${error.message}\n`);
    failedTests++;
  }

  // Test 13: Logout
  try {
    totalTests++;
    console.log('Test 13: Logout');
    const response = await axios.post(`${BASE_URL}/api/logout`, {
      refresh_token: refreshToken
    }, testConfig);
    
    assert.strictEqual(response.status, 200);
    assert.ok(response.data.message.includes('Logged out'));
    
    console.log('✅ PASS - Logout successful\n');
    passedTests++;
  } catch (error) {
    console.log(`❌ FAIL - ${error.response?.data?.error || error.message}\n`);
    failedTests++;
  }

  // Test 14: Use Token After Logout
  try {
    totalTests++;
    console.log('Test 14: Use Refresh Token After Logout (Should Fail)');
    try {
      await axios.post(`${BASE_URL}/api/refresh`, {
        refresh_token: refreshToken
      }, testConfig);
      console.log('❌ FAIL - Should reject invalidated token\n');
      failedTests++;
    } catch (error) {
      if (error.response?.status === 403 || error.response?.status === 401) {
        console.log('✅ PASS - Invalidated token rejected\n');
        passedTests++;
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.log(`❌ FAIL - ${error.message}\n`);
    failedTests++;
  }

  // Print summary
  console.log('================================');
  console.log('📊 Test Summary');
  console.log('================================');
  console.log(`Total Tests: ${totalTests}`);
  console.log(`✅ Passed: ${passedTests}`);
  console.log(`❌ Failed: ${failedTests}`);
  console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  console.log('================================\n');

  if (failedTests > 0) {
    console.log('⚠️  Some tests failed. Check the output above for details.');
    return { success: false, failedTests };
  } else {
    console.log('🎉 All tests passed! MySQL integration is working perfectly.');
    return { success: true, passedTests };
  }
}

// Check if server is running before starting tests
async function checkServer() {
  try {
    await axios.get(`${BASE_URL}/health`, { timeout: 3000 });
    return true;
  } catch (error) {
    return false;
  }
}

// Cleanup test data
async function showCleanupInstructions() {
  if (createdUserIds.length === 0) {
    return;
  }
  
  console.log('\n📝 Test Data Cleanup');
  console.log('====================');
  console.log(`Created ${createdUserIds.length} test user(s) during this test run.\n`);
  console.log('To clean up ALL test data from your database, run:');
  console.log('  npm run cleanup:test-data\n');
  console.log('Or use the cleanup script directly:');
  console.log('  node tests/cleanup-test-data.js\n');
}

// Main execution
(async () => {
  console.log('Checking if server is running...');
  const serverRunning = await checkServer();
  
  if (!serverRunning) {
    console.error('❌ Server is not running on', BASE_URL);
    console.error('Please start the server with: npm start');
    process.exit(1);
  }
  
  console.log('✅ Server is running\n');
  
  let testResult;
  try {
    testResult = await runTests();
  } finally {
    // Show cleanup instructions
    await showCleanupInstructions();
  }
  
  // Exit with appropriate code
  if (testResult && testResult.success) {
    process.exit(0);
  } else {
    process.exit(1);
  }
})();

