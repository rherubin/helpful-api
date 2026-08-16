/**
 * AdminAuthService refresh / login token-rotation unit tests.
 *
 * Pure unit tests — no HTTP server, no MySQL. Stubs the admin user model and
 * refresh-token model to assert:
 *   - verifyAndRefreshTokens revokes old admin tokens BEFORE issuing new ones
 *   - verifyAndRefreshTokens never calls the nonexistent deleteTokenByUserId
 *   - loginAdmin clears prior admin refresh tokens before issuing a new pair
 *
 * Run: node tests/admin-auth-refresh-test.js
 */

const jwt = require('jsonwebtoken');
const AdminAuthService = require('../services/AdminAuthService');

const JWT_SECRET = 'test-admin-auth-secret';
const JWT_REFRESH_SECRET = 'test-admin-refresh-secret';

class AdminAuthRefreshTestRunner {
  constructor() {
    this.testResults = { passed: 0, failed: 0, total: 0 };
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.JWT_REFRESH_SECRET = JWT_REFRESH_SECRET;
  }

  log(message, type = 'info') {
    const prefix = { info: '📝', pass: '✅', fail: '❌', section: '🧪' }[type] || '📝';
    console.log(`${prefix} ${message}`);
  }

  assert(condition, name, details = '') {
    this.testResults.total++;
    if (condition) {
      this.testResults.passed++;
      this.log(`${name} - PASSED ${details}`, 'pass');
    } else {
      this.testResults.failed++;
      this.log(`${name} - FAILED ${details}`, 'fail');
    }
  }

