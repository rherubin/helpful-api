const crypto = require('crypto');

const {
  GooglePlayReceiptVerifier,
  GooglePlayReceiptError,
  parseServiceAccount,
  ANDROID_PUBLISHER_SCOPE
} = require('../services/GooglePlayReceiptVerifier');
const { SubscriptionService, SubscriptionError } = require('../services/SubscriptionService');
const AndroidSubscription = require('../models/AndroidSubscription');

/**
 * Google Play receipt verification unit tests.
 *
 * Uses a throwaway RSA key as the "service account" and a fake HTTP client in
 * place of Google, so the real JWT signing, token caching, response parsing
 * and SubscriptionService accept/reject rules all run, with no network, no
 * database and no Google credentials.
 *
 * Run with: node tests/google-play-receipt-verifier-test.js
 */

const PACKAGE = 'com.helpful.couples';
const YEARLY = 'com.helpful.yearly.29.99';
const MONTHLY = 'com.helpful.monthly.9.99';
const DAY = 24 * 60 * 60 * 1000;

function httpError(status, reason = null, message = 'error') {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = {
    status,
    data: { error: { code: status, message, errors: reason ? [{ reason }] : [] } }
  };
  return error;
}

// Stands in for axios. `subscriptions` maps purchase token -> resource, or ->
// a function returning a resource / throwing an axios-style error.
class FakeGoogle {
  constructor(subscriptions = {}) {
    this.subscriptions = subscriptions;
    this.tokenRequests = [];
    this.getRequests = [];
    this.tokenCounter = 0;
    this.tokenError = null;
    this.rejectNextGetWith401 = false;
  }

  async post(url, body, options) {
    this.tokenRequests.push({ url, body, options });
    if (this.tokenError) throw this.tokenError;
    this.tokenCounter += 1;
    return { data: { access_token: `access-${this.tokenCounter}`, expires_in: 3600, token_type: 'Bearer' } };
  }

  async get(url, options) {
    this.getRequests.push({ url, options });
    if (this.rejectNextGetWith401) {
      this.rejectNextGetWith401 = false;
      throw httpError(401, 'authError');
    }
    const token = decodeURIComponent(url.split('/tokens/')[1]);
    const entry = this.subscriptions[token];
    if (entry === undefined) throw httpError(404, 'notFound');
    const resource = typeof entry === 'function' ? entry() : entry;
    return { data: resource };
  }
}

// In-memory android_subscriptions with the same lookup rules as the model.
class FakeAndroidModel {
  constructor() {
    this.rows = [];
    this.seq = 0;
  }
  async getByOrderId(orderId) { return this.rows.find((r) => r.order_id === orderId) || null; }
  async getByPurchaseToken(token) { return this.rows.find((r) => r.purchase_token === token) || null; }
  async upsertSubscription(userId, data) {
    const existing = (await this.getByOrderId(data.order_id)) || (await this.getByPurchaseToken(data.purchase_token));
    if (existing) {
      Object.assign(existing, data);
      return { ...existing, updated: true };
    }
    const row = { id: `row${++this.seq}`, user_id: userId, ...data };
    this.rows.push(row);
    return { ...row, created: true };
  }
  async markLapsed(id, state, now = Date.now()) {
    const row = this.rows.find((r) => r.id === id);
    row.subscription_state = state;
    row.expiration_date = Math.min(row.expiration_date, now);
    row.last_verified_at = now;
  }
  async updateVerifiedState(id, fields) {
    Object.assign(this.rows.find((r) => r.id === id), fields);
  }
  async getRefreshCandidates() {
    return this.rows.filter((r) => r.last_verified_at && r.expiration_date <= Date.now() + DAY);
  }
  async hasActiveSubscription(userId) {
    const now = Date.now();
    return this.rows.some((r) => r.user_id === userId && AndroidSubscription.rowGrantsPremium(r, now));
  }
  async getActiveByUserId(userId) {
    const now = Date.now();
    return this.rows.filter((r) => r.user_id === userId && AndroidSubscription.rowGrantsPremium(r, now));
  }
}

