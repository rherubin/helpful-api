const axios = require('axios');
const {
  isAccountLocked,
  recordFailedAttempt,
  clearFailedAttempts,
  getAccountLockInfo
} = require('../middleware/security');
const {
  StripeBillingService,
  PREMIUM_STATUSES
} = require('../services/StripeBillingService');
const { generateTestEmail } = require('./test-helpers');

/**
 * Fills urgent-area gaps that the existing suites do not cover:
 *   - Login lockout (unit + HTTP)
 *   - Admin JWT rejected on user routes
 *   - Logout invalidates the refresh token
 *   - token-info validation (non-production)
 *   - Stripe webhook signature / invoice.paid / invoice.payment_failed
 *
 * Run: node tests/urgent-gaps-test.js
 * Server: TEST_MOCK_*=true npm start  (required for the HTTP cases)
 */
class UrgentGapsTestRunner {
  constructor(options = {}) {
    this.baseURL = options.baseURL || process.env.TEST_BASE_URL || 'http://127.0.0.1:9000';
    this.timeout = options.timeout || 15000;
    this.testResults = { passed: 0, failed: 0, total: 0 };
    this.password = 'SecurePass987!';
  }

  log(message, type = 'info') {
    const prefix = {
      info: '📝', pass: '✅', fail: '❌', warn: '⚠️', section: '🧪', data: '💾'
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

  authHeader(token) {
    return { headers: { Authorization: `Bearer ${token}` }, timeout: this.timeout, validateStatus: () => true };
  }

  async request(method, path, { token, body, headers, raw } = {}) {
    const cfg = {
      method,
      url: `${this.baseURL}${path}`,
      timeout: this.timeout,
      validateStatus: () => true,
      headers: { ...(headers || {}) }
    };
    if (token) cfg.headers.Authorization = `Bearer ${token}`;
    if (raw !== undefined) {
      cfg.data = raw;
      cfg.transformRequest = [(data) => data];
    } else if (body !== undefined) {
      cfg.data = body;
    }
    return axios(cfg);
  }

  async createUser(prefix) {
    const email = generateTestEmail(prefix);
    const res = await this.request('POST', '/api/users', {
      body: { email, password: this.password }
    });
    if (![200, 201].includes(res.status) || !res.data?.access_token) {
      throw new Error(`createUser failed: status=${res.status} body=${JSON.stringify(res.data)}`);
    }
    return {
      ...res.data.user,
      email,
      password: this.password,
      token: res.data.access_token,
      refresh_token: res.data.refresh_token
    };
  }

  // ─────────────────────────────────────────────
  // Unit: in-process lockout maps (not the server)
  // ─────────────────────────────────────────────
  testLockoutUnit() {
    this.log('Login lockout unit helpers', 'section');
    const email = `unit-lockout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

    this.assert(!isAccountLocked(email), 'New email is not locked');

    for (let i = 1; i <= 4; i++) {
      const locked = recordFailedAttempt(email);
      this.assert(locked === false, `Attempt ${i} does not lock yet`);
    }
    this.assert(!isAccountLocked(email), 'Still unlocked after 4 failures');

    const fifthLocks = recordFailedAttempt(email);
    this.assert(fifthLocks === true, 'Fifth failure returns locked=true');
    this.assert(isAccountLocked(email), 'isAccountLocked is true after threshold');

    const info = getAccountLockInfo(email);
    this.assert(info && info.attemptCount >= 5, 'lockInfo includes attemptCount', `info=${JSON.stringify(info)}`);
    this.assert(info.remainingTime > 0, 'lockInfo includes remainingTime', `remaining=${info.remainingTime}`);

    clearFailedAttempts(email);
    this.assert(!isAccountLocked(email), 'clearFailedAttempts unlocks the account');
  }

  // ─────────────────────────────────────────────
  // HTTP: 5 failed logins lock the account
  // ─────────────────────────────────────────────
  async testLockoutHttp() {
    this.log('POST /api/login lockout', 'section');

    const missing = await this.request('POST', '/api/login', { body: {} });
    this.assert(missing.status === 400, 'Login without email/password → 400', `status=${missing.status}`);
    this.assert(
      typeof missing.data?.error === 'string' && /email and password/i.test(missing.data.error),
      'Login validation error mentions email and password',
      `error=${missing.data?.error}`
    );

    const user = await this.createUser('lockout-http');

    let lastFailure;
    for (let i = 1; i <= 4; i++) {
      lastFailure = await this.request('POST', '/api/login', {
        body: { email: user.email, password: 'WrongPassword1!' }
      });
      this.assert(
        lastFailure.status === 401,
        `Failed login ${i} → 401`,
        `status=${lastFailure.status}`
      );
      this.assert(
        lastFailure.data?.error === 'Invalid email or password',
        `Failed login ${i} uses generic error (no user enumeration)`,
        `error=${lastFailure.data?.error}`
      );
    }

    const fifth = await this.request('POST', '/api/login', {
      body: { email: user.email, password: 'WrongPassword1!' }
    });
    this.assert(fifth.status === 423, 'Fifth failed login → 423 locked', `status=${fifth.status}`);
    this.assert(
      typeof fifth.data?.error === 'string' && /locked/i.test(fifth.data.error),
      'Fifth failure error mentions lock',
      `error=${fifth.data?.error}`
    );
    this.assert(
      fifth.data?.lockInfo && typeof fifth.data.lockInfo.remainingTime === 'number',
      '423 body includes lockInfo.remainingTime',
      `lockInfo=${JSON.stringify(fifth.data?.lockInfo)}`
    );

    const evenCorrect = await this.request('POST', '/api/login', {
      body: { email: user.email, password: user.password }
    });
    this.assert(
      evenCorrect.status === 423,
      'Correct password is also rejected while locked',
      `status=${evenCorrect.status}`
    );
    this.assert(
      evenCorrect.data?.error === 'Account temporarily locked due to too many failed attempts',
      'Already-locked message is the pre-check wording',
      `error=${evenCorrect.data?.error}`
    );
  }

  async testLogoutInvalidatesRefresh() {
    this.log('POST /api/logout', 'section');

    const noToken = await this.request('POST', '/api/logout', { body: {} });
    this.assert(noToken.status === 400, 'Logout without refresh_token → 400', `status=${noToken.status}`);

    const user = await this.createUser('logout-http');
    const logout = await this.request('POST', '/api/logout', {
      body: { refresh_token: user.refresh_token }
    });
    this.assert(logout.status === 200, 'Logout with refresh_token → 200', `status=${logout.status}`);
    this.assert(
      typeof logout.data?.message === 'string' && /logged out/i.test(logout.data.message),
      'Logout body confirms success',
      `message=${logout.data?.message}`
    );

    const reuse = await this.request('POST', '/api/refresh', {
      body: { refresh_token: user.refresh_token }
    });
    this.assert(reuse.status === 401, 'Refresh after logout → 401', `status=${reuse.status}`);
  }

  async testTokenInfo() {
    this.log('POST /api/token-info (non-production)', 'section');

    const missing = await this.request('POST', '/api/token-info', { body: {} });
    this.assert(missing.status === 400, 'token-info without token → 400', `status=${missing.status}`);

    const invalid = await this.request('POST', '/api/token-info', {
      body: { access_token: 'not-a-jwt' }
    });
    this.assert(invalid.status === 400, 'token-info with garbage token → 400', `status=${invalid.status}`);

    const user = await this.createUser('token-info');
    const info = await this.request('POST', '/api/token-info', {
      body: { access_token: user.token }
    });
    this.assert(info.status === 200, 'token-info with valid token → 200', `status=${info.status}`);
    this.assert(
      info.data?.user_email === user.email && info.data?.user_id === user.id,
      'token-info returns this user id and email',
      `id=${info.data?.user_id} email=${info.data?.user_email}`
    );
    this.assert(info.data?.is_expired === false, 'token-info reports the access token is not expired');
    this.assert(typeof info.data?.expires_at === 'string', 'token-info includes expires_at');
  }

  async testAdminJwtRejectedOnUserRoutes() {
    this.log('Admin JWT on user routes', 'section');

    const adminEmail = generateTestEmail('admin-jwt-gap');
    const register = await this.request('POST', '/api/admin/auth/register', {
      body: { email: adminEmail, password: this.password }
    });
    this.assert(
      [200, 201].includes(register.status),
      'Admin register in mock/CI env succeeds so we can obtain a token',
      `status=${register.status}`
    );
    const login = await this.request('POST', '/api/admin/auth/login', {
      body: { email: adminEmail, password: this.password }
    });
    this.assert(login.status === 200 && login.data?.access_token, 'Admin login → 200 with access_token');
    const adminToken = login.data?.access_token;
    const profile = await this.request('GET', '/api/profile', { token: adminToken });
    this.assert(profile.status === 403, 'Admin JWT on GET /api/profile → 403', `status=${profile.status}`);

    const pairing = await this.request('POST', '/api/pairing/request', { token: adminToken, body: {} });
    this.assert(pairing.status === 403, 'Admin JWT on POST /api/pairing/request → 403', `status=${pairing.status}`);

    // Create a regular user, then try to read them with the admin user-token
    const user = await this.createUser('admin-jwt-target');
    const other = await this.request('GET', `/api/users/${user.id}`, { token: adminToken });
    this.assert(
      [401, 403].includes(other.status),
      'Admin JWT on GET /api/users/:id is denied',
      `status=${other.status}`
    );

    const sessions = await this.request('GET', '/api/prompt-sessions', { token: adminToken });
    this.assert(
      sessions.status === 403,
      'Admin JWT on GET /api/prompt-sessions → 403',
      `status=${sessions.status}`
    );

    // Confirm a real user token still works, so the denials are type-based
    const userProfile = await this.request('GET', '/api/profile', { token: user.token });
    this.assert(userProfile.status === 200, 'User JWT still reaches /api/profile', `status=${userProfile.status}`);
    this.assert(
      userProfile.data?.profile?.id === user.id,
      'User profile is the expected account',
      `id=${userProfile.data?.profile?.id}`
    );
  }

  postWebhook(event, { signature = 't=mock,v1=mock' } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (signature !== null) headers['stripe-signature'] = signature;
    return this.request('POST', '/api/billing/webhook', {
      raw: JSON.stringify(event),
      headers
    });
  }

  buildSubscriptionObject(user, { id, status = 'trialing', plan = 'yearly' } = {}) {
    const subId = id || `sub_gap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      id: subId,
      status,
      items: { data: [{ price: { id: process.env.STRIPE_PRICE_YEARLY || 'price_mock_yearly' } }] },
      trial_end: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
      current_period_end: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
      cancel_at_period_end: status === 'canceled',
      metadata: { user_id: user.id, plan },
      customer: `cus_gap_webhook_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    };
  }

  async testWebhookSignatureAndInvoiceEvents() {
    this.log('Stripe webhook signature + invoice events', 'section');

    const missingSig = await this.request('POST', '/api/billing/webhook', {
      raw: JSON.stringify({ type: 'ping' }),
      headers: { 'Content-Type': 'application/json' }
    });
    this.assert(missingSig.status === 400, 'Webhook without stripe-signature → 400', `status=${missingSig.status}`);
    this.assert(
      typeof missingSig.data?.error === 'string' && /stripe-signature/i.test(missingSig.data.error),
      'Missing-signature error mentions the header',
      `error=${missingSig.data?.error}`
    );

    // postWebhook JSON.stringify's its argument, so send a raw invalid body instead
    const badRaw = await this.request('POST', '/api/billing/webhook', {
      raw: '{not json',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=mock,v1=mock' }
    });
    this.assert(badRaw.status === 400, 'Webhook with invalid JSON → 400', `status=${badRaw.status}`);

    const unknown = await this.postWebhook({
      id: `evt_unknown_${Date.now()}`,
      type: 'charge.refunded',
      data: { object: { id: 'ch_test' } }
    });
    this.assert(unknown.status === 200, 'Unhandled event type is accepted (200)', `status=${unknown.status}`);
    this.assert(unknown.data?.received === true, 'Unhandled event body is { received: true }');

    const invoiceNoSub = await this.postWebhook({
      id: `evt_inv_nosub_${Date.now()}`,
      type: 'invoice.paid',
      data: { object: { id: 'in_nosub', subscription: null } }
    });
    this.assert(invoiceNoSub.status === 200, 'invoice.paid without subscription → 200 (no-op)', `status=${invoiceNoSub.status}`);

    const user = await this.createUser('invoice-wh');
    const sub = this.buildSubscriptionObject(user);
    const checkout = await this.postWebhook({
      id: `evt_cs_${Date.now()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_gap_${Date.now()}`,
          mode: 'subscription',
          client_reference_id: user.id,
          customer: sub.customer,
          metadata: { user_id: user.id, plan: 'yearly' },
          subscription: sub
        }
      }
    });
    this.assert(checkout.status === 200, 'checkout.session.completed setup → 200', `status=${checkout.status} body=${JSON.stringify(checkout.data)}`);

    const statusAfterCheckout = await this.request('GET', '/api/billing/status', { token: user.token });
    this.assert(
      statusAfterCheckout.status === 200 && statusAfterCheckout.data?.premium === true,
      'User is premium after checkout.session.completed',
      `premium=${statusAfterCheckout.data?.premium} body=${JSON.stringify(statusAfterCheckout.data)}`
    );

    const paid = await this.postWebhook({
      id: `evt_inv_paid_${Date.now()}`,
      type: 'invoice.paid',
      data: { object: { id: 'in_paid', subscription: sub.id } }
    });
    this.assert(paid.status === 200, 'invoice.paid → 200', `status=${paid.status}`);

    // Mock retrieve() always returns trialing and empty metadata, but
    // resolveUserIdFromSubscription still maps via the existing row id, so
    // this must not drop premium or 500.
    const statusAfterPaid = await this.request('GET', '/api/billing/status', { token: user.token });
    this.assert(
      statusAfterPaid.status === 200 && statusAfterPaid.data?.premium === true,
      'invoice.paid leaves the user premium',
      `premium=${statusAfterPaid.data?.premium}`
    );

    const failed = await this.postWebhook({
      id: `evt_inv_fail_${Date.now()}`,
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_fail', subscription: sub.id } }
    });
    this.assert(failed.status === 200, 'invoice.payment_failed → 200', `status=${failed.status}`);

    // Replay the same invoice.paid event: handler must stay idempotent (200, still premium).
    const replay = await this.postWebhook({
      id: `evt_inv_paid_${Date.now()}_replay`,
      type: 'invoice.paid',
      data: { object: { id: 'in_paid', subscription: sub.id } }
    });
    this.assert(replay.status === 200, 'Replayed invoice.paid → 200', `status=${replay.status}`);
    const statusAfterReplay = await this.request('GET', '/api/billing/status', { token: user.token });
    this.assert(
      statusAfterReplay.data?.premium === true,
      'Replayed invoice.paid is idempotent (still premium)'
    );
  }

  async testInvoiceHandlersUnit() {
    this.log('Stripe invoice handlers (unit, injected Stripe client)', 'section');

    const users = new Map();
    const subs = new Map();
    const userId = 'user_gap_invoice';
    users.set(userId, { id: userId, is_premium: false, deleted_at: null, stripe_customer_id: 'cus_gap_1' });

    const userModel = {
      async getUserByIdIncludingDeleted(id) { return users.get(id) || null; },
      async getUserById(id) { return users.get(id) || null; },
      async getUserByStripeCustomerIdIncludingDeleted(customerId) {
        return [...users.values()].find((u) => u.stripe_customer_id === customerId) || null;
      },
      async setIsPremium(id, value) {
        if (!users.has(id)) throw new Error('unknown user');
        users.get(id).is_premium = !!value;
      }
    };

    const stripeSubscriptionModel = {
      async getByStripeSubscriptionId(id) { return subs.get(id) || null; },
      async getActiveForUser(id) {
        return [...subs.values()].find((s) => s.user_id === id && PREMIUM_STATUSES.has(s.status)) || null;
      },
      async upsertByStripeSubscriptionId(uid, data) {
        const row = { user_id: uid, ...data };
        subs.set(data.stripe_subscription_id, row);
        return row;
      }
    };

    const live = {
      id: 'sub_gap_unit',
      status: 'past_due',
      items: { data: [{ price: { id: 'price_mock_yearly' } }] },
      trial_end: null,
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
      cancel_at_period_end: false,
      metadata: { user_id: userId, plan: 'yearly' },
      customer: 'cus_gap_1'
    };

    const stripeClient = {
      subscriptions: {
        retrieve: async (id) => {
          if (id !== live.id) throw new Error(`unexpected retrieve ${id}`);
          return { ...live };
        }
      }
    };

    const service = new StripeBillingService(userModel, stripeSubscriptionModel, {
      stripeClient,
      useMock: true
    });

    // Seed an active subscription, then invoice.payment_failed retrieves past_due.
    await stripeSubscriptionModel.upsertByStripeSubscriptionId(userId, {
      stripe_subscription_id: live.id,
      stripe_price_id: 'price_mock_yearly',
      plan: 'yearly',
      status: 'active',
      trial_end: null,
      current_period_end: live.current_period_end,
      cancel_at_period_end: false
    });
    await userModel.setIsPremium(userId, true);

    live.status = 'past_due';
    const failedRow = await service.handleInvoicePaymentFailed({
      id: 'in_unit_fail',
      subscription: live.id
    });
    this.assert(failedRow && failedRow.status === 'past_due',
      'invoice.payment_failed persists past_due',
      `status=${failedRow?.status}`);
    this.assert(users.get(userId).is_premium === false,
      'past_due from invoice.payment_failed clears premium');

    live.status = 'active';
    const paidRow = await service.handleInvoicePaid({
      id: 'in_unit_paid',
      subscription: live.id
    });
    this.assert(paidRow && paidRow.status === 'active',
      'invoice.paid persists active',
      `status=${paidRow?.status}`);
    this.assert(users.get(userId).is_premium === true,
      'invoice.paid restores premium');

    // Object-form subscription id still works (Stripe sometimes expands it).
    const again = await service.handleInvoicePaid({
      id: 'in_unit_paid_obj',
      subscription: { id: live.id }
    });
    this.assert(again && again.status === 'active', 'invoice.paid accepts subscription as object');

    const noSub = await service.handleInvoicePaid({ id: 'in_none', subscription: null });
    this.assert(noSub === null, 'invoice.paid with no subscription id is a no-op');
  }

  async testHealthAndDiagnostics() {
    this.log('GET /health and /health/diagnostics', 'section');
    const health = await this.request('GET', '/health');
    this.assert(health.status === 200, 'GET /health → 200', `status=${health.status}`);
    const diagnostics = await this.request('GET', '/health/diagnostics');
    this.assert(diagnostics.status === 200, 'GET /health/diagnostics → 200', `status=${diagnostics.status}`);
    this.assert(
      diagnostics.data?.ok === true,
      'diagnostics body is { ok: true } and does not list mock flags',
      `body=${JSON.stringify(diagnostics.data)}`
    );
    const diagKeys = Object.keys(diagnostics.data || {});
    this.assert(
      diagKeys.length === 1 && diagKeys[0] === 'ok',
      'diagnostics only returns ok, with no mock-flag fields',
      `keys=${diagKeys.join(',')}`
    );
    // Production must not leak TEST_MOCK flags as actionable config; in CI they
    // may appear. Just assert no secrets.
    const blob = JSON.stringify(diagnostics.data || {});
    this.assert(
      !/sk_live_|rk_live_|BEGIN PRIVATE KEY|helpful_ci_root|JWT_SECRET/i.test(blob),
      'diagnostics body does not leak secrets'
    );
  }

  async runAllTests() {
    this.log('Urgent coverage gaps', 'section');
    this.testResults = { passed: 0, failed: 0, total: 0 };

    try {
      this.testLockoutUnit();
      await this.testLockoutHttp();
      await this.testLogoutInvalidatesRefresh();
      await this.testTokenInfo();
      await this.testAdminJwtRejectedOnUserRoutes();
      await this.testWebhookSignatureAndInvoiceEvents();
      await this.testInvoiceHandlersUnit();
      await this.testHealthAndDiagnostics();
    } catch (error) {
      this.assert(false, 'Urgent gaps suite crashed', error.stack || error.message);
    }

    const success = this.testResults.failed === 0;
    this.log(
      `Urgent gaps: ${this.testResults.passed}/${this.testResults.total} passed, ${this.testResults.failed} failed`,
      success ? 'pass' : 'fail'
    );
    return success;
  }
}

async function main() {
  const runner = new UrgentGapsTestRunner();
  const success = await runner.runAllTests();
  process.exit(success ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = UrgentGapsTestRunner;