  buildRefreshModel() {
    const rows = [];
    return {
      rows,
      calls: { create: [], deleteByUserId: [], getRefreshToken: [], verifyToken: [] },
      async createRefreshToken(userId, token, expiresAt, userType = 'user') {
        this.calls.create.push({ userId, token, expiresAt, userType });
        rows.push({ user_id: userId, token: `hash:${token}`, user_type: userType, expires_at: expiresAt });
        return `tok-${rows.length}`;
      },
      async deleteRefreshTokensByUserId(userId, userType = 'user') {
        this.calls.deleteByUserId.push({ userId, userType });
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i].user_id === userId && rows[i].user_type === userType) {
            rows.splice(i, 1);
          }
        }
        return true;
      },
      async getRefreshToken(token, userId = null) {
        this.calls.getRefreshToken.push({ token, userId });
        const match = rows.find(r =>
          r.token === `hash:${token}` &&
          (!userId || r.user_id === userId) &&
          new Date(r.expires_at) > new Date()
        );
        if (!match) throw new Error('Refresh token not found or expired');
        return match;
      },
      async getTokenByUserId(userId, userType = 'user') {
        return rows.find(r => r.user_id === userId && r.user_type === userType) || null;
      },
      async verifyToken(token, hashedToken) {
        this.calls.verifyToken.push({ token, hashedToken });
        return hashedToken === `hash:${token}`;
      },
      // Intentionally absent: deleteTokenByUserId — the production bug called this.
    };
  }

  buildAdminUserModel(user) {
    return {
      async getAdminUserById(id) {
        if (id !== user.id) throw new Error('Admin user not found');
        return user;
      },
      async getAdminUserByEmail(email) {
        if (email !== user.email) throw new Error('Admin user not found');
        return user;
      },
      async verifyPassword() {
        return true;
      }
    };
  }

  async runRefreshRotationTests() {
    this.log('verifyAndRefreshTokens rotation', 'section');

    const user = { id: 'admin-1', email: 'admin@example.com' };
    const refreshModel = this.buildRefreshModel();
    const service = new AdminAuthService(this.buildAdminUserModel(user), refreshModel);

    // Seed an existing admin refresh token (as login would).
    const oldRefresh = jwt.sign(
      { id: user.id, email: user.email, type: 'admin' },
      JWT_REFRESH_SECRET,
      { expiresIn: 1209600 }
    );
    await refreshModel.createRefreshToken(
      user.id,
      oldRefresh,
      new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      'admin'
    );
    refreshModel.calls.create.length = 0; // only assert calls from refresh onward

    const result = await service.verifyAndRefreshTokens(null, oldRefresh);

    this.assert(!!result.access_token, 'Refresh returns access_token');
    this.assert(!!result.refresh_token, 'Refresh returns refresh_token');
    // JWT payloads are second-granularity, so the new refresh string may equal
    // the old one when rotation happens in the same second. Rotation is proven
    // by delete-then-create below and by the remaining DB row matching result.

    this.assert(
      refreshModel.calls.deleteByUserId.length === 1,
      'Deletes existing admin refresh tokens once',
      `calls=${refreshModel.calls.deleteByUserId.length}`
    );
    this.assert(
      refreshModel.calls.deleteByUserId[0].userId === user.id &&
        refreshModel.calls.deleteByUserId[0].userType === 'admin',
      'Delete is scoped to this admin user_type=admin'
    );

    const deleteIdx = 0;
    // createRefreshToken is invoked from issueTokensForAdminUser after delete
    this.assert(
      refreshModel.calls.create.length === 1,
      'Issues exactly one new refresh token row',
      `creates=${refreshModel.calls.create.length}`
    );

    // Ensure delete happened before create by checking row state: only the new token remains
    this.assert(
      refreshModel.rows.length === 1,
      'Exactly one admin refresh row remains after rotation',
      `rows=${refreshModel.rows.length}`
    );
    this.assert(
      refreshModel.rows[0].token === `hash:${result.refresh_token}`,
      'Remaining row matches the newly issued refresh token'
    );

    // Calling a nonexistent method would have thrown before returning — assert we returned.
    this.assert(
      typeof refreshModel.deleteTokenByUserId === 'undefined',
      'Stub still has no deleteTokenByUserId (guards against silently reintroducing the bug)'
    );

    // Order: delete must be recorded before create (array push order across methods —
    // we approximate by ensuring delete cleared the old hash and create added the new one).
    void deleteIdx;
  }

  async runLoginClearsPriorTokensTests() {
    this.log('loginAdmin clears prior refresh tokens', 'section');

    const user = { id: 'admin-2', email: 'admin2@example.com' };
    const refreshModel = this.buildRefreshModel();
    const service = new AdminAuthService(this.buildAdminUserModel(user), refreshModel);

    await refreshModel.createRefreshToken(
      user.id,
      'stale-refresh-token-aaaaaaaa',
      new Date(Date.now() + 86400000),
      'admin'
    );
    refreshModel.calls.deleteByUserId.length = 0;
    refreshModel.calls.create.length = 0;

    const result = await service.loginAdmin(user.email, 'any');

    this.assert(!!result.access_token && !!result.refresh_token, 'Login returns token pair');
    this.assert(
      refreshModel.calls.deleteByUserId.length === 1 &&
        refreshModel.calls.deleteByUserId[0].userType === 'admin',
      'Login deletes prior admin refresh tokens'
    );
    this.assert(
      refreshModel.rows.length === 1 &&
        refreshModel.rows[0].token === `hash:${result.refresh_token}`,
      'Only the login-issued refresh token remains'
    );
  }

  async runExpiresInSecondsCoercionTest() {
    this.log('Admin JWT expiresIn uses seconds (not ms) when env is a string', 'section');

    const prevAccess = process.env.JWT_ACCESS_TOKEN_EXPIRES_IN_SECONDS;
    const prevRefresh = process.env.JWT_REFRESH_TOKEN_EXPIRES_IN_SECONDS;
    process.env.JWT_ACCESS_TOKEN_EXPIRES_IN_SECONDS = '86400';
    process.env.JWT_REFRESH_TOKEN_EXPIRES_IN_SECONDS = '1209600';

    try {
      const user = { id: 'admin-exp', email: 'adminexp@example.com' };
      const refreshModel = this.buildRefreshModel();
      const service = new AdminAuthService(this.buildAdminUserModel(user), refreshModel);
      const access = service.generateAccessToken(user);
      const refresh = service.generateRefreshToken(user);
      const accessDecoded = jwt.decode(access);
      const refreshDecoded = jwt.decode(refresh);
      const accessTtl = accessDecoded.exp - accessDecoded.iat;
      const refreshTtl = refreshDecoded.exp - refreshDecoded.iat;

      // String "86400" without Number() would be ~86s (ms). Expect ~86400s.
      this.assert(
        accessTtl >= 86000 && accessTtl <= 87000,
        'Access token TTL is ~86400 seconds when env is numeric string',
        `ttl=${accessTtl}`
      );
      this.assert(
        refreshTtl >= 1200000 && refreshTtl <= 1210000,
        'Refresh token TTL is ~1209600 seconds when env is numeric string',
        `ttl=${refreshTtl}`
      );
    } finally {
      if (prevAccess === undefined) delete process.env.JWT_ACCESS_TOKEN_EXPIRES_IN_SECONDS;
      else process.env.JWT_ACCESS_TOKEN_EXPIRES_IN_SECONDS = prevAccess;
      if (prevRefresh === undefined) delete process.env.JWT_REFRESH_TOKEN_EXPIRES_IN_SECONDS;
      else process.env.JWT_REFRESH_TOKEN_EXPIRES_IN_SECONDS = prevRefresh;
    }
  }

  async runAllTests() {
    this.log('Starting AdminAuthService refresh unit tests', 'section');
    try {
      await this.runRefreshRotationTests();
      await this.runLoginClearsPriorTokensTests();
      await this.runExpiresInSecondsCoercionTest();
    } catch (error) {
      this.log(`Unexpected suite error: ${error.stack || error.message}`, 'fail');
      this.testResults.failed++;
      this.testResults.total++;
    }

    const { passed, failed, total } = this.testResults;
    console.log('\n============================================================');
    this.log(`Total: ${total}  Passed: ${passed}  Failed: ${failed}`);
    console.log('============================================================');
    return failed === 0;
  }
}

if (require.main === module) {
  const runner = new AdminAuthRefreshTestRunner();
  runner.runAllTests()
    .then(ok => process.exit(ok ? 0 : 1))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = AdminAuthRefreshTestRunner;