class GooglePlayReceiptVerifierTestRunner {
  constructor() {
    this.testResults = { passed: 0, failed: 0, total: 0 };
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    this.publicKey = publicKey;
    this.serviceAccountJson = JSON.stringify({
      type: 'service_account',
      project_id: 'helpful-test',
      private_key_id: 'kid-123',
      private_key: this.privateKeyPem,
      client_email: 'play-verifier@helpful-test.iam.gserviceaccount.com',
      token_uri: 'https://oauth2.googleapis.com/token'
    });
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
      if (overrides[key] === undefined) delete process.env[key];
      else process.env[key] = overrides[key];
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

  activeResource(overrides = {}, lineItemOverrides = {}) {
    return {
      kind: 'androidpublisher#subscriptionPurchaseV2',
      regionCode: 'US',
      startTime: new Date(Date.now() - DAY).toISOString(),
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
      lineItems: [{
        productId: YEARLY,
        expiryTime: new Date(Date.now() + 364 * DAY).toISOString(),
        latestSuccessfulOrderId: 'GPA.3311-2222-1111-00000',
        autoRenewingPlan: { autoRenewEnabled: true },
        ...lineItemOverrides
      }],
      ...overrides
    };
  }

  clientPayload(overrides = {}) {
    // Exactly what SubscriptionReceiptBridge.recoverAndroidReceipt sends.
    return {
      platform: 'android',
      product_id: YEARLY,
      purchase_token: 'token-active',
      order_id: 'GPA.3311-2222-1111-00000',
      package_name: PACKAGE,
      purchase_date: Date.now() - DAY,
      expiration_date: null,
      ...overrides
    };
  }

  buildService(google, model = new FakeAndroidModel()) {
    const verifier = new GooglePlayReceiptVerifier({
      serviceAccount: this.serviceAccountJson,
      httpClient: google
    });
    const pairingModel = { getAcceptedPairings: async () => [], setPremiumStatus: async () => {} };
    const iosModel = { hasActiveSubscription: async () => false };
    const service = new SubscriptionService(iosModel, model, null, pairingModel, null, null, verifier);
    service.reconciledUsers = [];
    const original = service.reconcilePremiumStatus.bind(service);
    service.reconcilePremiumStatus = async (userId) => {
      service.reconciledUsers.push(userId);
      return original(userId);
    };
    return { service, model, verifier };
  }

  async expectSubscriptionError(fn, { status, code, message }, testName) {
    try {
      await fn();
      this.assert(false, testName, 'no error thrown');
    } catch (error) {
      const ok = error instanceof SubscriptionError
        && (status === undefined || error.statusCode === status)
        && (code === undefined || error.code === code)
        && (message === undefined || message.test(error.message));
      this.assert(ok, testName, `${error.statusCode} ${error.code} ${error.message}`);
    }
  }

  // --- verifier ---------------------------------------------------------

  async testParseServiceAccount() {
    this.log('🧪 Service account parsing', 'section');
    const raw = parseServiceAccount(this.serviceAccountJson);
    this.assert(raw.clientEmail.endsWith('iam.gserviceaccount.com'), 'Raw JSON service account parses');

    const b64 = parseServiceAccount(Buffer.from(this.serviceAccountJson).toString('base64'));
    this.assert(b64 && b64.clientEmail === raw.clientEmail, 'Base64-encoded service account parses');

    const escaped = JSON.stringify({
      ...JSON.parse(this.serviceAccountJson),
      private_key: this.privateKeyPem.replace(/\n/g, '\\n')
    });
    const fromEscaped = parseServiceAccount(escaped);
    this.assert(fromEscaped.privateKey.includes('\n'), 'Literal \\n sequences in private_key are unescaped');

    this.assert(parseServiceAccount('') === null && parseServiceAccount(undefined) === null,
      'Unset/empty value means not configured');

    for (const [label, value] of [
      ['not JSON', 'definitely not json'],
      ['missing private_key', JSON.stringify({ client_email: 'x@y' })],
      ['bad PEM', JSON.stringify({ client_email: 'x@y', private_key: 'nope' })]
    ]) {
      try {
        parseServiceAccount(value);
        this.assert(false, `Malformed service account (${label}) is rejected`, 'no error');
      } catch (error) {
        this.assert(error instanceof GooglePlayReceiptError && error.kind === 'config',
          `Malformed service account (${label}) is rejected`, error.message);
      }
    }
  }

  async testTokenExchangeAndCaching() {
    this.log('🧪 OAuth token exchange + caching', 'section');
    const google = new FakeGoogle({ 'token-active': this.activeResource() });
    const verifier = new GooglePlayReceiptVerifier({ serviceAccount: this.serviceAccountJson, httpClient: google });

    await verifier.getSubscription(PACKAGE, 'token-active');
    await verifier.getSubscription(PACKAGE, 'token-active');
    this.assert(google.tokenRequests.length === 1, 'Access token is cached across calls',
      `token requests: ${google.tokenRequests.length}`);

    const params = new URLSearchParams(google.tokenRequests[0].body);
    this.assert(params.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      'Uses the JWT bearer grant');
    const [h, c, sig] = params.get('assertion').split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    const signatureOk = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`),
      this.publicKey, Buffer.from(sig, 'base64url'));
    this.assert(signatureOk && header.alg === 'RS256' && header.kid === 'kid-123',
      'Assertion is RS256-signed by the service account key');
    this.assert(claims.scope === ANDROID_PUBLISHER_SCOPE
      && claims.aud === 'https://oauth2.googleapis.com/token'
      && claims.iss === 'play-verifier@helpful-test.iam.gserviceaccount.com'
      && claims.exp - claims.iat === 3600,
    'Assertion claims request the androidpublisher scope');

    const getUrl = google.getRequests[0].url;
    this.assert(getUrl === 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'
      + 'com.helpful.couples/purchases/subscriptionsv2/tokens/token-active',
    'Calls purchases.subscriptionsv2.get', getUrl);
    this.assert(google.getRequests[0].options.headers.Authorization === 'Bearer access-1',
      'Sends the access token');

    // Expired cache -> new token.
    let now = Date.now();
    const clockVerifier = new GooglePlayReceiptVerifier({
      serviceAccount: this.serviceAccountJson, httpClient: google, now: () => now
    });
    google.tokenRequests = [];
    await clockVerifier.getSubscription(PACKAGE, 'token-active');
    now += 3600 * 1000;
    await clockVerifier.getSubscription(PACKAGE, 'token-active');
    this.assert(google.tokenRequests.length === 2, 'Token is refreshed once it is near expiry');

    // 401 with a cached token -> one retry with a fresh token.
    google.tokenRequests = [];
    google.rejectNextGetWith401 = true;
    const data = await verifier.getSubscription(PACKAGE, 'token-active');
    this.assert(data && google.tokenRequests.length === 1, 'A 401 drops the cached token and retries once');

    // Concurrent calls share one exchange.
    const fresh = new GooglePlayReceiptVerifier({ serviceAccount: this.serviceAccountJson, httpClient: google });
    google.tokenRequests = [];
    await Promise.all([1, 2, 3].map(() => fresh.getSubscription(PACKAGE, 'token-active')));
    this.assert(google.tokenRequests.length === 1, 'Concurrent lookups share one token exchange');
  }

  async testVerifierErrorMapping() {
    this.log('🧪 Google API error mapping', 'section');
    const google = new FakeGoogle({
      gone: () => { throw httpError(410, 'purchaseTokenNoLongerValid'); },
      bad: () => { throw httpError(400, 'purchaseTokenMismatch'); },
      forbidden: () => { throw httpError(403, 'userInsufficientPermission'); },
      boom: () => { throw httpError(500); },
      offline: () => { const e = new Error('ECONNRESET'); throw e; }
    });
    const verifier = new GooglePlayReceiptVerifier({ serviceAccount: this.serviceAccountJson, httpClient: google });
    const cases = [
      ['missing', 'invalid', 404], ['gone', 'invalid', 410], ['bad', 'invalid', 400],
      ['forbidden', 'unavailable', 403], ['boom', 'unavailable', 500], ['offline', 'unavailable', null]
    ];
    for (const [token, kind, status] of cases) {
      try {
        await verifier.getSubscription(PACKAGE, token);
        this.assert(false, `Google ${status ?? 'network error'} maps to ${kind}`, 'no error');
      } catch (error) {
        this.assert(error instanceof GooglePlayReceiptError && error.kind === kind && error.googleStatus === status,
          `Google ${status ?? 'network error'} maps to ${kind}`, error.message);
      }
    }

    google.tokenError = httpError(400, null, 'invalid_grant');
    const brokenAuth = new GooglePlayReceiptVerifier({ serviceAccount: this.serviceAccountJson, httpClient: google });
    try {
      await brokenAuth.getSubscription(PACKAGE, 'token-active');
      this.assert(false, 'Token exchange failure is unavailable (not a client error)', 'no error');
    } catch (error) {
      this.assert(error.kind === 'unavailable', 'Token exchange failure is unavailable (not a client error)', error.message);
    }
  }

  // --- SubscriptionService ---------------------------------------------

  async testServiceAcceptsActiveSubscription() {
    this.log('🧪 Service: valid active subscription with null client expiry', 'section');
    const google = new FakeGoogle({ 'token-active': this.activeResource() });
    const { service, model } = this.buildService(google);

    // Client claims the monthly product, a bogus order id and a fake expiry;
    // all must be replaced by Google's values.
    const result = await service.processReceipt('user-1', this.clientPayload({
      product_id: MONTHLY,
      order_id: 'GPA.client-lies',
      purchase_date: 1000
    }));
    const row = model.rows[0];
    const googleExpiry = Date.parse(this.activeResource().lineItems[0].expiryTime);
    this.assert(result.subscription.created && result.isActive, 'Active Google subscription is accepted and active');
    this.assert(row.product_id === YEARLY, 'Product id comes from Google', row.product_id);
    this.assert(row.order_id === 'GPA.3311-2222-1111-00000', 'Order id comes from Google', row.order_id);
    this.assert(Math.abs(row.expiration_date - googleExpiry) < 1000, 'Expiry comes from Google lineItems[].expiryTime');
    this.assert(row.purchase_date > 1000, 'Purchase date comes from Google startTime');
    this.assert(row.subscription_state === 'SUBSCRIPTION_STATE_ACTIVE' && row.auto_renewing === true
      && row.is_test_purchase === false && typeof row.last_verified_at === 'number',
    'Google state, auto-renew, test flag and verification time are stored');

    // Resubmitting after a renewal (same token, new latest order id) updates the row.
    google.subscriptions['token-active'] = this.activeResource({}, {
      latestSuccessfulOrderId: 'GPA.3311-2222-1111-00000..0',
      expiryTime: new Date(Date.now() + 700 * DAY).toISOString()
    });
    const again = await service.processReceipt('user-1', this.clientPayload());
    this.assert(again.subscription.updated && model.rows.length === 1
      && model.rows[0].order_id === 'GPA.3311-2222-1111-00000..0',
    'Renewed purchase updates the same row (looked up by token)');
  }

  async testServiceRejections() {
    this.log('🧪 Service: rejections', 'section');
    const past = new Date(Date.now() - DAY).toISOString();
    const google = new FakeGoogle({
      expired: this.activeResource({ subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }, { expiryTime: past }),
      canceledLapsed: this.activeResource({ subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' }, { expiryTime: past }),
      onHold: this.activeResource({ subscriptionState: 'SUBSCRIPTION_STATE_ON_HOLD' }, { expiryTime: past }),
      pending: this.activeResource({ subscriptionState: 'SUBSCRIPTION_STATE_PENDING' }),
      unknownProduct: this.activeResource({}, { productId: 'com.helpful.lifetime' }),
      tester: this.activeResource({ testPurchase: {} }),
      forbidden: () => { throw httpError(403, 'userInsufficientPermission'); },
      boom: () => { throw httpError(503); }
    });
    const { service, model } = this.buildService(google);
    const submit = (token, extra = {}) => service.processReceipt('user-1', this.clientPayload({ purchase_token: token, ...extra }));

    await this.expectSubscriptionError(() => submit('expired'),
      { status: 400, code: 'android_subscription_not_active' }, 'Expired subscription is rejected (400)');
    await this.expectSubscriptionError(() => submit('canceledLapsed'),
      { status: 400, code: 'android_subscription_not_active' }, 'Canceled subscription with no time left is rejected');
    await this.expectSubscriptionError(() => submit('onHold'),
      { status: 400, code: 'android_subscription_not_active' }, 'On-hold subscription is rejected');
    await this.expectSubscriptionError(() => submit('pending'),
      { status: 400, code: 'android_purchase_not_completed' }, 'Pending purchase is rejected');
    await this.expectSubscriptionError(() => submit('unknownProduct'),
      { status: 400, code: 'android_unknown_product' }, 'Unknown product is rejected');
    await this.expectSubscriptionError(() => submit('token-active', { package_name: 'com.someone.else' }),
      { status: 400, code: 'android_package_not_allowed' }, 'Wrong package is rejected without calling Google');
    this.assert(!google.getRequests.some((r) => r.url.includes('com.someone.else')), 'Wrong package never reaches Google');
    await this.expectSubscriptionError(() => submit('no-such-token'),
      { status: 400, code: 'android_purchase_token_not_found' }, 'Unknown token (Google 404) is a 400');
    await this.expectSubscriptionError(() => submit('forbidden'),
      { status: 503, code: 'android_verification_unavailable' }, 'Google auth/permission failure is a 503');
    await this.expectSubscriptionError(() => submit('boom'),
      { status: 503, code: 'android_verification_unavailable' }, 'Google outage is a 503');
    this.assert(model.rows.length === 0, 'Nothing was stored for rejected receipts');

    const accepted = await submit('tester');
    this.assert(accepted.subscription.is_test_purchase === true, 'License-tester purchase is accepted by default and flagged');
    await this.withEnv({ GOOGLE_PLAY_ALLOW_TEST_PURCHASES: 'false' }, async () => {
      google.subscriptions.tester2 = this.activeResource({ testPurchase: {} }, { latestSuccessfulOrderId: 'GPA.t2' });
      await this.expectSubscriptionError(() => submit('tester2'),
        { status: 400, code: 'android_test_purchase_rejected' },
        'GOOGLE_PLAY_ALLOW_TEST_PURCHASES=false rejects license-tester purchases');
    });

    await this.withEnv({ GOOGLE_PLAY_PACKAGE_NAMES: 'com.helpful.couples.dev, com.helpful.couples' }, async () => {
      google.subscriptions.devToken = this.activeResource({}, { latestSuccessfulOrderId: 'GPA.dev' });
      const dev = await service.processReceipt('user-2',
        this.clientPayload({ purchase_token: 'devToken', package_name: 'com.helpful.couples.dev' }));
      this.assert(dev.subscription.created, 'GOOGLE_PLAY_PACKAGE_NAMES accepts any listed package');
    });
  }

  async testServiceOwnership() {
    this.log('🧪 Service: ownership and linked purchase tokens', 'section');
    const google = new FakeGoogle({ 'token-active': this.activeResource() });
    const { service, model } = this.buildService(google);
    await service.processReceipt('user-1', this.clientPayload());
    await this.expectSubscriptionError(() => service.processReceipt('user-2', this.clientPayload()),
      { status: 409 }, 'Same verified token for another user is a 409');

    // Upgrade: a new token links to user-1's old one.
    google.subscriptions['token-upgrade'] = this.activeResource({ linkedPurchaseToken: 'token-active' }, {
      productId: MONTHLY, latestSuccessfulOrderId: 'GPA.upgrade-0001'
    });
    await service.processReceipt('user-1', this.clientPayload({ purchase_token: 'token-upgrade', order_id: 'GPA.upgrade-0001' }));
    const oldRow = model.rows.find((r) => r.purchase_token === 'token-active');
    const newRow = model.rows.find((r) => r.purchase_token === 'token-upgrade');
    this.assert(oldRow.subscription_state === 'SUPERSEDED' && oldRow.expiration_date <= Date.now(),
      'Linked (replaced) token stops granting premium');
    this.assert(newRow.linked_purchase_token === 'token-active' && newRow.expiration_date > Date.now(),
      'New token records what it replaced and is active');

    // Resubscribe from a different app account on the same Google account.
    google.subscriptions['token-resub'] = this.activeResource({ linkedPurchaseToken: 'token-upgrade' }, {
      latestSuccessfulOrderId: 'GPA.resub-0001'
    });
    service.reconciledUsers = [];
    await service.processReceipt('user-3', this.clientPayload({ purchase_token: 'token-resub', order_id: 'GPA.resub-0001' }));
    this.assert(newRow.subscription_state === 'SUPERSEDED', 'Replaced row owned by another account is superseded');
    this.assert(service.reconciledUsers.includes('user-1') && service.reconciledUsers.includes('user-3'),
      'Premium is reconciled for both the previous and the new owner');
  }

  async testServiceNotConfigured() {
    this.log('🧪 Service: not configured / mock mode', 'section');
    await this.withEnv({ GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: undefined, TEST_MOCK_IAP: undefined }, async () => {
      const service = new SubscriptionService(null, new FakeAndroidModel(), null,
        { getAcceptedPairings: async () => [] });
      await this.expectSubscriptionError(() => service.processReceipt('user-1', this.clientPayload()),
        { status: 503, code: 'android_verification_not_configured', message: /GOOGLE_PLAY_SERVICE_ACCOUNT_JSON/ },
        'No service account keeps Android fail-closed with 503');
    });
    await this.withEnv({ GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: '{"broken"', TEST_MOCK_IAP: undefined }, async () => {
      const service = new SubscriptionService(null, new FakeAndroidModel(), null,
        { getAcceptedPairings: async () => [] });
      await this.expectSubscriptionError(() => service.processReceipt('user-1', this.clientPayload()),
        { status: 503, code: 'android_verification_misconfigured' },
        'Malformed service account JSON is a loud 503');
    });
    await this.withEnv({ TEST_MOCK_IAP: 'true' }, async () => {
      const model = new FakeAndroidModel();
      const service = new SubscriptionService({ hasActiveSubscription: async () => false }, model, null,
        { getAcceptedPairings: async () => [] });
      const yearly = await service.processReceipt('user-1', this.clientPayload());
      const monthly = await service.processReceipt('user-1',
        this.clientPayload({ product_id: MONTHLY, purchase_token: 'm', order_id: 'GPA.m' }));
      this.assert(yearly.isActive && yearly.subscription.expiration_date - yearly.subscription.purchase_date === 365 * DAY,
        'TEST_MOCK_IAP accepts the real app\'s null expiry (yearly -> +365d)');
      this.assert(monthly.subscription.expiration_date - monthly.subscription.purchase_date === 30 * DAY,
        'TEST_MOCK_IAP derives +30d for monthly');
    });
    const validationService = new SubscriptionService();
    await this.expectSubscriptionError(
      () => validationService.validateAndroidPayload(this.clientPayload({ expiration_date: 5, purchase_date: 10 })),
      { status: 400 }, 'A client-supplied expiry must still be later than purchase_date');
  }

  async testRefreshJob() {
    this.log('🧪 Service: renewal refresh job', 'section');
    const google = new FakeGoogle({ 'token-active': this.activeResource() });
    const { service, model } = this.buildService(google);
    await service.processReceipt('user-1', this.clientPayload());
    google.subscriptions['token-b'] = this.activeResource({}, { latestSuccessfulOrderId: 'GPA.b' });
    await service.processReceipt('user-2', this.clientPayload({ purchase_token: 'token-b', order_id: 'GPA.b' }));
    google.subscriptions['token-c'] = this.activeResource({}, { latestSuccessfulOrderId: 'GPA.c' });
    await service.processReceipt('user-3', this.clientPayload({ purchase_token: 'token-c', order_id: 'GPA.c' }));

    // Pretend all three periods ended an hour ago.
    for (const row of model.rows) {
      row.expiration_date = Date.now() - 60 * 60 * 1000;
    }
    google.subscriptions['token-active'] = this.activeResource({}, {
      latestSuccessfulOrderId: 'GPA.3311-2222-1111-00000..0',
      expiryTime: new Date(Date.now() + 30 * DAY).toISOString()
    });
    google.subscriptions['token-b'] = this.activeResource({ subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }, {
      expiryTime: new Date(Date.now() - 60 * 60 * 1000).toISOString()
    });
    google.subscriptions['token-c'] = () => { throw httpError(410, 'purchaseTokenNoLongerValid'); };

    await this.withEnv({ TEST_MOCK_IAP: undefined }, async () => {
      service.reconciledUsers = [];
      const result = await service.refreshAndroidSubscriptions();
      const [a, b, c] = model.rows;
      this.assert(result.checked === 3 && result.updated === 1 && result.lapsed === 2 && result.errors === 0,
        'Refresh job reports checked/renewed/lapsed', JSON.stringify(result));
      this.assert(a.expiration_date > Date.now() + 29 * DAY && a.order_id.endsWith('..0'),
        'Renewal extends the stored expiry');
      this.assert(b.subscription_state === 'SUBSCRIPTION_STATE_EXPIRED' && b.expiration_date <= Date.now(),
        'Expired subscription stays lapsed');
      this.assert(c.subscription_state === 'TOKEN_INVALID', 'Token Google no longer knows is marked invalid');
      this.assert(['user-1', 'user-2', 'user-3'].every((u) => service.reconciledUsers.includes(u)),
        'Premium is reconciled for every refreshed user');
    });

    await this.withEnv({ TEST_MOCK_IAP: 'true' }, async () => {
      const skipped = await service.refreshAndroidSubscriptions();
      this.assert(skipped.skipped === true, 'Refresh job never runs under TEST_MOCK_IAP');
    });
  }

  async testEntitlementGraceAndLapsedStates() {
    this.log('🧪 Entitlement: renewal grace and lapsed states', 'section');
    const now = 1_700_000_000_000;
    const grace = AndroidSubscription.ENTITLEMENT_GRACE_MS;
    const base = {
      user_id: 'user-1',
      purchase_token: 'tok',
      order_id: 'GPA.1',
      expiration_date: now + 30 * DAY,
      subscription_state: 'SUBSCRIPTION_STATE_ACTIVE',
      last_verified_at: now - 60 * 60 * 1000
    };

    this.assert(AndroidSubscription.rowGrantsPremium({ ...base }, now),
      'Active subscription with time left grants premium');
    this.assert(AndroidSubscription.rowGrantsPremium({
      ...base,
      expiration_date: now - 30 * 60 * 1000
    }, now),
      'Verified subscription still grants premium in the 2h window after stored expiry');
    this.assert(!AndroidSubscription.rowGrantsPremium({
      ...base,
      expiration_date: now - grace - 1000
    }, now),
      'Premium ends once the grace window after stored expiry has passed');
    this.assert(!AndroidSubscription.rowGrantsPremium({
      ...base,
      expiration_date: now - 30 * 60 * 1000,
      last_verified_at: null
    }, now),
      'TEST_MOCK_IAP rows (never verified) do not get the renewal grace');

    for (const state of [
      'SUBSCRIPTION_STATE_ON_HOLD',
      'SUBSCRIPTION_STATE_PAUSED',
      'SUBSCRIPTION_STATE_EXPIRED',
      'SUPERSEDED',
      'TOKEN_INVALID',
      'UNKNOWN_PRODUCT'
    ]) {
      this.assert(!AndroidSubscription.rowGrantsPremium({
        ...base,
        subscription_state: state,
        expiration_date: now + 30 * DAY
      }, now),
        `${state} does not grant premium even if stored expiry is still in the future`);
    }

    this.assert(AndroidSubscription.rowGrantsPremium({
      ...base,
      subscription_state: 'SUBSCRIPTION_STATE_CANCELED',
      expiration_date: now + DAY
    }, now),
      'Canceled subscription with paid time left still grants premium');
  }

  async run() {
    this.log('🤖 Starting Google Play Receipt Verifier Unit Tests', 'section');
    try {
      await this.withEnv({
        GOOGLE_PLAY_PACKAGE_NAMES: undefined,
        GOOGLE_PLAY_PRODUCT_IDS: undefined,
        GOOGLE_PLAY_ALLOW_TEST_PURCHASES: undefined,
        TEST_MOCK_IAP: undefined
      }, async () => {
        await this.testParseServiceAccount();
        await this.testTokenExchangeAndCaching();
        await this.testVerifierErrorMapping();
        await this.testServiceAcceptsActiveSubscription();
        await this.testServiceRejections();
        await this.testServiceOwnership();
        await this.testServiceNotConfigured();
        await this.testRefreshJob();
        await this.testEntitlementGraceAndLapsedStates();
      });
    } catch (error) {
      this.log(`Unexpected failure: ${error.stack}`, 'fail');
      this.testResults.failed++;
      this.testResults.total++;
    }

    this.log(
      `Google Play receipt verifier tests: ${this.testResults.passed}/${this.testResults.total} passed`,
      this.testResults.failed === 0 ? 'pass' : 'fail'
    );
    return this.testResults.failed === 0;
  }
}

module.exports = GooglePlayReceiptVerifierTestRunner;

if (require.main === module) {
  const runner = new GooglePlayReceiptVerifierTestRunner();
  runner.run().then((success) => process.exit(success ? 0 : 1));
}
