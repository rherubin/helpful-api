const bcrypt = require('bcrypt');
const RefreshToken = require('../models/RefreshToken');

/**
 * Unit tests for RefreshToken hashing.
 *
 * The model pre-hashes JWT refresh tokens with SHA-256 before bcrypt so
 * tokens longer than bcrypt's 72-byte input limit still compare uniquely.
 * This suite uses an in-memory fake of mysql2's execute() contract — no
 * server and no database.
 *
 * Run: node tests/test-refresh-token-hashing.js
 */
class MockDatabase {
  constructor() {
    this.tokens = [];
  }

  async execute(sql, params = []) {
    const normalized = String(sql).replace(/\s+/g, ' ');

    if (normalized.includes('INSERT INTO refresh_tokens')) {
      const [id, userId, userType, token, expiresAt] = params;
      this.tokens.push({
        id,
        user_id: userId,
        user_type: userType,
        token,
        expires_at: expiresAt
      });
      return [{ affectedRows: 1 }];
    }

    if (
      normalized.includes('SELECT * FROM refresh_tokens')
      || normalized.includes('SELECT id, token FROM refresh_tokens')
    ) {
      const now = new Date();
      let rows = this.tokens.filter((row) => new Date(row.expires_at) > now);
      if (normalized.includes('user_id = ?')) {
        const userId = params[0];
        rows = rows.filter((row) => row.user_id === userId);
      }
      return [rows];
    }

    if (normalized.includes('DELETE FROM refresh_tokens WHERE id = ?')) {
      const id = params[0];
      const before = this.tokens.length;
      this.tokens = this.tokens.filter((row) => row.id !== id);
      return [{ affectedRows: before === this.tokens.length ? 0 : before - this.tokens.length }];
    }

    return [[]];
  }
}

class RefreshTokenHashingTestRunner {
  constructor() {
    this.testResults = { passed: 0, failed: 0, total: 0 };
  }

  log(message, type = 'info') {
    const prefix = {
      info: '📝', pass: '✅', fail: '❌', warn: '⚠️', section: '🧪'
    }[type] || '📝';
    console.log(`${prefix} [${new Date().toISOString()}] ${message}`);
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

  async run() {
    this.log('Refresh token hashing', 'section');
    this.testResults = { passed: 0, failed: 0, total: 0 };

    try {
      const mockDb = new MockDatabase();
      const model = new RefreshToken(mockDb);
      const userId = 'test-user-hashing';
      const plain = 'test-refresh-token-abc123';
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const tokenId = await model.createRefreshToken(userId, plain, expiresAt);
      this.assert(Boolean(tokenId), 'createRefreshToken returns an id', `id=${tokenId}`);

      const stored = mockDb.tokens[0];
      this.assert(stored && stored.token !== plain, 'Stored value is not the plaintext token');
      this.assert(
        stored && stored.token.startsWith('$2') && stored.token.length >= 60,
        'Stored value is a bcrypt hash',
        `len=${stored && stored.token.length}`
      );
      this.assert(stored.user_type === 'user', 'Default user_type is user', `type=${stored.user_type}`);
      this.assert(stored.user_id === userId, 'Stored row has the expected user_id');

      const retrieved = await model.getRefreshToken(plain);
      this.assert(Boolean(retrieved), 'getRefreshToken finds the plaintext token');
      this.assert(retrieved && retrieved.user_id === userId, 'Retrieved row belongs to the same user');
      this.assert(retrieved && retrieved.id === tokenId, 'Retrieved row has the created id');

      const scoped = await model.getRefreshToken(plain, userId);
      this.assert(scoped && scoped.id === tokenId, 'getRefreshToken scoped by userId still finds the token');

      let missing = false;
      try {
        await model.getRefreshToken(plain, 'some-other-user');
      } catch (error) {
        missing = error.message === 'Refresh token not found or expired';
      }
      this.assert(missing, 'getRefreshToken scoped to another user is rejected');

      let invalidRejected = false;
      try {
        await model.getRefreshToken('invalid-token');
      } catch (error) {
        invalidRejected = error.message === 'Refresh token not found or expired';
      }
      this.assert(invalidRejected, 'Unknown token is rejected');

      const deleted = await model.deleteRefreshToken(plain);
      this.assert(deleted === true, 'deleteRefreshToken returns true');
      this.assert(mockDb.tokens.length === 0, 'Deleted row is gone from storage');

      let deletedRejected = false;
      try {
        await model.getRefreshToken(plain);
      } catch (error) {
        deletedRejected = error.message === 'Refresh token not found or expired';
      }
      this.assert(deletedRejected, 'Deleted token is no longer retrievable');

      const hashed = await model.hashToken('direct-test-token-xyz789');
      this.assert(hashed.startsWith('$2') && hashed.length >= 60, 'hashToken returns a bcrypt hash');
      this.assert(await model.verifyToken('direct-test-token-xyz789', hashed), 'verifyToken accepts the matching token');
      this.assert(
        (await model.verifyToken('other-token', hashed)) === false,
        'verifyToken rejects a different token'
      );

      // Legacy rows hashed the raw token with bcrypt (no SHA-256 pre-hash).
      const legacyPlain = 'legacy-refresh-token';
      const legacyHash = await bcrypt.hash(legacyPlain, 12);
      this.assert(
        await model.verifyToken(legacyPlain, legacyHash),
        'verifyToken still accepts a pre-migration raw bcrypt hash'
      );

      // bcrypt only uses the first 72 bytes; two long tokens that share that
      // prefix must not collide after the SHA-256 pre-hash.
      const prefix = 'A'.repeat(80);
      const longA = `${prefix}token-A`;
      const longB = `${prefix}token-B`;
      const hashA = await model.hashToken(longA);
      this.assert(await model.verifyToken(longA, hashA), 'Long token verifies against its own hash');
      this.assert(
        (await model.verifyToken(longB, hashA)) === false,
        'A long token that shares the first 72 bytes does not collide'
      );
    } catch (error) {
      this.assert(false, 'Refresh token hashing suite crashed', error.stack || error.message);
    }

    const success = this.testResults.failed === 0;
    this.log(
      `Refresh token hashing: ${this.testResults.passed}/${this.testResults.total} passed, ${this.testResults.failed} failed`,
      success ? 'pass' : 'fail'
    );
    return success;
  }
}

async function testRefreshTokenHashing() {
  const runner = new RefreshTokenHashingTestRunner();
  return runner.run();
}

if (require.main === module) {
  testRefreshTokenHashing().then((success) => process.exit(success ? 0 : 1));
}

module.exports = RefreshTokenHashingTestRunner;
module.exports.testRefreshTokenHashing = testRefreshTokenHashing;
