/**
 * PushNotificationService
 *
 * Sends push notifications to user devices via Firebase Cloud Messaging
 * (FCM HTTP v1 API), powered by the firebase-admin SDK. Single FCM relay
 * handles iOS (via APNs), Android, and Web.
 *
 * Lifecycle: instantiated once at app startup in server.js and exposed via
 * `app.locals.pushNotificationService` so any route or background job can
 * call it. Designed to fail soft — if Firebase credentials are not set the
 * service silently no-ops every send and reports `skipped: true`, so the
 * rest of the API stays healthy in environments without push configured
 * (local dev, PR previews, CI).
 *
 * High-level API (use these from routes / background jobs):
 *   - sendToUser(userId, payload)     → fan out to all of one user's devices
 *   - sendToUsers(userIds, payload)   → fan out to many users' devices
 *
 * Low-level API (rarely needed directly):
 *   - sendToTokens(tokens, payload)   → push to specific raw token strings
 *
 * Dead-token cleanup: FCM responses include per-token error codes when a
 * token is no longer registered or is invalid. The high-level methods
 * automatically delete those rows from device_tokens via the model so the
 * table stays healthy and we don't waste outbound calls next time.
 *
 * Configuration (env):
 *   FIREBASE_SERVICE_ACCOUNT_JSON   Full service account JSON (preferred)
 *   FIREBASE_SERVICE_ACCOUNT_PATH   Path to service account JSON file
 *   TEST_MOCK_PUSH=true             Force mock mode (no real FCM calls).
 *                                   Mirrors TEST_MOCK_LLM convention so test
 *                                   runs cost nothing and need no Firebase
 *                                   credentials configured.
 *
 * Tests inject a fake `messagingClient` directly via the constructor so
 * firebase-admin is never required during the unit suite.
 */

let firebaseAdmin = null; // Lazy-required only when we actually init real FCM

// FCM error codes that indicate a token is permanently dead and should be
// purged from device_tokens. Other failures (auth, quota, transient) are
// logged but tokens are kept so a retry can succeed.
const FCM_DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
  'messaging/mismatched-credential'
]);

// FCM hard cap for sendEachForMulticast. Larger fan-outs are chunked.
const MAX_TOKENS_PER_REQUEST = 500;

class PushNotificationService {
  /**
   * @param {Object} options
   * @param {Object} options.deviceTokenModel  Required. Used to resolve user → tokens
   *                                           and to prune invalid tokens.
   * @param {Object} [options.messagingClient] Optional injected messaging client
   *                                           for tests. When supplied, Firebase
   *                                           is never initialized.
   * @param {Object} [options.logger]          Optional logger (defaults to console).
   */
  constructor({ deviceTokenModel, messagingClient = null, logger = console } = {}) {
    if (!deviceTokenModel) {
      throw new Error('PushNotificationService requires a deviceTokenModel');
    }

    this.deviceTokenModel = deviceTokenModel;
    this.logger = logger;
    this._messaging = null;
    this._configured = false;
    this._mockMode = false;

    if (messagingClient) {
      // Test path — never touch firebase-admin
      this._messaging = messagingClient;
      this._configured = true;
      this._mockMode = true;
      return;
    }

    if (process.env.TEST_MOCK_PUSH === 'true') {
      this._messaging = this._buildMockMessaging();
      this._configured = true;
      this._mockMode = true;
      this.logger.log('✅ PushNotificationService: TEST_MOCK_PUSH=true (no real FCM calls)');
      return;
    }

    try {
      this._initFirebase();
    } catch (err) {
      // Non-fatal: app continues to run, push sends become no-ops.
      this.logger.warn(`⚠️  PushNotificationService not configured: ${err.message}`);
      this._configured = false;
    }
  }

  isConfigured() {
    return this._configured;
  }

  isMockMode() {
    return this._mockMode;
  }

