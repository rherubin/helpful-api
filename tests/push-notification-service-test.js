/**
 * PushNotificationService Unit Test Suite
 *
 * Pure unit tests for services/PushNotificationService.js. These tests
 * never load firebase-admin and never touch the database — both
 * dependencies are injected as fakes via the constructor:
 *   - `messagingClient`     stand-in for admin.messaging()
 *   - `deviceTokenModel`    stand-in for models/DeviceToken.js
 *
 * Coverage:
 *   - Construction without messaging client (not configured) and with one (configured)
 *   - sendToTokens: empty/invalid input handling, payload validation
 *   - sendToTokens: success counts, deduplication, FCM error code → invalidTokens
 *   - sendToTokens: chunking past the FCM 500-token cap
 *   - sendToTokens: FCM throw handling (entire chunk counted as failed)
 *   - sendToUser: looks up tokens via the model, sends, prunes invalid
 *   - sendToUser: no-op when user has no devices
 *   - sendToUsers: aggregates across multiple users
 *   - Payload builder: data coercion to strings, APNs (badge/sound), Android (priority/channel)
 *   - When not configured every send returns { skipped: true } and never calls FCM
 *
 * Run with: node tests/push-notification-service-test.js
 */

const PushNotificationService = require('../services/PushNotificationService');

// ─────────────────────────────────────────────────────────────────────────
// Test doubles
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a fake messaging client that records every call and returns either:
 *   - a default "all success" response, or
 *   - a queued response from `client.__queue`.
 * Tests can also override behavior by replacing `client.sendEachForMulticast`.
 */
function buildFakeMessaging() {
  const client = {
    __sentCalls: [],
    __queue: [],
    sendEachForMulticast: async (message) => {
      client.__sentCalls.push(message);
      if (client.__queue.length > 0) {
        const queued = client.__queue.shift();
        if (typeof queued === 'function') return queued(message);
        return queued;
      }
      return {
        successCount: message.tokens.length,
        failureCount: 0,
        responses: message.tokens.map(() => ({
          success: true,
          messageId: 'mock-msg-id'
        }))
      };
    }
  };
  return client;
}

/**
 * Build a fake DeviceToken model that lets each test seed per-user token
 * lists and records every prune-by-string call.
 */
function buildFakeDeviceTokenModel(seed = {}) {
  const userIdToTokens = new Map(Object.entries(seed));
  return {
    __removedTokens: [],
    async getUserDeviceTokensWithStrings(userId) {
      const tokens = userIdToTokens.get(userId) || [];
      return tokens.map((tok, idx) => ({
        id: `rec-${userId}-${idx}`,
        user_id: userId,
        device_token: tok,
        platform: 'ios',
        created_at: new Date(),
        updated_at: new Date()
      }));
    },
    async getDeviceTokensForUsers(userIds) {
      const out = [];
      for (const id of userIds) {
        const rs = await this.getUserDeviceTokensWithStrings(id);
        out.push(...rs);
      }
      return out;
    },
    async removeDeviceTokenByString(tokenString) {
      this.__removedTokens.push(tokenString);
      let removed = 0;
      for (const [uid, tokens] of userIdToTokens.entries()) {
        const next = tokens.filter(t => t !== tokenString);
        if (next.length !== tokens.length) {
          removed += tokens.length - next.length;
          userIdToTokens.set(uid, next);
        }
      }
      return removed;
    }
  };
}

/** Suppresses noisy log output during tests but keeps a captured trace. */
function buildSilentLogger() {
  const logger = {
    __log: [],
    log:   (...args) => logger.__log.push(['log',   args.join(' ')]),
    warn:  (...args) => logger.__log.push(['warn',  args.join(' ')]),
    error: (...args) => logger.__log.push(['error', args.join(' ')])
  };
  return logger;
}

function deadTokenError() {
  return { code: 'messaging/registration-token-not-registered', message: 'Token unregistered' };
}

function transientError() {
  return { code: 'messaging/server-unavailable', message: 'Try again later' };
}

// ─────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────

