const { SubscriptionService, SubscriptionError } = require('../services/SubscriptionService');

/**
 * Recycled Xcode / Sandbox transaction ids (0, 1, 2…) on a non-production server.
 * No server, database, or Apple credentials. Run with:
 *   node tests/subscription-sandbox-reuse-test.js
 */
class SubscriptionSandboxReuseTestRunner {
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

  async withEnv(overrides, fn) {
    const previous = {};
    for (const key of Object.keys(overrides)) {
      previous[key] = process.env[key];
      const value = overrides[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      return await fn();
    } finally {
      for (const key of Object.keys(overrides)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  }

  memoryIos(rows = []) {
    return {
      rows,
      async getByTransactionId(transactionId) {
        return this.rows.find((row) => row.transaction_id === transactionId) || null;
      },
      async getByOriginalTransactionId(originalTransactionId) {
        return this.rows.find((row) => row.original_transaction_id === originalTransactionId) || null;
      },
      async upsertSubscription(userId, data, { reassignUser = false } = {}) {
        const existing = this.rows.find((row) => row.transaction_id === data.transaction_id);
        if (existing) {
          if (reassignUser) existing.user_id = userId;
          Object.assign(existing, {
            product_id: data.product_id,
            original_transaction_id: data.original_transaction_id,
            jws_receipt: data.jws_receipt,
            environment: data.environment,
            purchase_date: data.purchase_date,
            expiration_date: data.expiration_date
          });
          return { ...existing, updated: true };
        }
        const created = {
          id: `row-${this.rows.length + 1}`,
          user_id: userId,
          ...data,
          created: true
        };
        this.rows.push(created);
        return created;
      },
      async hasActiveSubscription(userId) {
        return this.rows.some((row) => row.user_id === userId && row.expiration_date > Date.now());
      }
    };
  }

  service(ios, pairings) {
    return new SubscriptionService(
      ios,
      { hasActiveSubscription: async () => false },
      null,
      pairings,
      null,
      null
    );
  }

  pairings() {
    return {
      updates: [],
      async getAcceptedPairings(userId) {
        return [{ id: `pairing-${userId}`, user1_id: userId, user2_id: null }];
      },
      async setPremiumStatus(id, premium) {
        this.updates.push({ id, premium });
      }
    };
  }

  payload(overrides = {}) {
    const now = Date.now();
    return {
      platform: 'ios',
      product_id: 'com.helpful.yearly.29.99',
      transaction_id: '0',
      original_transaction_id: '0',
      jws_receipt: 'xcode-local-receipt',
      environment: 'Sandbox',
      purchase_date: now - 1000,
      expiration_date: now + (24 * 60 * 60 * 1000),
      ...overrides
    };
  }

  stuckRow(overrides = {}) {
    const now = Date.now();
    return {
      id: 'stuck-0',
      user_id: 'user-a',
      product_id: 'com.helpful.yearly.29.99',
      transaction_id: '0',
      original_transaction_id: '0',
      jws_receipt: 'previous-tester',
      environment: 'Production',
      purchase_date: now - 2000,
      expiration_date: now + (24 * 60 * 60 * 1000),
      ...overrides
    };
  }

  async submit(env, { environment = 'Sandbox', owner = 'user-a', caller = 'user-b' } = {}) {
    const ios = this.memoryIos([this.stuckRow()]);
    const pairings = this.pairings();
    const subscriptionService = this.service(ios, pairings);
    let error = null;
    let result = null;
    await this.withEnv({
      TEST_MOCK_IAP: 'true',
      NODE_ENV: env.NODE_ENV,
      RAILWAY_ENVIRONMENT_NAME: env.RAILWAY_ENVIRONMENT_NAME,
      RAILWAY_ENVIRONMENT: env.RAILWAY_ENVIRONMENT
    }, async () => {
      try {
        result = await subscriptionService.processReceipt(caller, this.payload({ environment }));
      } catch (err) {
        error = err;
      }
    });
    return { ios, pairings, result, error, owner };
  }

  async testDevelopSandboxReassignsRecycledId() {
    this.log('🧪 Sandbox receipt on develop reassigns transaction 0', 'section');
    const { ios, pairings, result, error } = await this.submit({
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT_NAME: 'develop',
      RAILWAY_ENVIRONMENT: 'develop'
    });

    this.assert(!error, 'Develop Sandbox reuse does not 409', error ? error.message : '');
    this.assert(
      result && result.subscription.user_id === 'user-b' && ios.rows[0].user_id === 'user-b',
      'Develop Sandbox reuse moves transaction 0 onto the caller',
      `user_id=${ios.rows[0].user_id}`
    );
    this.assert(
      ios.rows[0].environment === 'Sandbox',
      'Reassigned row records the incoming Sandbox environment'
    );
    this.assert(
      pairings.updates.some((update) => update.id === 'pairing-user-a' && update.premium === false)
        && pairings.updates.some((update) => update.id === 'pairing-user-b' && update.premium === true),
      'Previous owner loses premium and the caller gains it',
      JSON.stringify(pairings.updates)
    );
  }

  async testProductionSandboxStillConflicts() {
    this.log('🧪 Sandbox receipt on production still 409s', 'section');
    const { ios, error } = await this.submit({
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT_NAME: 'production',
      RAILWAY_ENVIRONMENT: 'production'
    });

    this.assert(
      error instanceof SubscriptionError && error.statusCode === 409,
      'Production keeps the cross-user Sandbox rejection',
      error && `${error.statusCode} ${error.message}`
    );
    this.assert(ios.rows[0].user_id === 'user-a', 'Production does not move the receipt');
  }

  async testDevelopProductionReceiptStillConflicts() {
    this.log('🧪 Production receipt on develop still 409s', 'section');
    const { ios, error } = await this.submit(
      {
        NODE_ENV: 'production',
        RAILWAY_ENVIRONMENT_NAME: 'develop',
        RAILWAY_ENVIRONMENT: 'develop'
      },
      { environment: 'Production' }
    );

    this.assert(
      error instanceof SubscriptionError && error.statusCode === 409,
      'Develop still rejects a reused Production receipt',
      error && `${error.statusCode} ${error.message}`
    );
    this.assert(ios.rows[0].user_id === 'user-a', 'A Production receipt is not reassigned on develop');
  }

  async testNodeProductionWithoutRailwayStaysClosed() {
    this.log('🧪 NODE_ENV=production without Railway stays closed', 'section');
    const { ios, error } = await this.submit({
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT_NAME: undefined,
      RAILWAY_ENVIRONMENT: undefined
    });

    this.assert(
      error instanceof SubscriptionError && error.statusCode === 409,
      'Missing Railway name does not open Sandbox reuse when NODE_ENV=production',
      error && `${error.statusCode} ${error.message}`
    );
    this.assert(ios.rows[0].user_id === 'user-a', 'Closed path leaves the row with its owner');
  }

  async testLocalDevelopmentReassigns() {
    this.log('🧪 Local development reassigns a Sandbox transaction 0', 'section');
    const { ios, error } = await this.submit({
      NODE_ENV: 'development',
      RAILWAY_ENVIRONMENT_NAME: undefined,
      RAILWAY_ENVIRONMENT: undefined
    });

    this.assert(!error, 'Local development Sandbox reuse does not 409', error ? error.message : '');
    this.assert(
      ios.rows[0].user_id === 'user-b',
      'Local development moves transaction 0 onto the caller',
      `user_id=${ios.rows[0].user_id}`
    );
  }

  async testSameUserUpdateStaysPut() {
    this.log('🧪 Same user resubmitting Sandbox on develop', 'section');
    const { ios, pairings, error } = await this.submit(
      {
        NODE_ENV: 'production',
        RAILWAY_ENVIRONMENT_NAME: 'develop',
        RAILWAY_ENVIRONMENT: 'develop'
      },
      { caller: 'user-a' }
    );

    this.assert(!error, 'Owner resubmitting transaction 0 succeeds', error ? error.message : '');
    this.assert(ios.rows[0].user_id === 'user-a', 'Resubmit keeps the same owner');
    this.assert(
      !pairings.updates.some((update) => update.id === 'pairing-user-a' && update.premium === false),
      'Resubmit does not clear the owner\'s premium',
      JSON.stringify(pairings.updates)
    );
  }

  async run() {
    this.log('🍎 Starting recycled Sandbox receipt tests', 'section');
    try {
      await this.testDevelopSandboxReassignsRecycledId();
      await this.testProductionSandboxStillConflicts();
      await this.testDevelopProductionReceiptStillConflicts();
      await this.testNodeProductionWithoutRailwayStaysClosed();
      await this.testLocalDevelopmentReassigns();
      await this.testSameUserUpdateStaysPut();
    } catch (error) {
      this.log(`Unexpected failure: ${error.stack}`, 'fail');
      this.testResults.failed++;
      this.testResults.total++;
    }

    this.log(
      `Recycled Sandbox receipt tests: ${this.testResults.passed}/${this.testResults.total} passed`,
      this.testResults.failed === 0 ? 'pass' : 'fail'
    );
    return this.testResults.failed === 0;
  }
}

module.exports = SubscriptionSandboxReuseTestRunner;

if (require.main === module) {
  const runner = new SubscriptionSandboxReuseTestRunner();
  runner.run().then((success) => process.exit(success ? 0 : 1));
}
