const axios = require('axios');

const BASE_URL = process.env.API_URL || 'http://localhost:9000';

// ANSI color codes for better output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testTokenExpiry() {
  log('\n=== Token Expiry Configuration Test ===\n', 'cyan');

  try {
    // Test 1: Login and get tokens
    log('Test 1: Login to get access token', 'blue');
    const loginResponse = await axios.post(`${BASE_URL}/auth/login`, {
      email: 'test@example.com',
      password: 'password123'
    });

    const { access_token, expires_in, refresh_expires_in } = loginResponse.data.data;
    log(`✓ Login successful`, 'green');
    log(`  Access token expires in: ${expires_in} seconds (${Math.floor(expires_in / 60)} minutes)`, 'yellow');
    log(`  Refresh token expires in: ${refresh_expires_in} seconds (${Math.floor(refresh_expires_in / 60 / 60 / 24)} days)`, 'yellow');

    // Test 2: Check token info
    log('\nTest 2: Check token information', 'blue');
    const tokenInfoResponse = await axios.post(`${BASE_URL}/auth/token-info`, {
      access_token: access_token
    });

    const tokenInfo = tokenInfoResponse.data;
    log(`✓ Token info retrieved`, 'green');
    log(`  Issued at: ${tokenInfo.issued_at}`, 'yellow');
    log(`  Expires at: ${tokenInfo.expires_at}`, 'yellow');
    log(`  Token age: ${tokenInfo.token_age_minutes} minutes`, 'yellow');
    log(`  Time until expiry: ${tokenInfo.time_until_expiry_minutes} minutes (${tokenInfo.time_until_expiry_seconds} seconds)`, 'yellow');
    log(`  Is expired: ${tokenInfo.is_expired}`, tokenInfo.is_expired ? 'red' : 'green');

    // Test 3: Verify token works
    log('\nTest 3: Use access token to get profile', 'blue');
    const profileResponse = await axios.get(`${BASE_URL}/auth/profile`, {
      headers: {
        'Authorization': `Bearer ${access_token}`
      }
    });
    log(`✓ Profile retrieved successfully`, 'green');
    log(`  User: ${profileResponse.data.profile.email}`, 'yellow');

    // Summary
    log('\n=== Summary ===', 'cyan');
    log(`✓ Access token is valid for ${tokenInfo.time_until_expiry_minutes} minutes`, 'green');
    
    if (tokenInfo.time_until_expiry_minutes < 30) {
      log(`⚠ WARNING: Token expires in less than 30 minutes. Consider increasing JWT_EXPIRES_IN`, 'red');
    } else if (tokenInfo.time_until_expiry_minutes < 60) {
      log(`⚠ Token expires in less than 1 hour. This may be too short for good UX`, 'yellow');
    } else {
      log(`✓ Token expiry time looks good for user experience`, 'green');
    }

    log('\n✓ All tests passed!', 'green');

  } catch (error) {
    if (error.response) {
      log(`\n✗ Test failed: ${error.response.status} ${error.response.statusText}`, 'red');
      log(`  Error: ${JSON.stringify(error.response.data, null, 2)}`, 'red');
    } else if (error.request) {
      log(`\n✗ Test failed: No response from server`, 'red');
      log(`  Make sure the server is running at ${BASE_URL}`, 'yellow');
    } else {
      log(`\n✗ Test failed: ${error.message}`, 'red');
    }
    process.exit(1);
  }
}

// Run the test
testTokenExpiry();

