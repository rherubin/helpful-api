const axios = require('axios');

// Test configuration
const BASE_URL = process.env.API_URL || 'http://localhost:3000';

// Color codes for terminal output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testWWWAuthenticateHeader() {
  log('\n=== Testing WWW-Authenticate Header ===\n', 'blue');
  
  let passedTests = 0;
  let failedTests = 0;

  // Test 1: Missing Authorization header
  try {
    log('Test 1: Request without Authorization header...', 'yellow');
    const response = await axios.get(`${BASE_URL}/api/profile`, {
      validateStatus: () => true // Don't throw on any status
    });
    
    if (response.status === 401) {
      const wwwAuth = response.headers['www-authenticate'];
      if (wwwAuth && wwwAuth.includes('Bearer')) {
        log('✓ PASS: WWW-Authenticate header present and contains Bearer scheme', 'green');
        log(`  Header value: ${wwwAuth}`, 'blue');
        passedTests++;
      } else {
        log('✗ FAIL: WWW-Authenticate header missing or invalid', 'red');
        log(`  Expected: Bearer realm="API"`, 'red');
        log(`  Received: ${wwwAuth || 'none'}`, 'red');
        failedTests++;
      }
    } else {
      log('✗ FAIL: Expected 401 status', 'red');
      log(`  Received status: ${response.status}`, 'red');
      failedTests++;
    }
  } catch (error) {
    log('✗ FAIL: Error making request', 'red');
    log(`  Error: ${error.message}`, 'red');
    failedTests++;
  }

  // Test 2: Invalid token
  try {
    log('\nTest 2: Request with invalid token...', 'yellow');
    const response = await axios.get(`${BASE_URL}/api/profile`, {
      headers: {
        'Authorization': 'Bearer invalid_token_12345'
      },
      validateStatus: () => true
    });
    
    if (response.status === 401) {
      const wwwAuth = response.headers['www-authenticate'];
      if (wwwAuth && wwwAuth.includes('Bearer') && wwwAuth.includes('invalid_token')) {
        log('✓ PASS: WWW-Authenticate header present with error details', 'green');
        log(`  Header value: ${wwwAuth}`, 'blue');
        passedTests++;
      } else {
        log('✗ FAIL: WWW-Authenticate header missing or invalid', 'red');
        log(`  Expected: Bearer realm="API", error="invalid_token"...`, 'red');
        log(`  Received: ${wwwAuth || 'none'}`, 'red');
        failedTests++;
      }
    } else {
      log('✗ FAIL: Expected 401 status', 'red');
      log(`  Received status: ${response.status}`, 'red');
      failedTests++;
    }
  } catch (error) {
    log('✗ FAIL: Error making request', 'red');
    log(`  Error: ${error.message}`, 'red');
    failedTests++;
  }

  // Test 3: Invalid login credentials
  try {
    log('\nTest 3: Login with invalid credentials...', 'yellow');
    const response = await axios.post(`${BASE_URL}/api/login`, {
      email: 'nonexistent@example.com',
      password: 'wrongpassword'
    }, {
      validateStatus: () => true
    });
    
    if (response.status === 401) {
      const wwwAuth = response.headers['www-authenticate'];
      if (wwwAuth && wwwAuth.includes('Bearer')) {
        log('✓ PASS: WWW-Authenticate header present on login failure', 'green');
        log(`  Header value: ${wwwAuth}`, 'blue');
        passedTests++;
      } else {
        log('✗ FAIL: WWW-Authenticate header missing on login failure', 'red');
        log(`  Expected: Bearer realm="API"`, 'red');
        log(`  Received: ${wwwAuth || 'none'}`, 'red');
        failedTests++;
      }
    } else {
      log('✗ FAIL: Expected 401 status for invalid credentials', 'red');
      log(`  Received status: ${response.status}`, 'red');
      failedTests++;
    }
  } catch (error) {
    log('✗ FAIL: Error making login request', 'red');
    log(`  Error: ${error.message}`, 'red');
    failedTests++;
  }

  // Test 4: Invalid refresh token
  try {
    log('\nTest 4: Refresh with invalid token...', 'yellow');
    const response = await axios.post(`${BASE_URL}/api/refresh`, {
      refresh_token: 'invalid_refresh_token_12345'
    }, {
      validateStatus: () => true
    });
    
    if (response.status === 401) {
      const wwwAuth = response.headers['www-authenticate'];
      if (wwwAuth && wwwAuth.includes('Bearer') && wwwAuth.includes('invalid_token')) {
        log('✓ PASS: WWW-Authenticate header present on refresh failure', 'green');
        log(`  Header value: ${wwwAuth}`, 'blue');
        passedTests++;
      } else {
        log('✗ FAIL: WWW-Authenticate header missing on refresh failure', 'red');
        log(`  Expected: Bearer realm="API", error="invalid_token"...`, 'red');
        log(`  Received: ${wwwAuth || 'none'}`, 'red');
        failedTests++;
      }
    } else {
      log('✗ FAIL: Expected 401 status for invalid refresh token', 'red');
      log(`  Received status: ${response.status}`, 'red');
      failedTests++;
    }
  } catch (error) {
    log('✗ FAIL: Error making refresh request', 'red');
    log(`  Error: ${error.message}`, 'red');
    failedTests++;
  }

  // Summary
  log('\n=== Test Summary ===', 'blue');
  log(`Total Tests: ${passedTests + failedTests}`, 'blue');
  log(`Passed: ${passedTests}`, 'green');
  log(`Failed: ${failedTests}`, failedTests > 0 ? 'red' : 'green');
  
  if (failedTests === 0) {
    log('\n✓ All WWW-Authenticate header tests passed!', 'green');
    process.exit(0);
  } else {
    log('\n✗ Some tests failed. Please review the output above.', 'red');
    process.exit(1);
  }
}

// Run the tests
log('Starting WWW-Authenticate Header Tests...', 'blue');
log(`API URL: ${BASE_URL}`, 'blue');

testWWWAuthenticateHeader().catch(error => {
  log('\n✗ Test suite error:', 'red');
  console.error(error);
  process.exit(1);
});

