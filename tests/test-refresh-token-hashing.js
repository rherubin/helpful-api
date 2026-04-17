const RefreshToken = require('../models/RefreshToken');
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

  let failed = 0;
  const assertStep = (label, condition) => {
    if (condition) {
      console.log(`✅ ${label}`);
    } else {
      console.log(`❌ ${label}`);
      failed++;
    }
  };

  try {
    const mockDb = new MockDatabase();
    const refreshTokenModel = new RefreshToken(mockDb);

    const testUserId = 'test-user-123';
    const testToken = 'test-refresh-token-abc123';
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    console.log('🧪 Step 1: Creating refresh token...');
    const tokenId = await refreshTokenModel.createRefreshToken(testUserId, testToken, expiresAt);
    assertStep(`Token created with ID: ${tokenId}`, Boolean(tokenId));

    const storedToken = mockDb.tokens[0];
    assertStep('Token is hashed (not plain text)', storedToken.token !== testToken);
    assertStep(`Token length > 60 (bcrypt) — got ${storedToken.token.length}`, storedToken.token.length > 60);

    console.log('🧪 Step 2: Retrieving refresh token...');
    const retrievedToken = await refreshTokenModel.getRefreshToken(testToken);
    assertStep('Token retrieved', Boolean(retrievedToken));

    if (retrievedToken) {
      assertStep('User ID matches', retrievedToken.user_id === testUserId);
      assertStep('Token remains hashed in DB', retrievedToken.token.length > 60);
    }

    console.log('🧪 Step 3: Testing invalid token...');
    let invalidRejected = false;
    try {
      await refreshTokenModel.getRefreshToken('invalid-token');
    } catch (error) {
      invalidRejected = true;
    }
    assertStep('Invalid token rejected', invalidRejected);

    console.log('🧪 Step 4: Testing token deletion...');
    const deleted = await refreshTokenModel.deleteRefreshToken(testToken);
    assertStep('Token deleted', deleted);

    console.log('🧪 Step 5: Verifying token was deleted...');
    let deletedRejected = false;
    try {
      await refreshTokenModel.getRefreshToken(testToken);
    } catch (error) {
      deletedRejected = true;
    }
    assertStep('Deleted token no longer retrievable', deletedRejected);

    console.log('🧪 Step 6: Testing bcrypt hashing directly...');
    const originalToken = 'direct-test-token-xyz789';
    const hashed = await refreshTokenModel.hashToken(originalToken);
    const isValid = await refreshTokenModel.verifyToken(originalToken, hashed);
    assertStep(`Hash created successfully (length ${hashed.length})`, hashed.length > 60);
    assertStep('Verification works', isValid);

    if (failed === 0) {
      console.log('\n🎉 All refresh token hashing tests passed!');
    } else {
      console.log(`\n❌ ${failed} assertion(s) failed.`);
    }
  } catch (error) {
    console.error('❌ Test threw an error:', error.message);
    console.error(error.stack);
    failed++;
  }

  return failed === 0;
}

if (require.main === module) {
  testRefreshTokenHashing().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = testRefreshTokenHashing;