class PushNotificationServiceTestRunner {
  constructor() {
    this.testResults = { passed: 0, failed: 0, total: 0 };
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = { info: '📝', pass: '✅', fail: '❌', warn: '⚠️', section: '📲' }[type] || '📝';
    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  assert(condition, name, detail) {
    this.testResults.total++;
    if (condition) {
      this.testResults.passed++;
      this.log(`${name} - PASSED${detail ? ' — ' + detail : ''}`, 'pass');
    } else {
      this.testResults.failed++;
      this.log(`${name} - FAILED${detail ? ' — ' + detail : ''}`, 'fail');
    }
  }

  buildService(modelSeed = {}) {
    const messaging = buildFakeMessaging();
    const model = buildFakeDeviceTokenModel(modelSeed);
    const logger = buildSilentLogger();
    const service = new PushNotificationService({
      deviceTokenModel: model,
      messagingClient: messaging,
      logger
    });
    return { service, messaging, model, logger };
  }

  // ───────────────────────────────────────────────────────────────────
  // Construction
  // ───────────────────────────────────────────────────────────────────
  async runConstructionTests() {
    this.log('Construction', 'section');

    // Throws if no model passed
    let threw = false;
    try {
      new PushNotificationService({});
    } catch (err) {
      threw = err && /deviceTokenModel/.test(err.message);
    }
    this.assert(threw, 'Constructor throws when deviceTokenModel is missing');

    // Configured when messagingClient is injected
    const { service } = this.buildService();
    this.assert(service.isConfigured() === true, 'isConfigured() === true with injected messagingClient');
    this.assert(service.isMockMode() === true, 'isMockMode() === true with injected messagingClient');

    // Not configured when no messagingClient AND no env credentials AND no TEST_MOCK_PUSH
    const previousMockEnv = process.env.TEST_MOCK_PUSH;
    const previousJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const previousPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    delete process.env.TEST_MOCK_PUSH;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    try {
      const unconfigured = new PushNotificationService({
        deviceTokenModel: buildFakeDeviceTokenModel(),
        logger: buildSilentLogger()
      });
      this.assert(
        unconfigured.isConfigured() === false,
        'isConfigured() === false when no client/credentials/env-mock present'
      );
    } finally {
      if (previousMockEnv !== undefined) process.env.TEST_MOCK_PUSH = previousMockEnv;
      if (previousJson !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previousJson;
      if (previousPath !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT_PATH = previousPath;
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // sendToTokens — input handling
  // ───────────────────────────────────────────────────────────────────
  async runSendToTokensInputTests() {
    this.log('sendToTokens — input validation', 'section');
    const { service, messaging } = this.buildService();

    // Empty token array
    const empty = await service.sendToTokens([], { title: 't', body: 'b' });
    this.assert(empty.successCount === 0 && empty.failureCount === 0, 'Empty tokens array → no-op');
    this.assert(messaging.__sentCalls.length === 0, 'Empty tokens array → FCM not called');

    // Non-array
    const nonArray = await service.sendToTokens('not-an-array', { title: 't', body: 'b' });
    this.assert(nonArray.successCount === 0 && nonArray.failureCount === 0, 'Non-array tokens → no-op');

    // Missing payload
    let threw = false;
    try { await service.sendToTokens(['tok-1'], null); } catch (e) { threw = true; }
    this.assert(threw, 'Missing payload throws');

    // Empty payload (no title, body, or data)
    threw = false;
    try { await service.sendToTokens(['tok-1'], {}); } catch (e) { threw = true; }
    this.assert(threw, 'Empty payload (no title/body/data) throws');

    // Payload with only data (no title/body) is allowed (silent data push)
    const onlyData = await service.sendToTokens(['tok-only-data-12345'], { data: { kind: 'silent' } });
    this.assert(onlyData.successCount === 1, 'Payload with only data is allowed (silent push)');
  }

  // ───────────────────────────────────────────────────────────────────
  // sendToTokens — happy path + dedupe + filtering
  // ───────────────────────────────────────────────────────────────────
  async runSendToTokensHappyPathTests() {
    this.log('sendToTokens — happy path', 'section');
    const { service, messaging } = this.buildService();

    const tokens = ['tok-a-aaaaaa', 'tok-b-bbbbbb', 'tok-a-aaaaaa', '', null, 'tok-c-cccccc'];
    const result = await service.sendToTokens(tokens, { title: 'Hello', body: 'World' });

    this.assert(messaging.__sentCalls.length === 1, 'Single FCM call for ≤500 tokens');
    const sent = messaging.__sentCalls[0];
    this.assert(
      Array.isArray(sent.tokens) && sent.tokens.length === 3,
      'Duplicates and empty/null tokens are filtered',
      `tokens sent = ${sent.tokens.length}`
    );
    this.assert(result.successCount === 3, 'successCount reflects sent count', `got ${result.successCount}`);
    this.assert(result.failureCount === 0, 'failureCount === 0 on full success');
    this.assert(Array.isArray(result.invalidTokens) && result.invalidTokens.length === 0, 'No invalidTokens on success');
    this.assert(sent.notification.title === 'Hello', 'Built notification.title');
    this.assert(sent.notification.body === 'World', 'Built notification.body');
  }

  // ───────────────────────────────────────────────────────────────────
  // sendToTokens — invalid token codes pruning candidates
  // ───────────────────────────────────────────────────────────────────
  async runSendToTokensInvalidCodesTests() {
    this.log('sendToTokens — invalidTokens detection', 'section');
    const { service, messaging } = this.buildService();

    messaging.__queue.push({
      successCount: 1,
      failureCount: 2,
      responses: [
        { success: true, messageId: 'm-1' },
        { success: false, error: deadTokenError() },
        { success: false, error: transientError() }
      ]
    });

    const result = await service.sendToTokens(
      ['tok-good-aaaaaaa', 'tok-dead-bbbbbbb', 'tok-flaky-cccccc'],
      { title: 't', body: 'b' }
    );

    this.assert(result.successCount === 1, 'successCount === 1');
    this.assert(result.failureCount === 2, 'failureCount === 2');
    this.assert(
      result.invalidTokens.length === 1 && result.invalidTokens[0] === 'tok-dead-bbbbbbb',
      'Only dead-token-coded failures are added to invalidTokens',
      `invalidTokens = ${JSON.stringify(result.invalidTokens)}`
    );
  }

  // ───────────────────────────────────────────────────────────────────
  // sendToTokens — chunking at FCM 500-token cap
  // ───────────────────────────────────────────────────────────────────
  async runSendToTokensChunkingTests() {
    this.log('sendToTokens — chunking at 500', 'section');
    const { service, messaging } = this.buildService();

    const tokens = Array.from({ length: 1100 }, (_, i) => `tok-${String(i).padStart(6, '0')}-xxxxxxxxxx`);
    const result = await service.sendToTokens(tokens, { title: 'Bulk', body: 'send' });

    this.assert(messaging.__sentCalls.length === 3, 'Chunked into 3 FCM calls', `calls = ${messaging.__sentCalls.length}`);
    this.assert(messaging.__sentCalls[0].tokens.length === 500, 'First chunk = 500');
    this.assert(messaging.__sentCalls[1].tokens.length === 500, 'Second chunk = 500');
    this.assert(messaging.__sentCalls[2].tokens.length === 100, 'Third chunk = 100 (remainder)');
    this.assert(result.successCount === 1100, 'Aggregated successCount = 1100', `got ${result.successCount}`);
  }

  // ───────────────────────────────────────────────────────────────────
  // sendToTokens — FCM throws on a chunk
  // ───────────────────────────────────────────────────────────────────
  async runSendToTokensThrowTests() {
    this.log('sendToTokens — FCM throw counted as full-chunk failure', 'section');
    const { service, messaging } = this.buildService();

    messaging.sendEachForMulticast = async () => {
      throw new Error('simulated FCM outage');
    };

    const result = await service.sendToTokens(
      ['tok-x-aaaaa', 'tok-y-bbbbb'],
      { title: 't', body: 'b' }
    );

    this.assert(result.successCount === 0, 'successCount === 0 when FCM throws');
    this.assert(result.failureCount === 2, 'failureCount counts every token in the failed chunk');
    this.assert(result.invalidTokens.length === 0, 'invalidTokens empty when call itself failed');
  }

  // ───────────────────────────────────────────────────────────────────
  // sendToUser — model lookup + auto-prune
  // ───────────────────────────────────────────────────────────────────
  async runSendToUserTests() {
    this.log('sendToUser — model lookup + auto-prune', 'section');

    // No devices registered → no-op without FCM call
    {
      const { service, messaging, model } = this.buildService({ 'user-empty': [] });
      const result = await service.sendToUser('user-empty', { title: 't', body: 'b' });
      this.assert(result.successCount === 0 && result.failureCount === 0, 'User with no devices → no-op');
      this.assert(messaging.__sentCalls.length === 0, 'User with no devices → FCM not called');
      this.assert(model.__removedTokens.length === 0, 'User with no devices → no prune calls');
    }

    // Three devices, one dead → FCM called once, dead one pruned
    {
      const { service, messaging, model } = this.buildService({
        'user-1': ['tok-good-aaaaaa', 'tok-dead-bbbbbb', 'tok-also-good-c']
      });
      messaging.__queue.push({
        successCount: 2,
        failureCount: 1,
        responses: [
          { success: true,  messageId: 'm-1' },
          { success: false, error: deadTokenError() },
          { success: true,  messageId: 'm-2' }
        ]
      });

      const result = await service.sendToUser('user-1', { title: 'Hi', body: 'There' });
      this.assert(result.successCount === 2, 'sendToUser successCount === 2');
      this.assert(result.failureCount === 1, 'sendToUser failureCount === 1');
      this.assert(result.prunedCount === 1, 'sendToUser pruned exactly 1 dead token', `prunedCount = ${result.prunedCount}`);
      this.assert(
        model.__removedTokens.length === 1 && model.__removedTokens[0] === 'tok-dead-bbbbbb',
        'Model.removeDeviceTokenByString called with the dead token only'
      );
    }

    // Missing userId throws
    {
      const { service } = this.buildService();
      let threw = false;
      try { await service.sendToUser('', { title: 't', body: 'b' }); } catch (e) { threw = true; }
      this.assert(threw, 'sendToUser throws when userId is empty');
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // sendToUsers — multi-user fan-out
  // ───────────────────────────────────────────────────────────────────
  async runSendToUsersTests() {
    this.log('sendToUsers — multi-user fan-out', 'section');

    const { service, messaging, model } = this.buildService({
      'user-a': ['tok-a-1-aaaaaaaa', 'tok-a-2-aaaaaaaa'],
      'user-b': ['tok-b-1-bbbbbbbb'],
      'user-c': []
    });

    const result = await service.sendToUsers(['user-a', 'user-b', 'user-c'], { title: 'Group', body: 'Ping' });

    this.assert(messaging.__sentCalls.length === 1, 'sendToUsers issues 1 FCM call (single chunk)');
    const sent = messaging.__sentCalls[0];
    this.assert(sent.tokens.length === 3, 'sendToUsers fanned out to 3 tokens', `got ${sent.tokens.length}`);
    this.assert(result.successCount === 3, 'sendToUsers aggregate successCount === 3');
    this.assert(model.__removedTokens.length === 0, 'No prune calls when no dead tokens');

    // Empty userIds → no-op
    const empty = await service.sendToUsers([], { title: 't', body: 'b' });
    this.assert(empty.successCount === 0, 'Empty userIds → no-op');
  }

  // ───────────────────────────────────────────────────────────────────
  // Payload builder — data coercion + APNs/Android specifics
  // ───────────────────────────────────────────────────────────────────
  async runPayloadBuilderTests() {
    this.log('Payload builder — data coercion + APNs/Android', 'section');
    const { service, messaging } = this.buildService();

    await service.sendToTokens(['tok-payload-test-12345'], {
      title: 'T',
      body: 'B',
      data: { count: 5, isAdmin: true, missing: null, name: 'Alice' },
      badge: 7,
      sound: 'default',
      apnsContentAvailable: true,
      android: { priority: 'high', channelId: 'reminders' }
    });

    const sent = messaging.__sentCalls[0];
    this.assert(sent.data.count === '5', 'data.count coerced to string "5"');
    this.assert(sent.data.isAdmin === 'true', 'data.isAdmin coerced to string "true"');
    this.assert(sent.data.missing === '', 'data.missing (null) coerced to empty string');
    this.assert(sent.data.name === 'Alice', 'data.name preserved');

    this.assert(sent.apns && sent.apns.payload && sent.apns.payload.aps, 'APNs aps section present');
    this.assert(sent.apns.payload.aps.badge === 7, 'APNs badge = 7');
    this.assert(sent.apns.payload.aps.sound === 'default', 'APNs sound = default');
    this.assert(sent.apns.payload.aps['content-available'] === 1, 'APNs content-available = 1 for silent push');

    this.assert(sent.android && sent.android.priority === 'high', 'Android priority = high');
    this.assert(
      sent.android.notification && sent.android.notification.channel_id === 'reminders',
      'Android channel_id = reminders'
    );
  }

  // ───────────────────────────────────────────────────────────────────
  // Not configured → all sends silently no-op
  // ───────────────────────────────────────────────────────────────────
  async runNotConfiguredTests() {
    this.log('Not configured → silent no-op (skipped: true)', 'section');

    const previousMockEnv = process.env.TEST_MOCK_PUSH;
    const previousJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const previousPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    delete process.env.TEST_MOCK_PUSH;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

    try {
      const model = buildFakeDeviceTokenModel({ 'user-1': ['tok-x-aaaaaaaa'] });
      const service = new PushNotificationService({
        deviceTokenModel: model,
        logger: buildSilentLogger()
      });

      this.assert(service.isConfigured() === false, 'Service reports isConfigured() === false');

      const r1 = await service.sendToTokens(['tok-x-aaaaaaaa'], { title: 't', body: 'b' });
      this.assert(r1.skipped === true, 'sendToTokens returns skipped: true when unconfigured');

      const r2 = await service.sendToUser('user-1', { title: 't', body: 'b' });
      this.assert(r2.skipped === true, 'sendToUser returns skipped: true when unconfigured');

      const r3 = await service.sendToUsers(['user-1'], { title: 't', body: 'b' });
      this.assert(r3.skipped === true, 'sendToUsers returns skipped: true when unconfigured');

      this.assert(model.__removedTokens.length === 0, 'No prune calls happen when unconfigured');
    } finally {
      if (previousMockEnv !== undefined) process.env.TEST_MOCK_PUSH = previousMockEnv;
      if (previousJson !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previousJson;
      if (previousPath !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT_PATH = previousPath;
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // Run all
  // ───────────────────────────────────────────────────────────────────
  async run() {
    this.log('Starting PushNotificationService Unit Test Suite', 'section');
    console.log('');

    await this.runConstructionTests();
    await this.runSendToTokensInputTests();
    await this.runSendToTokensHappyPathTests();
    await this.runSendToTokensInvalidCodesTests();
    await this.runSendToTokensChunkingTests();
    await this.runSendToTokensThrowTests();
    await this.runSendToUserTests();
    await this.runSendToUsersTests();
    await this.runPayloadBuilderTests();
    await this.runNotConfiguredTests();

    this.printSummary();
    return this.testResults.failed === 0;
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    this.log('PUSH NOTIFICATION SERVICE TEST SUMMARY', 'section');
    console.log(`Total:  ${this.testResults.total}`);
    console.log(`Passed: ${this.testResults.passed}`);
    console.log(`Failed: ${this.testResults.failed}`);
    console.log('='.repeat(60));
    if (this.testResults.failed === 0) {
      this.log('All PushNotificationService tests passed!', 'pass');
    } else {
      this.log('Some tests failed. See output above.', 'fail');
    }
  }
}

if (require.main === module) {
  const runner = new PushNotificationServiceTestRunner();
  runner.run()
    .then(success => process.exit(success ? 0 : 1))
    .catch(err => {
      console.error('Test runner failed:', err);
      process.exit(1);
    });
}

module.exports = PushNotificationServiceTestRunner;
