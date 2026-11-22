'use strict';

/**
 * Unit tests for production JWT-secret and TEST_MOCK_* guards.
 * Does not start a server or touch the database.
 *
 * Run with: node tests/runtime-env-test.js
 */

const runtimeEnv = require('../config/runtimeEnv');
const { sslRejectUnauthorized, mysqlAuthPlugins } = require('../config/database');

class RuntimeEnvTestRunner {
  constructor() {
    this.testResults = { passed: 0, failed: 0, total: 0 };
  }

  log(message, type = 'info') {
    const prefix = { info: '📝', pass: '✅', fail: '❌', warn: '⚠️', section: '🧪' }[type] || '📝';
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

  withEnv(overrides, fn) {
    const keys = Object.keys(overrides);
    const previous = {};
    for (const key of keys) {
      previous[key] = Object.prototype.hasOwnProperty.call(process.env, key)
        ? process.env[key]
        : undefined;
      if (overrides[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = overrides[key];
      }
    }
    try {
      return fn();
    } finally {
      for (const key of keys) {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      }
    }
  }

  async run() {
    this.log('Runtime env / production-guard unit tests', 'section');

    this.withEnv({
      NODE_ENV: 'test',
      RAILWAY_ENVIRONMENT: undefined,
      RAILWAY_ENVIRONMENT_NAME: undefined,
      RAILWAY_PROJECT_ID: undefined,
      RAILWAY_ENVIRONMENT_ID: undefined,
    }, () => {
      this.assert(runtimeEnv.isTestEnv() === true, 'NODE_ENV=test is a test env');
      this.assert(runtimeEnv.isProductionEnv() === false, 'NODE_ENV=test is not production');
      this.assert(runtimeEnv.mustRequireSecureJwtSecrets() === false, 'Test env does not require JWT secrets');
    });

    this.withEnv({
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT: undefined,
      RAILWAY_ENVIRONMENT_NAME: undefined,
    }, () => {
      this.assert(runtimeEnv.isProductionEnv() === true, 'NODE_ENV=production is production');
      this.assert(runtimeEnv.mustRequireSecureJwtSecrets() === true, 'Production requires JWT secrets');
    });

    this.withEnv({
      NODE_ENV: 'development',
      RAILWAY_ENVIRONMENT_NAME: 'production',
      RAILWAY_ENVIRONMENT: undefined,
      RAILWAY_PROJECT_ID: undefined,
    }, () => {
      this.assert(runtimeEnv.isProductionEnv() === true, 'RAILWAY_ENVIRONMENT_NAME=production is production');
      this.assert(runtimeEnv.mustRequireSecureJwtSecrets() === true, 'Railway production requires JWT secrets');
    });

    this.withEnv({
      NODE_ENV: 'development',
      RAILWAY_ENVIRONMENT: 'develop',
      RAILWAY_ENVIRONMENT_NAME: undefined,
      RAILWAY_PROJECT_ID: undefined,
      RAILWAY_ENVIRONMENT_ID: undefined,
    }, () => {
      this.assert(runtimeEnv.isProductionEnv() === false, 'Railway develop is not production');
      this.assert(runtimeEnv.isRailwayEnv() === true, 'RAILWAY_ENVIRONMENT=develop is a Railway env');
      this.assert(runtimeEnv.mustRequireSecureJwtSecrets() === true, 'Railway develop still requires JWT secrets');
    });

    this.withEnv({
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT_NAME: 'develop',
      RAILWAY_ENVIRONMENT: 'develop',
      TEST_MOCK_IAP: 'true',
    }, () => {
      this.assert(runtimeEnv.isProductionEnv() === false, 'NODE_ENV=production on Railway develop is not production');
      this.assert(runtimeEnv.isMockFlagEnabled('TEST_MOCK_IAP') === true, 'TEST_MOCK_IAP works on Railway develop');
      this.assert(runtimeEnv.mustRequireSecureJwtSecrets() === true, 'Railway develop still requires JWT secrets when NODE_ENV=production');
    });

    this.withEnv({
      NODE_ENV: 'development',
      RAILWAY_ENVIRONMENT: undefined,
      RAILWAY_ENVIRONMENT_NAME: undefined,
      RAILWAY_PROJECT_ID: undefined,
      RAILWAY_ENVIRONMENT_ID: undefined,
    }, () => {
      this.assert(runtimeEnv.mustRequireSecureJwtSecrets() === false, 'Local development does not hard-require JWT secrets');
    });

    this.withEnv({
      JWT_SECRET: 'your-secret-key-change-in-production',
      JWT_REFRESH_SECRET: 'your-refresh-secret-key-change-in-production',
    }, () => {
      this.assert(runtimeEnv.jwtSecretsAreInsecure() === true, 'Documented placeholders are treated as insecure');
    });

    this.withEnv({
      JWT_SECRET: undefined,
      JWT_REFRESH_SECRET: undefined,
    }, () => {
      this.assert(runtimeEnv.jwtSecretsAreInsecure() === true, 'Missing JWT secrets are treated as insecure');
    });

    this.withEnv({
      JWT_SECRET: 'a-real-long-random-access-secret',
      JWT_REFRESH_SECRET: 'a-real-long-random-refresh-secret',
    }, () => {
      this.assert(runtimeEnv.jwtSecretsAreInsecure() === false, 'Non-placeholder secrets are accepted');
    });

    this.withEnv({
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT: undefined,
      RAILWAY_ENVIRONMENT_NAME: undefined,
      TEST_MOCK_IAP: 'true',
      TEST_MOCK_STRIPE: 'true',
      TEST_MOCK_LLM: 'true',
      TEST_MOCK_PUSH: 'true',
      ALLOW_ADMIN_REGISTRATION: 'true',
    }, () => {
      this.assert(runtimeEnv.isMockFlagEnabled('TEST_MOCK_IAP') === false, 'TEST_MOCK_IAP is ignored in production');
      this.assert(runtimeEnv.isMockFlagEnabled('TEST_MOCK_STRIPE') === false, 'TEST_MOCK_STRIPE is ignored in production');
      this.assert(runtimeEnv.isMockFlagEnabled('TEST_MOCK_LLM') === false, 'TEST_MOCK_LLM is ignored in production');
      this.assert(runtimeEnv.isMockFlagEnabled('TEST_MOCK_PUSH') === false, 'TEST_MOCK_PUSH is ignored in production');
    });

    this.withEnv({
      NODE_ENV: 'development',
      RAILWAY_ENVIRONMENT: undefined,
      RAILWAY_ENVIRONMENT_NAME: undefined,
      TEST_MOCK_IAP: 'true',
    }, () => {
      this.assert(runtimeEnv.isMockFlagEnabled('TEST_MOCK_IAP') === true, 'TEST_MOCK_IAP works outside production');
    });

    this.withEnv({
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT: 'production',
      JWT_SECRET: 'your-secret-key-change-in-production',
      JWT_REFRESH_SECRET: 'not-a-placeholder-refresh',
    }, () => {
      const originalExit = process.exit;
      let exitCode = null;
      process.exit = (code) => {
        exitCode = code;
        throw new Error(`process.exit(${code})`);
      };
      try {
        runtimeEnv.assertJwtSecretsForCurrentEnv();
        this.assert(false, 'Production placeholder JWT secrets cause process.exit', 'assert did not exit');
      } catch (err) {
        this.assert(exitCode === 1, 'Production placeholder JWT secrets exit with code 1', `exitCode=${exitCode} err=${err.message}`);
      } finally {
        process.exit = originalExit;
      }
    });

    this.withEnv({ MYSQL_SSL_REJECT_UNAUTHORIZED: undefined }, () => {
      this.assert(sslRejectUnauthorized() === false, 'MYSQL_SSL_REJECT_UNAUTHORIZED defaults to false');
    });
    this.withEnv({ MYSQL_SSL_REJECT_UNAUTHORIZED: 'true' }, () => {
      this.assert(sslRejectUnauthorized() === true, 'MYSQL_SSL_REJECT_UNAUTHORIZED=true enables verification');
    });
    this.withEnv({ MYSQL_SSL_REJECT_UNAUTHORIZED: 'false' }, () => {
      this.assert(sslRejectUnauthorized() === false, 'MYSQL_SSL_REJECT_UNAUTHORIZED=false disables verification');
    });

    try {
      mysqlAuthPlugins().mysql_clear_password()();
      this.assert(false, 'mysql_clear_password plugin is disabled', 'plugin did not throw');
    } catch (err) {
      this.assert(
        /mysql_clear_password authentication is disabled/.test(err.message),
        'mysql_clear_password plugin is disabled',
        err.message
      );
    }

    const success = this.testResults.failed === 0;
    this.log(
      `Runtime env tests: ${this.testResults.passed}/${this.testResults.total} passed`,
      success ? 'pass' : 'fail'
    );
    return success;
  }
}

module.exports = RuntimeEnvTestRunner;

if (require.main === module) {
  new RuntimeEnvTestRunner().run().then((ok) => {
    process.exit(ok ? 0 : 1);
  });
}