  _initFirebase() {
    if (!firebaseAdmin) {
      try {
        firebaseAdmin = require('firebase-admin');
      } catch (err) {
        throw new Error('firebase-admin package is not installed. Run: npm install firebase-admin');
      }
    }

    const credentials = this._loadCredentials();
    if (!credentials) {
      throw new Error('No Firebase service account configured (set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH)');
    }

    // Reuse default app if it already exists (tests, hot reload, repeat init).
    if (firebaseAdmin.apps.length === 0) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(credentials)
      });
    }

    this._messaging = firebaseAdmin.messaging();
    this._configured = true;
    this.logger.log('✅ PushNotificationService initialized with Firebase Admin SDK (FCM)');
  }

  _loadCredentials() {
    const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (inlineJson) {
      try {
        return JSON.parse(inlineJson);
      } catch (err) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
      }
    }

    const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (filePath) {
      const fs = require('fs');
      let raw;
      try {
        raw = fs.readFileSync(filePath, 'utf8');
      } catch (err) {
        throw new Error(`FIREBASE_SERVICE_ACCOUNT_PATH unreadable: ${err.message}`);
      }
      try {
        return JSON.parse(raw);
      } catch (err) {
        throw new Error(`Service account at ${filePath} is not valid JSON`);
      }
    }

    return null;
  }

  /**
   * Mock messaging used when TEST_MOCK_PUSH=true is set on a running server.
   * Always returns "all success" so dev environments behave predictably.
   * Unit tests construct their own richer fakes via the messagingClient option.
   */
  _buildMockMessaging() {
    return {
      sendEachForMulticast: async (message) => ({
        successCount: message.tokens.length,
        failureCount: 0,
        responses: message.tokens.map(() => ({
          success: true,
          messageId: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        }))
      })
    };
  }

  /**
   * Build an FCM-compatible MulticastMessage. data values must be strings,
   * so we coerce here to spare callers a footgun (FCM rejects non-string
   * data values with a confusing error).
   */
  _buildMessage(tokens, payload) {
    const data = {};
    if (payload.data && typeof payload.data === 'object') {
      for (const [k, v] of Object.entries(payload.data)) {
        data[k] = v == null ? '' : String(v);
      }
    }

    const notification = {};
    if (payload.title) notification.title = String(payload.title);
    if (payload.body) notification.body = String(payload.body);
    if (payload.imageUrl) notification.imageUrl = String(payload.imageUrl);

    const message = { tokens, data };
    if (Object.keys(notification).length > 0) {
      message.notification = notification;
    }

    // iOS-specific overrides via APNs payload
    const aps = {};
    if (payload.badge != null) aps.badge = Number(payload.badge);
    if (payload.sound) aps.sound = String(payload.sound);
    if (payload.apnsContentAvailable) aps['content-available'] = 1;
    if (Object.keys(aps).length > 0) {
      message.apns = { payload: { aps } };
    }

    // Android-specific overrides
    if (payload.android && typeof payload.android === 'object') {
      message.android = {};
      if (payload.android.priority) message.android.priority = payload.android.priority;
      if (payload.android.channelId) {
        message.android.notification = { channel_id: String(payload.android.channelId) };
      }
    }

    return message;
  }

  /**
   * Low-level send to a list of raw FCM device-token strings.
   * Returns { successCount, failureCount, invalidTokens, skipped? }.
   * Invalid tokens are reported but NOT pruned here — the high-level
   * sendToUser/sendToUsers methods take care of pruning so direct callers
   * stay in control of cleanup.
   */
  async sendToTokens(tokens, payload) {
    if (!this._configured) {
      this.logger.warn('PushNotificationService.sendToTokens called but service is not configured — skipping');
      return { successCount: 0, failureCount: 0, invalidTokens: [], skipped: true };
    }

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }
    if (!payload || typeof payload !== 'object') {
      throw new Error('payload object is required');
    }
    if (!payload.title && !payload.body && !payload.data) {
      throw new Error('payload must include at least one of: title, body, data');
    }

    const uniqueTokens = [...new Set(tokens.filter(t => typeof t === 'string' && t.length > 0))];
    if (uniqueTokens.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    let successCount = 0;
    let failureCount = 0;
    const invalidTokens = [];

    for (let i = 0; i < uniqueTokens.length; i += MAX_TOKENS_PER_REQUEST) {
      const chunk = uniqueTokens.slice(i, i + MAX_TOKENS_PER_REQUEST);
      const message = this._buildMessage(chunk, payload);

      let result;
      try {
        result = await this._messaging.sendEachForMulticast(message);
      } catch (err) {
        this.logger.error(`PushNotificationService FCM call failed for chunk of ${chunk.length}: ${err.message}`);
        failureCount += chunk.length;
        continue;
      }

      successCount += result.successCount || 0;
      failureCount += result.failureCount || 0;

      (result.responses || []).forEach((resp, idx) => {
        if (resp && resp.success) return;
        const error = resp && resp.error;
        if (!error) return;
        const code = error.code || (error.errorInfo && error.errorInfo.code);
        if (code && FCM_DEAD_TOKEN_CODES.has(code)) {
          invalidTokens.push(chunk[idx]);
        } else {
          const preview = chunk[idx].slice(0, 12);
          this.logger.warn(`Push send error for token ${preview}…: ${code || error.message || 'unknown'}`);
        }
      });
    }

    return { successCount, failureCount, invalidTokens };
  }

  /**
   * Fan out a single payload to every device registered to a single user.
   * Auto-prunes any tokens FCM reports as dead.
   */
  async sendToUser(userId, payload) {
    if (!this._configured) {
      this.logger.warn(`PushNotificationService.sendToUser(${userId}) skipped — service not configured`);
      return { successCount: 0, failureCount: 0, invalidTokens: [], skipped: true };
    }
    if (!userId) {
      throw new Error('userId is required');
    }

    const records = await this.deviceTokenModel.getUserDeviceTokensWithStrings(userId);
    if (!records || records.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const tokens = records.map(r => r.device_token).filter(Boolean);
    const result = await this.sendToTokens(tokens, payload);
    if (result.invalidTokens.length > 0) {
      const pruned = await this._pruneInvalidTokens(result.invalidTokens);
      result.prunedCount = pruned;
    }
    return result;
  }

  /**
   * Fan out the same payload to every device of every user in `userIds`.
   * Auto-prunes invalid tokens. Returns aggregate counts only.
   */
  async sendToUsers(userIds, payload) {
    if (!this._configured) {
      this.logger.warn('PushNotificationService.sendToUsers skipped — service not configured');
      return { successCount: 0, failureCount: 0, invalidTokens: [], skipped: true };
    }
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    let records;
    if (typeof this.deviceTokenModel.getDeviceTokensForUsers === 'function') {
      records = await this.deviceTokenModel.getDeviceTokensForUsers(userIds);
    } else {
      // Fallback: per-user lookup. Slower but avoids hard-coupling to the
      // bulk helper if a future model variant doesn't expose it.
      records = [];
      for (const id of [...new Set(userIds)]) {
        const rs = await this.deviceTokenModel.getUserDeviceTokensWithStrings(id);
        if (rs) records.push(...rs);
      }
    }

    const tokens = (records || []).map(r => r.device_token).filter(Boolean);
    if (tokens.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const result = await this.sendToTokens(tokens, payload);
    if (result.invalidTokens.length > 0) {
      const pruned = await this._pruneInvalidTokens(result.invalidTokens);
      result.prunedCount = pruned;
    }
    return result;
  }

  async _pruneInvalidTokens(tokens) {
    let removed = 0;
    for (const t of tokens) {
      try {
        const count = await this.deviceTokenModel.removeDeviceTokenByString(t);
        removed += count || 0;
      } catch (err) {
        this.logger.warn(`Failed to prune invalid push token: ${err.message}`);
      }
    }
    if (removed > 0) {
      this.logger.log(`PushNotificationService pruned ${removed} dead device token(s)`);
    }
    return removed;
  }
}

module.exports = PushNotificationService;
