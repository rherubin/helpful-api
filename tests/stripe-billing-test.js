const axios = require('axios');
const { generateTestEmail } = require('./test-helpers');

/**
 * Stripe Billing Endpoint Test Suite
 * Tests /api/billing/* against the mock Stripe client (no real Stripe keys required).
 *
 * Endpoints:
 *   POST /api/billing/checkout
 *   POST /api/billing/portal
 *   GET  /api/billing/status
 *   POST /api/billing/webhook
 *
 * Run with: node tests/stripe-billing-test.js
 * Server should be started with TEST_MOCK_STRIPE=true (required for mock webhooks).
 */
class StripeBillingTestRunner {
  constructor(options = {}) {
    this.baseURL = options.baseURL || 'http://127.0.0.1:9000';
    this.timeout = options.timeout || 10000;
    this.keepData = process.argv.includes('--__keep-data');
    this.testResults = { passed: 0, failed: 0, total: 0 };
    this.testData = { users: [] };
  }

  log(message, type = 'info') {
    const prefix = { info: '📝', pass: '✅', fail: '❌', warn: '⚠️', section: '🧪', data: '💾' }[type] || '📝';
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

  async createTestUser(prefix = 'stripe-billing-test') {
    const email = generateTestEmail(prefix);
    try {
      const response = await axios.post(`${this.baseURL}/api/users`, {
        email,
        password: 'SecurePass987!'
      }, { timeout: this.timeout });

      const user = {
        ...response.data.user,
        email,
        token: response.data.access_token
      };
      this.testData.users.push(user);
      this.log(`Created test user: ${email}`, 'data');
      return user;
    } catch (error) {
      this.log(`Failed to create test user: ${error.response?.data?.error || error.message}`, 'fail');
      return null;
    }
  }

  async testCheckoutRequiresAuth() {
    this.log('Testing checkout requires auth', 'section');
    try {
      await axios.post(`${this.baseURL}/api/billing/checkout`, { plan: 'yearly' }, {
        timeout: this.timeout,
        validateStatus: () => true
      }).then((res) => {
        this.assert(res.status === 401, 'Checkout without token returns 401');
      });
    } catch (error) {
      this.assert(false, 'Checkout without token', error.message);
    }
  }

  async testCheckoutValidation(user) {
    this.log('Testing checkout plan validation', 'section');
    try {
      const res = await axios.post(`${this.baseURL}/api/billing/checkout`, { plan: 'lifetime' }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout,
        validateStatus: () => true
      });
      this.assert(res.status === 400, 'Invalid plan returns 400', `status=${res.status}`);
    } catch (error) {
      this.assert(false, 'Invalid plan validation', error.message);
    }
  }

