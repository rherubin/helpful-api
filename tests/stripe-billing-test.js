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
      // Portal requires a stripe_customer_id — checkout should have created one.
      // If webhook path didn't attach a customer, create checkout first to ensure one.
      await axios.post(`${this.baseURL}/api/billing/checkout`, {
        plan: 'monthly',
        success_url: 'http://localhost:3000/get-started?billing=success',
        cancel_url: 'http://localhost:3000/get-started?billing=cancel'
      }, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });

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

      const profileRes = await axios.get(`${this.baseURL}/api/users/${user.id}`, {
        headers: { Authorization: `Bearer ${user.token}` },
        timeout: this.timeout
      });
      this.assert(
        profileRes.data.user.premium === true,
        'User profile still reports premium after Stripe cancel'
      );
    } catch (error) {
      this.assert(false, 'Org premium survives Stripe cancel', error.response?.data?.error || error.message);
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
    await this.testCheckoutCreatesSession(user);
    await this.testStatusBeforeWebhook(user);
    await this.testWebhookCheckoutCompleted(user);
    await this.testStatusAfterWebhook(user);
    await this.testPortalSession(user);
    await this.testRejectedReturnOrigin(user);
    await this.testOrgPremiumSurvivesStripeCancel();

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
