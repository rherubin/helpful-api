/**
 * Refresh Token Rotation Test
 * 
 * Tests that when /refresh is called:
 * 1. A new access token is returned
 * 2. A new refresh token is returned
 * 3. The old refresh token is invalidated
 * 4. The new refresh token has an extended expiration
 */

require('dotenv').config();
const axios = require('axios');
const { getPool } = require('../config/database');

const API_URL = process.env.TEST_BASE_URL || process.env.API_URL || 'http://localhost:9000';

// Generate unique test email
const testEmail = `refresh-rotation-test_${Date.now()}_${Math.random().toString(36).substr(2, 5)}@example.com`;
const testPassword = 'TestPassword123!';

async function runTest() {
  console.log('🧪 Starting Refresh Token Rotation Test\n');
  
  let pool;
  let userId;
  let originalRefreshToken;
  let originalAccessToken;
  let newRefreshToken;
  let newAccessToken;

  try {
    // Setup: Create a test user
    console.log('📝 Step 1: Creating test user...');
    const registerResponse = await axios.post(`${API_URL}/auth/register`, {
      email: testEmail,
      password: testPassword,
      first_name: 'Refresh',
      last_name: 'Test'
    });

    if (registerResponse.status !== 201) {
      throw new Error(`Registration failed with status ${registerResponse.status}`);
    }

    userId = registerResponse.data.data.user.id;
    originalRefreshToken = registerResponse.data.data.refresh_token;
    originalAccessToken = registerResponse.data.data.access_token;

    console.log('✅ User created successfully');
    console.log(`   User ID: ${userId}`);
    console.log(`   Original Refresh Token: ${originalRefreshToken.substring(0, 20)}...`);
    console.log(`   Original Access Token: ${originalAccessToken.substring(0, 20)}...\n`);

    // Get original token expiration from database
    pool = getPool();
    const [originalTokenData] = await pool.execute(
      'SELECT token, expires_at, UNIX_TIMESTAMP(expires_at) as expires_unix FROM refresh_tokens WHERE user_id = ?',
      [userId]
    );

    console.log('📊 Original token in database:');
    console.log(`   Expires at: ${originalTokenData[0].expires_at}`);
    console.log(`   Token matches: ${originalTokenData[0].token === originalRefreshToken ? '✅' : '❌'}\n`);

    // Wait a moment to ensure timestamps are different
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test: Call /refresh endpoint
    console.log('🔄 Step 2: Calling /refresh endpoint...');
    const refreshResponse = await axios.post(`${API_URL}/auth/refresh`, {
      refresh_token: originalRefreshToken
    });

    if (refreshResponse.status !== 200) {
      throw new Error(`Refresh failed with status ${refreshResponse.status}`);
    }

    newAccessToken = refreshResponse.data.access_token;
    newRefreshToken = refreshResponse.data.refresh_token;

    console.log('✅ Refresh successful');
    console.log(`   New Access Token: ${newAccessToken.substring(0, 20)}...`);
    console.log(`   New Refresh Token: ${newRefreshToken.substring(0, 20)}...`);
    console.log(`   Tokens are different: ${newRefreshToken !== originalRefreshToken ? '✅' : '❌'}\n`);

    // Verify: Check that new refresh token is in database
    console.log('🔍 Step 3: Verifying new token in database...');
    const [newTokenData] = await pool.execute(
      'SELECT token, expires_at, UNIX_TIMESTAMP(expires_at) as expires_unix FROM refresh_tokens WHERE user_id = ?',
      [userId]
    );

    const tokenMatches = newTokenData[0].token === newRefreshToken;
    const expirationExtended = newTokenData[0].expires_unix > originalTokenData[0].expires_unix;

    console.log(`   New token in database: ${tokenMatches ? '✅' : '❌'}`);
    console.log(`   Old expires at: ${originalTokenData[0].expires_at}`);
    console.log(`   New expires at: ${newTokenData[0].expires_at}`);
    console.log(`   Expiration extended: ${expirationExtended ? '✅' : '❌'}\n`);

    if (!tokenMatches) {
      throw new Error('New refresh token not found in database');
    }

    if (!expirationExtended) {
      throw new Error('Token expiration was not extended');
    }

    // Verify: Old refresh token should no longer work
    console.log('🔒 Step 4: Verifying old token is invalidated...');
    try {
      await axios.post(`${API_URL}/auth/refresh`, {
        refresh_token: originalRefreshToken
      });
      throw new Error('Old refresh token should have been invalidated but still works!');
    } catch (error) {
      if (error.response && error.response.status === 401) {
        console.log('✅ Old refresh token correctly rejected\n');
      } else {
        throw error;
      }
    }

    // Verify: New refresh token should work
    console.log('✅ Step 5: Verifying new token works...');
    const secondRefreshResponse = await axios.post(`${API_URL}/auth/refresh`, {
      refresh_token: newRefreshToken
    });

    if (secondRefreshResponse.status !== 200) {
      throw new Error(`Second refresh failed with status ${secondRefreshResponse.status}`);
    }

    console.log('✅ New refresh token works correctly');
    console.log(`   Another new access token: ${secondRefreshResponse.data.access_token.substring(0, 20)}...`);
    console.log(`   Another new refresh token: ${secondRefreshResponse.data.refresh_token.substring(0, 20)}...\n`);

    // Verify: New access token can access protected routes
    console.log('🔐 Step 6: Verifying new access token works...');
    const profileResponse = await axios.get(`${API_URL}/auth/profile`, {
      headers: {
        'Authorization': `Bearer ${newAccessToken}`
      }
    });

    if (profileResponse.status !== 200) {
      throw new Error(`Profile request failed with status ${profileResponse.status}`);
    }

    console.log('✅ New access token works for protected routes');
    console.log(`   Profile email: ${profileResponse.data.profile.email}\n`);

    console.log('✅ ALL TESTS PASSED!\n');
    console.log('Summary:');
    console.log('- ✅ Refresh endpoint returns new access token');
    console.log('- ✅ Refresh endpoint returns new refresh token');
    console.log('- ✅ New refresh token is stored in database');
    console.log('- ✅ Token expiration is extended');
    console.log('- ✅ Old refresh token is invalidated');
    console.log('- ✅ New refresh token works for subsequent refreshes');
    console.log('- ✅ New access token works for protected routes');

  } catch (error) {
    console.error('\n❌ TEST FAILED');
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }
    process.exit(1);
  } finally {
    // Cleanup: Delete test user
    if (userId && pool) {
      try {
        console.log('\n🧹 Cleaning up test data...');
        await pool.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
        await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        console.log('✅ Test data cleaned up');
      } catch (error) {
        console.error('❌ Cleanup failed:', error.message);
      }
    }

    if (pool) {
      await pool.end();
    }
  }
}

// Run the test
runTest();