  async testCheckoutCreatesSession(user) {
    this.log('Testing checkout session creation', 'section');
    try {
      const res = await axios.post(`${this.baseURL}/api/billing/checkout`, {
        plan: 'yearly',
        success_url: 'http://localhost:3000/get-started?billing=success',
        cancel_url: 'http://localhost:3000/get-started?billing=cancel'
      }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });

      this.assert(res.status === 200, 'Checkout returns 200');
      this.assert(typeof res.data.url === 'string' && res.data.url.includes('http'), 'Checkout returns url', res.data.url);
      this.assert(res.data.plan === 'yearly', 'Checkout echoes plan');
      this.assert(!!res.data.session_id, 'Checkout returns session_id');
      return res.data;
    } catch (error) {
      this.assert(false, 'Checkout session creation', error.response?.data?.error || error.message);
      return null;
    }
  }

  async testSetupIntentCreatesClientSecret(user) {
    this.log('Testing in-app setup intent (Payment Element)', 'section');
    // Use a fresh user so an active sub from earlier tests does not 409.
    const intentUser = await this.createTestUser('stripe-intent');
    if (!intentUser) {
      this.assert(false, 'Create setup-intent test user');
      return null;
    }
    try {
      const res = await axios.post(`${this.baseURL}/api/billing/setup-intent`, {}, {
        headers: { Authorization: `Bearer ${intentUser.token}` },
        timeout: this.timeout
      });

      this.assert(res.status === 200, 'Setup intent returns 200');
      this.assert(
        typeof res.data.client_secret === 'string' && res.data.client_secret.length > 0,
        'Returns client_secret',
        res.data.client_secret
      );
      return { user: intentUser, ...res.data };
    } catch (error) {
      this.assert(false, 'Setup intent creation', error.response?.data?.error || error.message);
      return null;
    }
  }

  // The core regression test for the "trial starts before payment info"
  // bug: merely creating a SetupIntent (analogous to account creation) must
  // not start a trial or grant premium. Only /subscribe, called after the
  // SetupIntent is confirmed, may do that — and its trial_end must be
  // computed from that call, not from any earlier point in the flow.
  async testTrialOnlyStartsAfterSubscribeConfirmed() {
    this.log('Testing trial only starts after /subscribe, not at setup-intent', 'section');
    const user = await this.createTestUser('stripe-trial-timing');
    if (!user) {
      this.assert(false, 'Create trial-timing test user');
      return;
    }

    try {
      const setupRes = await axios.post(`${this.baseURL}/api/billing/setup-intent`, {}, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(setupRes.status === 200, 'Setup intent returns 200');
      const setupIntentId = setupRes.data.client_secret.split('_secret')[0];

      const statusBeforeSubscribe = await axios.get(`${this.baseURL}/api/billing/status`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(
        statusBeforeSubscribe.data.premium === false,
        'No trial/premium from setup-intent alone',
        `premium=${statusBeforeSubscribe.data.premium}`
      );

      const beforeSubscribe = Math.floor(Date.now() / 1000);
      const subscribeRes = await axios.post(`${this.baseURL}/api/billing/subscribe`, {
        plan: 'yearly',
        setup_intent_id: setupIntentId
      }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(subscribeRes.status === 200, 'Subscribe returns 200',
        JSON.stringify(subscribeRes.data));
      this.assert(subscribeRes.data.status === 'trialing', 'Subscribe returns trialing status',
        subscribeRes.data.status);
      this.assert(!!subscribeRes.data.subscription_id, 'Subscribe returns subscription_id');

      const expectedTrialEnd = beforeSubscribe + 7 * 24 * 3600;
      this.assert(
        Math.abs(subscribeRes.data.trial_end - expectedTrialEnd) < 60,
        'trial_end is ~7 days from the /subscribe call, not from setup-intent',
        `trial_end=${subscribeRes.data.trial_end} expected~${expectedTrialEnd}`
      );

      const statusAfterSubscribe = await axios.get(`${this.baseURL}/api/billing/status`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(
        statusAfterSubscribe.data.subscription?.status === 'trialing',
        'Status reflects trialing immediately after /subscribe (mock has no webhook lag)',
        statusAfterSubscribe.data.subscription?.status
      );
    } catch (error) {
      this.assert(
        false,
        'Trial only starts after subscribe confirmed',
        error.response?.data?.error || error.message
      );
    }
  }

  async testStatusBeforeWebhook(user) {
    this.log('Testing billing status before webhook', 'section');
    try {
      const res = await axios.get(`${this.baseURL}/api/billing/status`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(res.status === 200, 'Status returns 200');
      this.assert(res.data.premium === false || res.data.subscription == null, 'No active subscription yet',
        `premium=${res.data.premium}`);
      return res.data;
    } catch (error) {
      this.assert(false, 'Billing status', error.response?.data?.error || error.message);
      return null;
    }
  }

  async postWebhook(event) {
    return axios.post(
      `${this.baseURL}/api/billing/webhook`,
      JSON.stringify(event),
      {
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 't=mock,v1=mock'
        },
        timeout: this.timeout,
        transformRequest: [(data) => data],
        validateStatus: () => true
      }
    );
  }

  buildSubscriptionObject(user, { id, status = 'trialing', plan = 'yearly' } = {}) {
    const subId = id || `sub_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      id: subId,
      status,
      items: {
        data: [{ price: { id: process.env.STRIPE_PRICE_YEARLY || 'price_mock_yearly' } }]
      },
      trial_end: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
      current_period_end: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
      cancel_at_period_end: status === 'canceled',
      metadata: { user_id: user.id, plan },
      customer: 'cus_test_webhook'
    };
  }

  async testWebhookCheckoutCompleted(user) {
    this.log('Testing checkout.session.completed webhook', 'section');
    this.lastSubscriptionId = `sub_test_${Date.now()}`;
    const event = {
      id: `evt_test_${Date.now()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_test_${Date.now()}`,
          mode: 'subscription',
          client_reference_id: user.id,
          customer: null,
          metadata: { user_id: user.id, plan: 'yearly' },
          subscription: this.buildSubscriptionObject(user, { id: this.lastSubscriptionId })
        }
      }
    };

    try {
      const res = await this.postWebhook(event);
      this.assert(res.status === 200, 'Webhook returns 200', JSON.stringify(res.data));
    } catch (error) {
      this.assert(false, 'Webhook checkout.session.completed', error.response?.data?.error || error.message);
    }
  }

  async testStatusAfterWebhook(user) {
    this.log('Testing billing status after webhook', 'section');
    try {
      const res = await axios.get(`${this.baseURL}/api/billing/status`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(res.status === 200, 'Status returns 200 after webhook');
      this.assert(res.data.premium === true, 'User is premium after webhook');
      this.assert(res.data.subscription?.status === 'trialing', 'Subscription status is trialing',
        res.data.subscription?.status);
      this.assert(res.data.subscription?.plan === 'yearly', 'Subscription plan is yearly');
    } catch (error) {
      this.assert(false, 'Billing status after webhook', error.response?.data?.error || error.message);
    }
  }

  async testPortalSession(user) {
    this.log('Testing customer portal session', 'section');
    try {
      // Portal requires stripe_customer_id — created by the earlier checkout session.
      const res = await axios.post(`${this.baseURL}/api/billing/portal`, {
        return_url: 'http://localhost:3000/get-started?flow=subscription'
      }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(res.status === 200, 'Portal returns 200');
      this.assert(typeof res.data.url === 'string' && res.data.url.includes('http'), 'Portal returns url');
    } catch (error) {
      this.assert(false, 'Portal session', error.response?.data?.error || error.message);
    }
  }

  async testRejectedReturnOrigin(user) {
    this.log('Testing disallowed return URL origin', 'section');
    try {
      const res = await axios.post(`${this.baseURL}/api/billing/checkout`, {
        plan: 'yearly',
        success_url: 'https://evil.example/phish',
        cancel_url: 'https://evil.example/phish'
      }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout,
        validateStatus: () => true
      });
      this.assert(res.status === 400, 'Disallowed origin returns 400', `status=${res.status}`);
    } catch (error) {
      this.assert(false, 'Disallowed origin check', error.message);
    }
  }

  // Org / custom-org premium must survive Stripe cancel — syncPremiumForUser used to
  // set is_premium solely from Stripe and wipe org-granted premium.
  async testOrgPremiumSurvivesStripeCancel() {
    this.log('Testing org premium survives Stripe subscription cancel', 'section');
    const user = await this.createTestUser('stripe-billing-org-premium');
    if (!user) {
      this.assert(false, 'Create org-premium billing test user');
      return;
    }

    try {
      const orgRes = await axios.put(`${this.baseURL}/api/users/${user.id}`, {
        org_name: 'Stripe Test Church',
        org_city: 'Springfield',
        org_state: 'IL'
      }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(orgRes.status === 200, 'Custom org update returns 200');
      this.assert(orgRes.data.user.premium === true, 'Custom org grants premium before Stripe');

      const subId = `sub_org_preserve_${Date.now()}`;
      const activate = await this.postWebhook({
        id: `evt_org_act_${Date.now()}`,
        type: 'checkout.session.completed',
        data: {
          object: {
            id: `cs_org_${Date.now()}`,
            mode: 'subscription',
            client_reference_id: user.id,
            customer: null,
            metadata: { user_id: user.id, plan: 'yearly' },
            subscription: this.buildSubscriptionObject(user, { id: subId, status: 'trialing' })
          }
        }
      });
      this.assert(activate.status === 200, 'Activate webhook returns 200');

      const cancel = await this.postWebhook({
        id: `evt_org_cancel_${Date.now()}`,
        type: 'customer.subscription.deleted',
        data: {
          object: this.buildSubscriptionObject(user, { id: subId, status: 'canceled' })
        }
      });
      this.assert(cancel.status === 200, 'Cancel webhook returns 200');

      const statusRes = await axios.get(`${this.baseURL}/api/billing/status`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(statusRes.status === 200, 'Billing status after cancel returns 200');
      this.assert(
        statusRes.data.premium === true,
        'Org premium preserved after Stripe cancel',
        `premium=${statusRes.data.premium} is_premium=${statusRes.data.is_premium} sub=${statusRes.data.subscription?.status}`
      );
      this.assert(
        statusRes.data.is_premium === true,
        'users.is_premium remains true after Stripe cancel when org-entitled'
      );

      // GET /api/users/:id returns the user object at the top level (not nested).
      const profileRes = await axios.get(`${this.baseURL}/api/users/${user.id}`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(profileRes.status === 200, 'User profile returns 200 after Stripe cancel');
      this.assert(
        profileRes.data.premium === true,
        'User profile still reports premium after Stripe cancel',
        `premium=${profileRes.data.premium}`
      );
    } catch (error) {
      this.assert(false, 'Org premium survives Stripe cancel', error.response?.data?.error || error.message);
    }
  }

  /**
   * Incomplete custom-org profile updates must not wipe Stripe-granted premium.
   * Trigger: Stripe trialing user PUTs only org_name → previously forced is_premium=false.
   */
  async testStripePremiumSurvivesIncompleteCustomOrg(user) {
    this.log('Testing Stripe premium survives incomplete custom org update', 'section');
    try {
      const updateRes = await axios.put(
        `${this.baseURL}/api/users/${user.id}`,
        { org_name: 'Stripe Survivor Org' },
        {
          headers: { Authorization: `Bearer ${user.token}` },
          timeout: this.timeout
        }
      );
      this.assert(updateRes.status === 200, 'Incomplete custom org update returns 200');
      this.assert(
        updateRes.data.user.premium === true,
        'Profile premium remains true after incomplete custom org',
        `premium=${updateRes.data.user.premium}`
      );

      const statusRes = await axios.get(`${this.baseURL}/api/billing/status`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(
        statusRes.data.premium === true,
        'Billing status still premium after incomplete custom org',
        `premium=${statusRes.data.premium}`
      );
    } catch (error) {
      this.assert(
        false,
        'Stripe premium survives incomplete custom org',
        error.response?.data?.error || error.message
      );
    }
  }

  // Active/trialing subscribers must not open another Checkout (double-charge).
  async testCheckoutBlockedWhenSubscriptionActive(user) {
    this.log('Testing checkout blocked while subscription active', 'section');
    try {
      const res = await axios.post(`${this.baseURL}/api/billing/checkout`, {
        plan: 'monthly',
        success_url: 'http://localhost:3000/get-started?billing=success',
        cancel_url: 'http://localhost:3000/get-started?billing=cancel'
      }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout,
        validateStatus: () => true
      });
      this.assert(res.status === 409, 'Active subscription blocks checkout with 409',
        `status=${res.status} error=${res.data?.error}`);
      this.assert(
        typeof res.data?.error === 'string' && /billing portal/i.test(res.data.error),
        'Error points user to billing portal',
        res.data?.error
      );
    } catch (error) {
      this.assert(false, 'Checkout blocked when active', error.message);
    }
  }

  // Second Checkout before webhook must 409 — local stripe_subscriptions is still
  // empty, but an open Checkout session already exists for the customer.
  async testCheckoutBlockedWhileSessionOpen(user) {
    this.log('Testing checkout blocked while prior Checkout session still open', 'section');
    try {
      const res = await axios.post(`${this.baseURL}/api/billing/checkout`, {
        plan: 'monthly',
        success_url: 'http://localhost:3000/get-started?billing=success',
        cancel_url: 'http://localhost:3000/get-started?billing=cancel'
      }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout,
        validateStatus: () => true
      });
      this.assert(res.status === 409, 'Open checkout session blocks second checkout with 409',
        `status=${res.status} error=${res.data?.error}`);
      this.assert(
        typeof res.data?.error === 'string' && /already open/i.test(res.data.error),
        'Error mentions open checkout session',
        res.data?.error
      );
    } catch (error) {
      this.assert(false, 'Checkout blocked while session open', error.message);
    }
  }

  // Login must report premium for Stripe/org entitlement (users.is_premium), not
  // only pairing.premium — otherwise web subscribers look free after login.
  async testLoginReportsStripePremium(user) {
    this.log('Testing login reports Stripe premium', 'section');
    try {
      const loginRes = await axios.post(`${this.baseURL}/api/login`, {
        email: user.email,
        password: 'SecurePass987!'
      }, { timeout: this.timeout });
      this.assert(loginRes.status === 200, 'Login returns 200 after Stripe premium');
      this.assert(
        loginRes.data?.data?.user?.premium === true,
        'Login premium is true for Stripe subscriber',
        `premium=${loginRes.data?.data?.user?.premium}`
      );
      this.assert(
        loginRes.data?.data?.user?.bypass_password === undefined,
        'Login does not leak bypass_password'
      );
      this.assert(
        loginRes.data?.data?.user?.is_premium === undefined,
        'Login does not expose raw is_premium column'
      );
    } catch (error) {
      this.assert(false, 'Login reports Stripe premium', error.response?.data?.error || error.message);
    }
  }

  /**
   * Soft-delete must cancel active Stripe subscriptions and clear is_premium.
   * Previously soft-delete left Stripe billing intact and webhook sync threw on
   * getUserById (deleted_at set), so restores could keep free premium / miss paid premium.
   */
  async testSoftDeleteCancelsStripeAndWebhookSyncWhileDeleted() {
    this.log('Testing soft-delete cancels Stripe + webhook sync while deleted', 'section');
    const user = await this.createTestUser('stripe-billing-softdelete');
    if (!user) {
      this.assert(false, 'Create soft-delete billing test user');
      return;
    }

    try {
      const subId = `sub_softdelete_${Date.now()}`;
      const customerId = `cus_sd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const activate = await this.postWebhook({
        id: `evt_sd_act_${Date.now()}`,
        type: 'checkout.session.completed',
        data: {
          object: {
            id: `cs_sd_${Date.now()}`,
            mode: 'subscription',
            client_reference_id: user.id,
            customer: customerId,
            metadata: { user_id: user.id, plan: 'yearly' },
            subscription: this.buildSubscriptionObject(user, {
              id: subId,
              status: 'trialing',
              customer: customerId
            })
          }
        }
      });
      this.assert(
        activate.status === 200,
        'Activate webhook before soft-delete returns 200',
        `status=${activate.status} body=${JSON.stringify(activate.data)}`
      );

      const preStatus = await axios.get(`${this.baseURL}/api/billing/status`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(preStatus.data.premium === true, 'User is premium before soft-delete');

      const delRes = await axios.delete(`${this.baseURL}/api/users/${user.id}`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(delRes.status === 200, 'Soft-delete returns 200');
      this.assert(
        Array.isArray(delRes.data.canceled_stripe_subscriptions)
          && delRes.data.canceled_stripe_subscriptions.includes(subId),
        'Soft-delete cancels the active Stripe subscription id',
        JSON.stringify(delRes.data.canceled_stripe_subscriptions)
      );

      const cancelWhileDeleted = await this.postWebhook({
        id: `evt_sd_cancel_${Date.now()}`,
        type: 'customer.subscription.deleted',
        data: {
          object: this.buildSubscriptionObject(user, { id: subId, status: 'canceled' })
        }
      });
      this.assert(
        cancelWhileDeleted.status === 200,
        'Cancel webhook while soft-deleted returns 200',
        `status=${cancelWhileDeleted.status} body=${JSON.stringify(cancelWhileDeleted.data)}`
      );

      const loginRes = await axios.post(`${this.baseURL}/api/login`, {
        email: user.email,
        password: 'SecurePass987!'
      }, { timeout: this.timeout });
      this.assert(loginRes.status === 200, 'Login restores soft-deleted billing user');
      const restoredToken = loginRes.data?.data?.access_token;
      this.assert(!!restoredToken, 'Restored login returns access token');

      const statusRes = await axios.get(`${this.baseURL}/api/billing/status`, {
        headers: { Authorization: `Bearer ${restoredToken}` },
        timeout: this.timeout
      });
      this.assert(statusRes.status === 200, 'Billing status after restore returns 200');
      this.assert(
        statusRes.data.premium === false,
        'Restored user is not premium after soft-delete canceled Stripe',
        `premium=${statusRes.data.premium} is_premium=${statusRes.data.is_premium} status=${statusRes.data.subscription?.status}`
      );
      this.assert(
        statusRes.data.is_premium === false,
        'users.is_premium is false after soft-delete cancel path',
        `is_premium=${statusRes.data.is_premium}`
      );
    } catch (error) {
      this.assert(
        false,
        'Soft-delete cancels Stripe + webhook sync while deleted',
        error.response?.data?.error || error.message
      );
    }
  }

  async testStaleSubscriptionUpdateDoesNotResurrectPremium() {
    this.log('Testing stale subscription.updated cannot resurrect canceled premium', 'section');
    const user = await this.createTestUser('stripe-stale-webhook');
    if (!user) {
      this.assert(false, 'Create user for stale webhook test');
      return;
    }

    try {
      const subId = `sub_stale_${Date.now()}`;
      const activate = await this.postWebhook({
        id: `evt_stale_act_${Date.now()}`,
        type: 'checkout.session.completed',
        data: {
          object: {
            id: `cs_stale_${Date.now()}`,
            mode: 'subscription',
            client_reference_id: user.id,
            customer: null,
            metadata: { user_id: user.id, plan: 'yearly' },
            subscription: this.buildSubscriptionObject(user, { id: subId, status: 'active' })
          }
        }
      });
      this.assert(activate.status === 200, 'Activate webhook returns 200');

      const cancel = await this.postWebhook({
        id: `evt_stale_cancel_${Date.now()}`,
        type: 'customer.subscription.deleted',
        data: {
          object: this.buildSubscriptionObject(user, { id: subId, status: 'canceled' })
        }
      });
      this.assert(cancel.status === 200, 'Cancel webhook returns 200');

      const statusAfterCancel = await axios.get(`${this.baseURL}/api/billing/status`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(statusAfterCancel.status === 200, 'Status after cancel returns 200');
      this.assert(
        statusAfterCancel.data.premium === false,
        'Premium cleared after cancel',
        `premium=${statusAfterCancel.data.premium} status=${statusAfterCancel.data.subscription?.status}`
      );
      this.assert(
        statusAfterCancel.data.subscription?.status === 'canceled',
        'Subscription remains canceled after delete webhook',
        statusAfterCancel.data.subscription?.status
      );

      const staleUpdate = await this.postWebhook({
        id: `evt_stale_upd_${Date.now()}`,
        type: 'customer.subscription.updated',
        data: {
          object: this.buildSubscriptionObject(user, { id: subId, status: 'active' })
        }
      });
      this.assert(staleUpdate.status === 200, 'Stale update webhook returns 200');

      const statusAfterStale = await axios.get(`${this.baseURL}/api/billing/status`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(statusAfterStale.status === 200, 'Status after stale update returns 200');
      this.assert(
        statusAfterStale.data.subscription?.status === 'canceled',
        'Canceled status not overwritten by stale active update',
        statusAfterStale.data.subscription?.status
      );
      this.assert(
        statusAfterStale.data.premium === false,
        'Premium stays false after stale active update',
        `premium=${statusAfterStale.data.premium}`
      );
      this.assert(
        statusAfterStale.data.is_premium === false,
        'users.is_premium stays false after stale active update',
        `is_premium=${statusAfterStale.data.is_premium}`
      );
    } catch (error) {
      this.assert(
        false,
        'Stale subscription update does not resurrect premium',
        error.response?.data?.error || error.message
      );
    }
  }

  async createPairedUsers(prefix = 'stripe-billing-paired') {
    const user1 = await this.createTestUser(`${prefix}_payer`);
    const user2 = await this.createTestUser(`${prefix}_partner`);
    if (!user1 || !user2) return null;

    try {
      const pairingResponse = await axios.post(`${this.baseURL}/api/pairing/request`, {}, {
        headers: { Authorization: `Bearer ${user1.token}` },
        timeout: this.timeout
      });
      const partnerCode = pairingResponse.data.partner_code;
      await axios.post(`${this.baseURL}/api/pairing/accept`, {
        partner_code: partnerCode
      }, {
        headers: { Authorization: `Bearer ${user2.token}` },
        timeout: this.timeout
      });
      return { user1, user2, partnerCode };
    } catch (error) {
      this.log(`Failed to create paired users: ${error.response?.data?.error || error.message}`, 'fail');
      return null;
    }
  }

  async assertSharedPremium(user, expected, label) {
    const subRes = await axios.get(`${this.baseURL}/api/subscription`, {
      headers: { Authorization: `Bearer ${user.token}` },
      timeout: this.timeout
    });
    this.assert(
      subRes.data.premium === expected,
      `${label} GET /subscription premium=${expected}`,
      `premium=${subRes.data.premium}`
    );

    const profileRes = await axios.get(`${this.baseURL}/api/users/${user.id}`, {
      headers: { Authorization: `Bearer ${user.token}` },
      timeout: this.timeout
    });
    this.assert(
      profileRes.data.premium === expected,
      `${label} profile premium=${expected}`,
      `premium=${profileRes.data.premium}`
    );

    const pairingsRes = await axios.get(`${this.baseURL}/api/pairing`, {
      headers: { Authorization: `Bearer ${user.token}` },
      timeout: this.timeout
    });
    const accepted = (pairingsRes.data.pairings || []).find((p) => p.status === 'accepted');
    this.assert(
      !!accepted && accepted.premium === expected,
      `${label} pairing.premium=${expected}`,
      `pairing.premium=${accepted?.premium}`
    );
  }

  async postCheckoutCompleted(user, subId) {
    return this.postWebhook({
      id: `evt_partner_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_partner_${Date.now()}`,
          mode: 'subscription',
          client_reference_id: user.id,
          customer: null,
          metadata: { user_id: user.id, plan: 'yearly' },
          subscription: this.buildSubscriptionObject(user, { id: subId, status: 'trialing' })
        }
      }
    });
  }

  /**
   * Stripe purchase must mark accepted pairing partners premium (same as IAP).
   * Cancel must clear partner premium when neither side still has a paid sub.
   */
  async testStripePurchaseMarksPartnerPremium() {
    this.log('Testing Stripe purchase marks paired partner premium', 'section');
    const paired = await this.createPairedUsers('stripe-partner-buy');
    if (!paired) {
      this.assert(false, 'Create paired users for Stripe partner premium');
      return;
    }
    const { user1: payer, user2: partner } = paired;
    const subId = `sub_partner_${Date.now()}`;

    try {
      const activate = await this.postCheckoutCompleted(payer, subId);
      this.assert(activate.status === 200, 'Stripe partner-premium activate webhook returns 200');

      await this.assertSharedPremium(payer, true, 'Payer after Stripe purchase');
      await this.assertSharedPremium(partner, true, 'Partner after Stripe purchase');

      const partnerLogin = await axios.post(`${this.baseURL}/api/login`, {
        email: partner.email,
        password: 'SecurePass987!'
      }, { timeout: this.timeout });
      this.assert(
        partnerLogin.data?.data?.user?.premium === true,
        'Partner login premium is true after payer Stripe purchase',
        `premium=${partnerLogin.data?.data?.user?.premium}`
      );
      partner.token = partnerLogin.data?.data?.access_token || partner.token;

      const cancel = await this.postWebhook({
        id: `evt_partner_cancel_${Date.now()}`,
        type: 'customer.subscription.deleted',
        data: {
          object: this.buildSubscriptionObject(payer, { id: subId, status: 'canceled' })
        }
      });
      this.assert(cancel.status === 200, 'Stripe partner-premium cancel webhook returns 200');

      await this.assertSharedPremium(partner, false, 'Partner after Stripe cancel');
    } catch (error) {
      this.assert(
        false,
        'Stripe purchase marks partner premium',
        error.response?.data?.error || error.message
      );
    }
  }

  /**
   * Subscribe first, then pair: accepting the pairing must still share premium.
   */
  async testStripeThenPairMarksPartnerPremium() {
    this.log('Testing Stripe purchase then pair marks partner premium', 'section');
    const payer = await this.createTestUser('stripe-then-pair-payer');
    const partner = await this.createTestUser('stripe-then-pair-partner');
    if (!payer || !partner) {
      this.assert(false, 'Create users for Stripe-then-pair premium');
      return;
    }

    try {
      const subId = `sub_then_pair_${Date.now()}`;
      const activate = await this.postCheckoutCompleted(payer, subId);
      this.assert(activate.status === 200, 'Stripe-then-pair activate webhook returns 200');

      const pairingResponse = await axios.post(`${this.baseURL}/api/pairing/request`, {}, {
        headers: { Authorization: `Bearer ${payer.token}` },
        timeout: this.timeout
      });
      await axios.post(`${this.baseURL}/api/pairing/accept`, {
        partner_code: pairingResponse.data.partner_code
      }, {
        headers: { Authorization: `Bearer ${partner.token}` },
        timeout: this.timeout
      });

      await this.assertSharedPremium(partner, true, 'Partner after pairing with Stripe subscriber');
    } catch (error) {
      this.assert(
        false,
        'Stripe then pair marks partner premium',
        error.response?.data?.error || error.message
      );
    }
  }

  async runAllTests() {
    this.log('Starting Stripe Billing tests', 'section');

    await this.testCheckoutRequiresAuth();

    const user = await this.createTestUser();
    if (!user) {
      this.assert(false, 'Create billing test user');
      return this.testResults;
    }

    await this.testCheckoutValidation(user);
    // Reject bad return URLs before any subscription exists (otherwise 409 masks 400).
    await this.testRejectedReturnOrigin(user);
    await this.testSetupIntentCreatesClientSecret(user);
    await this.testTrialOnlyStartsAfterSubscribeConfirmed();
    await this.testCheckoutCreatesSession(user);
    await this.testCheckoutBlockedWhileSessionOpen(user);
    await this.testStatusBeforeWebhook(user);
    await this.testWebhookCheckoutCompleted(user);
    await this.testStatusAfterWebhook(user);
    await this.testCheckoutBlockedWhenSubscriptionActive(user);
    await this.testLoginReportsStripePremium(user);
    await this.testPortalSession(user);
    await this.testStripePremiumSurvivesIncompleteCustomOrg(user);
    await this.testOrgPremiumSurvivesStripeCancel();
    await this.testSoftDeleteCancelsStripeAndWebhookSyncWhileDeleted();
    await this.testStaleSubscriptionUpdateDoesNotResurrectPremium();
    await this.testStripePurchaseMarksPartnerPremium();
    await this.testStripeThenPairMarksPartnerPremium();

    this.log(`Results: ${this.testResults.passed}/${this.testResults.total} passed`, 'info');
    return this.testResults.failed === 0;
  }
}

module.exports = StripeBillingTestRunner;

if (require.main === module) {
  const runner = new StripeBillingTestRunner();
  runner.runAllTests()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
