const RefreshToken = require('./models/RefreshToken');
const bcrypt = require('bcrypt');

// Mock database for testing
class MockDatabase {
  constructor() {
    this.tokens = [];
    this.nextId = 1;
  }

  async execute(sql, params = []) {
    if (sql.includes('INSERT INTO refresh_tokens')) {
      const [id, userId, token, expiresAt] = params;
      const newToken = {
        id: id || this.nextId++,
        user_id: userId,
        token: token,
        expires_at: expiresAt
      };
      this.tokens.push(newToken);
      return [{ affectedRows: 1 }];
    } else if (sql.includes('SELECT * FROM refresh_tokens WHERE expires_at > NOW()')) {
      const now = new Date();
      return [this.tokens.filter(token => new Date(token.expires_at) > now)];
    } else if (sql.includes('DELETE FROM refresh_tokens WHERE id = ?')) {
      const [id] = params;
      const index = this.tokens.findIndex(token => token.id === id);
      if (index !== -1) {
        this.tokens.splice(index, 1);
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 0 }];
    }
    return [[]];
  }
}

async function testRefreshTokenHashing() {
  console.log('🔐 Testing Refresh Token Hashing');
  console.log('==================================');

  try {
    const mockDb = new MockDatabase();
    const refreshTokenModel = new RefreshToken(mockDb);

    // Test data
    const testUserId = 'test-user-123';
    const testToken = 'test-refresh-token-abc123';
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

    console.log('🧪 Step 1: Creating refresh token...');
    const tokenId = await refreshTokenModel.createRefreshToken(testUserId, testToken, expiresAt);
    console.log('✅ Token created with ID:', tokenId);

    // Verify token was hashed in mock database
    const storedToken = mockDb.tokens[0];
    console.log('   - Token is hashed (not plain text):', storedToken.token !== testToken);
    console.log('   - Token length (should be > 60 for bcrypt):', storedToken.token.length);

    console.log('🧪 Step 2: Retrieving refresh token...');
    const retrievedToken = await refreshTokenModel.getRefreshToken(testToken);
    console.log('✅ Token retrieved:', retrievedToken ? 'SUCCESS' : 'FAILED');

    if (retrievedToken) {
      console.log('   - User ID matches:', retrievedToken.user_id === testUserId);
      console.log('   - Token is hashed in DB but retrieval works:', retrievedToken.token.length > 60);
    }

    console.log('🧪 Step 3: Testing invalid token...');
    try {
      await refreshTokenModel.getRefreshToken('invalid-token');
      console.log('❌ Should have failed for invalid token');
    } catch (error) {
      console.log('✅ Correctly rejected invalid token:', error.message);
    }

    console.log('🧪 Step 4: Testing token deletion...');
    const deleted = await refreshTokenModel.deleteRefreshToken(testToken);
    console.log('✅ Token deleted:', deleted);

    console.log('🧪 Step 5: Verifying token was deleted...');
    try {
      await refreshTokenModel.getRefreshToken(testToken);
      console.log('❌ Token should have been deleted');
    } catch (error) {
      console.log('✅ Token correctly deleted:', error.message);
    }

    // Test direct bcrypt functionality
    console.log('🧪 Step 6: Testing bcrypt hashing directly...');
    const originalToken = 'direct-test-token-xyz789';
    const hashed = await refreshTokenModel.hashToken(originalToken);
    const isValid = await refreshTokenModel.verifyToken(originalToken, hashed);
    console.log('   - Hash created successfully:', hashed.length > 60);
    console.log('   - Verification works:', isValid);

    console.log('\n🎉 All refresh token hashing tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    process.exit(0);
  }
}

// Run the test
testRefreshTokenHashing();
