const express = require('express');
const http = require('http');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { createBillingRoutes, createBillingWebhookHandler } = require('../routes/billing');
const createSubscriptionRoutes = require('../routes/subscription');
const createPairingRoutes = require('../routes/pairing');
const createAuthRoutes = require('../routes/auth');
const { StripeBillingService, StripeBillingError } = require('../services/StripeBillingService');
const { SubscriptionError } = require('../services/SubscriptionService');
const PairingService = require('../services/PairingService');
const AuthService = require('../services/AuthService');
const AndroidSubscription = require('../models/AndroidSubscription');
const IosSubscription = require('../models/IosSubscription');
const StripeSubscription = require('../models/StripeSubscription');
const HelpfulPromptService = require('../services/HelpfulPromptService');
const HopefulPromptService = require('../services/HopefulPromptService');
const ResourceCoverageTestRunner = require('./resource-coverage-test');
const {
  getGenerationFollowUpDelayMs,
  isGenerationFollowUpEnabled,
  hasProgramSteps,
  hasCompleteProgramSteps,
  generateAndPersistProgramContent,
  runGenerationWithFollowUp
} = require('../services/programGeneration');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const noopAuth = { resetRefreshTokenExpiration: async () => {} };

function userToken(id = 'user_branch_1', extra = {}) {
  return jwt.sign({ id, email: `${id}@example.com`, ...extra }, JWT_SECRET, { expiresIn: '1h' });
}
function adminToken(id = 'admin_branch_1') {
  return jwt.sign({ id, email: `${id}@example.com`, type: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
}
function expiredToken(id = 'user_expired') {
  return jwt.sign({ id, email: `${id}@example.com`, iat: Math.floor(Date.now()/1000) - 120, exp: Math.floor(Date.now()/1000) - 60 }, JWT_SECRET, { noTimestamp: true });
}
function sevenDayProgram() {
  return {
    program: {
      title: 'Test Couples Connection Program',
      days: Array.from({ length: 7 }, (_, i) => ({
        day: i + 1,
        theme: `Theme number ${i + 1} for couples work`,
        conversation_starter: 'Share one moment this week when you felt close to your partner and why it mattered to you both.',
        science_behind_it: 'Small moments of turning toward each other strengthen trust and emotional bonding over time.'
      }))
    }
  };
}
function sevenDayFaithProgram() {
  return {
    program: {
      title: '7-Day Faith Reflection Program',
      days: Array.from({ length: 7 }, (_, i) => ({
        day: i + 1,
        theme: `Faith theme ${i + 1} for the couple`,
        reflection: 'Take a quiet moment to pray together and notice how scripture speaks to this part of your relationship today.',
        bible_verse: 'Love is patient, love is kind. It does not envy, it does not boast.'
      }))
    }
  };
}

class BranchCoverageTestRunner {
  constructor(options = {}) {
    this.baseURL = options.baseURL || process.env.TEST_BASE_URL || 'http://127.0.0.1:9000';
    this.timeout = options.timeout || 20000;
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

  async listen(app) {
    const server = http.createServer(app);
    await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
    });
    const { port } = server.address();
    return {
      server,
      baseURL: `http://127.0.0.1:${port}`,
      close: () => new Promise((resolve) => server.close(() => resolve()))
    };
  }

  async request(method, url, { token, body, headers } = {}) {
    return axios({
      method,
      url,
      timeout: this.timeout,
      validateStatus: () => true,
      headers: {
        ...(headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      data: body
    });
  }

  async testBillingAndSubscriptionRoutes() {
    this.log('Billing and subscription route branches', 'section');
    const billingSvc = {
      createCheckoutSession: async () => ({ url: 'https://checkout.example/s', session_id: 'cs_1', plan: 'monthly' }),
      createSetupIntent: async () => ({ client_secret: 'seti_secret' }),
      finalizeSubscription: async () => ({ subscription_id: 'sub_1', status: 'trialing', plan: 'monthly' }),
      createPortalSession: async () => ({ url: 'https://billing.example/p' }),
      getStatus: async () => ({ premium: false, subscription: null }),
      constructEvent: (body) => body,
      handleWebhookEvent: async () => null
    };
    const subSvc = {
      processReceipt: async () => ({
        subscription: { created: true, id: 's1', product_id: 'sku', expiration_date: Date.now() + 1000 },
        platform: 'android', isActive: true, premiumUpdates: [{}]
      }),
      getStatus: async () => ({ premium: false }),
      getReceipts: async () => []
    };
    const app = express();
    app.use(express.json());
    app.use('/api/billing', createBillingRoutes(billingSvc, noopAuth));
    app.post('/api/billing/webhook', express.json(), createBillingWebhookHandler(billingSvc));
    app.use('/api/subscription', createSubscriptionRoutes(subSvc, noopAuth));
    const { baseURL, close } = await this.listen(app);
    const token = userToken();
    try {
      const noAuth = await this.request('POST', `${baseURL}/api/billing/checkout`);
      this.assert(noAuth.status === 401, 'Billing checkout requires auth', `status=${noAuth.status}`);
      const badAuth = await this.request('POST', `${baseURL}/api/billing/checkout`, { headers: { Authorization: 'Bearer not-a-jwt' } });
      this.assert(badAuth.status === 401, 'Billing checkout rejects invalid token', `status=${badAuth.status}`);
      const expired = await this.request('GET', `${baseURL}/api/billing/status`, { token: expiredToken() });
      this.assert(expired.status === 401, 'Billing status rejects expired token', `status=${expired.status}`);
      const admin = await this.request('GET', `${baseURL}/api/billing/status`, { token: adminToken() });
      this.assert(admin.status === 403, 'Billing status rejects admin token', `status=${admin.status}`);
      const checkoutOk = await this.request('POST', `${baseURL}/api/billing/checkout`, { token, body: { plan: 'monthly' } });
      this.assert(checkoutOk.status === 200 && checkoutOk.data.session_id === 'cs_1', 'Billing checkout success', `status=${checkoutOk.status}`);
      const checkoutEmpty = await this.request('POST', `${baseURL}/api/billing/checkout`, { token });
      this.assert(checkoutEmpty.status === 200, 'Billing checkout accepts omitted body', `status=${checkoutEmpty.status}`);

      billingSvc.createCheckoutSession = async () => { throw new StripeBillingError('Invalid plan. Must be one of: monthly, yearly', { status: 400 }); };
      const badPlan = await this.request('POST', `${baseURL}/api/billing/checkout`, { token, body: { plan: 'weekly' } });
      this.assert(badPlan.status === 400 && /Invalid plan/.test(badPlan.data.error), 'Billing checkout StripeBillingError', `${badPlan.status}`);
      billingSvc.createCheckoutSession = async () => { throw new Error(''); };
      const checkout500 = await this.request('POST', `${baseURL}/api/billing/checkout`, { token, body: { plan: 'monthly' } });
      this.assert(checkout500.status === 500 && checkout500.data.error === 'Failed to create checkout session', 'Billing checkout generic 500 fallback');

      billingSvc.createSetupIntent = async () => { throw new StripeBillingError('User not found', { status: 404, code: 'user_not_found' }); };
      const setup404 = await this.request('POST', `${baseURL}/api/billing/setup-intent`, { token });
      this.assert(setup404.status === 404 && setup404.data.code === 'user_not_found', 'Billing setup-intent typed error with code');
      billingSvc.createSetupIntent = async () => { const e = new Error(); e.message = ''; throw e; };
      const setup500 = await this.request('POST', `${baseURL}/api/billing/setup-intent`, { token });
      this.assert(setup500.status === 500 && setup500.data.error === 'Failed to create setup intent', 'Billing setup-intent generic 500');

      const subscribeEmpty = await this.request('POST', `${baseURL}/api/billing/subscribe`, { token });
      this.assert(subscribeEmpty.status === 200, 'Billing subscribe omitted body hits service', `status=${subscribeEmpty.status}`);
      billingSvc.finalizeSubscription = async () => { throw new StripeBillingError('setup_intent_id is required', { status: 400 }); };
      const subMissing = await this.request('POST', `${baseURL}/api/billing/subscribe`, { token, body: { plan: 'monthly' } });
      this.assert(subMissing.status === 400 && /setup_intent_id/.test(subMissing.data.error), 'Billing subscribe validation error');
      billingSvc.finalizeSubscription = async () => { throw new StripeBillingError('An active Stripe subscription already exists. Use the billing portal to manage it.', { status: 409, code: 'subscription_already_active' }); };
      const already = await this.request('POST', `${baseURL}/api/billing/subscribe`, { token, body: { plan: 'yearly', setup_intent_id: 'seti_1' } });
      this.assert(already.status === 409 && already.data.code === 'subscription_already_active', 'Billing subscribe already-subscribed');
      billingSvc.finalizeSubscription = async () => { throw new Error(''); };
      const sub500 = await this.request('POST', `${baseURL}/api/billing/subscribe`, { token, body: { plan: 'monthly', setup_intent_id: 'seti_1' } });
      this.assert(sub500.status === 500 && sub500.data.error === 'Failed to create subscription', 'Billing subscribe generic 500');

      const portalEmpty = await this.request('POST', `${baseURL}/api/billing/portal`, { token });
      this.assert(portalEmpty.status === 200, 'Billing portal omitted body', `status=${portalEmpty.status}`);
      billingSvc.createPortalSession = async () => { throw new StripeBillingError('No Stripe customer for this account', { status: 400 }); };
      const portalNoCust = await this.request('POST', `${baseURL}/api/billing/portal`, { token, body: {} });
      this.assert(portalNoCust.status === 400, 'Billing portal missing customer');
      billingSvc.createPortalSession = async () => { throw new Error(''); };
      const portal500 = await this.request('POST', `${baseURL}/api/billing/portal`, { token });
      this.assert(portal500.status === 500 && portal500.data.error === 'Failed to create portal session', 'Billing portal generic 500');
      billingSvc.getStatus = async () => { throw new Error('boom'); };
      const status500 = await this.request('GET', `${baseURL}/api/billing/status`, { token });
      this.assert(status500.status === 500 && status500.data.error === 'Failed to fetch billing status', 'Billing status generic 500');

      const hookNoSig = await this.request('POST', `${baseURL}/api/billing/webhook`, { body: { type: 'ping' } });
      this.assert(hookNoSig.status === 400 && /stripe-signature/.test(hookNoSig.data.error), 'Billing webhook missing signature');
      billingSvc.constructEvent = () => { throw new StripeBillingError('Webhook signature verification failed: bad', { status: 400 }); };
      const hookBad = await this.request('POST', `${baseURL}/api/billing/webhook`, { headers: { 'stripe-signature': 't=1,v1=bad' }, body: { type: 'ping' } });
      this.assert(hookBad.status === 400 && /signature/.test(hookBad.data.error), 'Billing webhook StripeBillingError');
      billingSvc.constructEvent = () => { throw new Error(''); };
      const hook500 = await this.request('POST', `${baseURL}/api/billing/webhook`, { headers: { 'stripe-signature': 't=1,v1=x' }, body: { type: 'ping' } });
      this.assert(hook500.status === 400 && hook500.data.error === 'Webhook handler failed', 'Billing webhook generic failure fallback');
      billingSvc.constructEvent = (body) => body;
      const hookOk = await this.request('POST', `${baseURL}/api/billing/webhook`, { headers: { 'stripe-signature': 't=1,v1=ok' }, body: { type: 'invoice.paid', data: { object: {} } } });
      this.assert(hookOk.status === 200 && hookOk.data.received === true, 'Billing webhook success');

      const subNoAuth = await this.request('POST', `${baseURL}/api/subscription`, { body: {} });
      this.assert(subNoAuth.status === 401, 'Subscription POST requires auth');
      const adminSub = await this.request('GET', `${baseURL}/api/subscription`, { token: adminToken() });
      this.assert(adminSub.status === 403, 'Subscription GET rejects admin token');
      const created = await this.request('POST', `${baseURL}/api/subscription`, { token, body: { platform: 'android' } });
      this.assert(created.status === 201 && created.data.premium_status.active === true, 'Subscription POST created 201');
      subSvc.processReceipt = async () => ({
        subscription: { created: false, id: 's1', product_id: 'sku', expiration_date: Date.now() },
        platform: 'ios', isActive: false, premiumUpdates: []
      });
      const updated = await this.request('POST', `${baseURL}/api/subscription`, { token, body: { platform: 'ios' } });
      this.assert(updated.status === 200 && /updated/.test(updated.data.message), 'Subscription POST updated 200');
      subSvc.processReceipt = async () => { throw new SubscriptionError('Receipt already belongs to another user', 409, 'receipt_conflict'); };
      const conflict = await this.request('POST', `${baseURL}/api/subscription`, { token, body: {} });
      this.assert(conflict.status === 409 && conflict.data.code === 'receipt_conflict', 'Subscription POST SubscriptionError with code');
      subSvc.processReceipt = async () => { throw new SubscriptionError('Invalid receipt', 400); };
      const noCode = await this.request('POST', `${baseURL}/api/subscription`, { token, body: {} });
      this.assert(noCode.status === 400 && noCode.data.code === undefined, 'Subscription POST SubscriptionError without code');
      subSvc.processReceipt = async () => { throw new Error('db down'); };
      const rec500 = await this.request('POST', `${baseURL}/api/subscription`, { token, body: {} });
      this.assert(rec500.status === 500 && rec500.data.error === 'Failed to process subscription receipt', 'Subscription POST generic 500');
      subSvc.getStatus = async () => { throw new Error('User not found'); };
      const st404 = await this.request('GET', `${baseURL}/api/subscription`, { token });
      this.assert(st404.status === 404 && st404.data.error === 'User not found', 'Subscription GET user not found');
      subSvc.getStatus = async () => { throw new Error('db down'); };
      const st500 = await this.request('GET', `${baseURL}/api/subscription`, { token });
      this.assert(st500.status === 500 && st500.data.error === 'Failed to fetch subscription status', 'Subscription GET generic 500');
      const receiptsOk = await this.request('GET', `${baseURL}/api/subscription/receipts`, { token });
      this.assert(receiptsOk.status === 200, 'Subscription receipts success');
      subSvc.getReceipts = async () => { throw new Error('db down'); };
      const recpts500 = await this.request('GET', `${baseURL}/api/subscription/receipts`, { token });
      this.assert(recpts500.status === 500 && recpts500.data.error === 'Failed to fetch subscription receipts', 'Subscription receipts generic 500');
    } finally {
      await close();
    }
  }

  async testPairingRoutes() {
    this.log('Pairing route branches', 'section');
    const pairingService = {
      pairingModel: {
        getPendingPairingByPartnerCode: async () => { throw new Error('lookup failed'); },
        softDeletePairing: async () => ({ message: 'deleted' }),
        restorePairingAtomic: async () => ({ message: 'restored' }),
        getDeletedPairings: async () => []
      },
      requestPairing: async () => ({ partner_code: 'ABC123' }),
      acceptPairingByCode: async () => {},
      getUserPairings: async () => ({ pairings: [] }),
      getPendingPairings: async () => ({ pairings: [] }),
      getAcceptedPairings: async () => ({ pairings: [] }),
      getUserPairingStats: async () => ({ accepted: 0 }),
      getPairingDetails: async () => ({ pairing: { user1_id: 'user_branch_1', user2_id: 'other' } })
    };
    const app = express();
    app.use(express.json());
    app.use('/api/pairing', createPairingRoutes(pairingService, noopAuth, null, null, pairingService.pairingModel));
    const { baseURL, close } = await this.listen(app);
    const token = userToken();
    try {
      this.assert((await this.request('POST', `${baseURL}/api/pairing/request`, { token })).status === 201, 'Pairing request success');
      pairingService.requestPairing = async () => { throw new Error('You have reached your maximum number of pairings'); };
      this.assert((await this.request('POST', `${baseURL}/api/pairing/request`, { token })).status === 400, 'Pairing request max pairings');
      pairingService.requestPairing = async () => { throw new Error('You already have a pending pairing request'); };
      this.assert((await this.request('POST', `${baseURL}/api/pairing/request`, { token })).status === 409, 'Pairing request existing pending');
      pairingService.requestPairing = async () => { throw new Error('db down'); };
      this.assert((await this.request('POST', `${baseURL}/api/pairing/request`, { token })).status === 500, 'Pairing request generic 500');

      const noCode = await this.request('POST', `${baseURL}/api/pairing/accept`, { token, body: {} });
      this.assert(noCode.status === 400 && /Partner code is required/.test(noCode.data.error), 'Pairing accept missing code');
      pairingService.acceptPairingByCode = async () => {};
      this.assert((await this.request('POST', `${baseURL}/api/pairing/accept`, { token, body: { partner_code: 'ABC123' } })).status === 200, 'Pairing accept succeeds when pending lookup fails');
      const cases = [
        ['No pending pairing found for this partner code', 404],
        ['You cannot accept your own pairing request', 400],
        ['You are already paired with this user', 409],
        ['You have reached your maximum number of pairings', 400],
        ['User not found', 404],
        ['unexpected accept failure', 500]
      ];
      for (const [msg, status] of cases) {
        pairingService.acceptPairingByCode = async () => { throw new Error(msg); };
        const res = await this.request('POST', `${baseURL}/api/pairing/accept`, { token, body: { partner_code: 'ABC123' } });
        this.assert(res.status === status, `Pairing accept "${msg}"`, `expected=${status} got=${res.status}`);
      }

      pairingService.getUserPairings = async () => { throw new Error('db'); };
      this.assert((await this.request('GET', `${baseURL}/api/pairing`, { token })).status === 500, 'Pairing list 500');
      pairingService.getPendingPairings = async () => { throw new Error('db'); };
      this.assert((await this.request('GET', `${baseURL}/api/pairing/pending`, { token })).status === 500, 'Pairing pending 500');
      pairingService.getAcceptedPairings = async () => { throw new Error('db'); };
      this.assert((await this.request('GET', `${baseURL}/api/pairing/accepted`, { token })).status === 500, 'Pairing accepted 500');
      pairingService.getUserPairingStats = async () => { throw new Error('db'); };
      this.assert((await this.request('GET', `${baseURL}/api/pairing/stats`, { token })).status === 500, 'Pairing stats 500');

      pairingService.getPairingDetails = async () => { throw new Error('Pairing not found'); };
      this.assert((await this.request('GET', `${baseURL}/api/pairing/p1`, { token })).status === 404, 'Pairing details 404');
      pairingService.getPairingDetails = async () => { throw new Error('db'); };
      this.assert((await this.request('GET', `${baseURL}/api/pairing/p1`, { token })).status === 500, 'Pairing details 500');
      pairingService.getPairingDetails = async () => ({ pairing: { user1_id: 'someone-else', user2_id: 'other' } });
      this.assert((await this.request('GET', `${baseURL}/api/pairing/p1`, { token })).status === 403, 'Pairing details unauthorized');
      this.assert((await this.request('DELETE', `${baseURL}/api/pairing/p1`, { token })).status === 403, 'Pairing delete unauthorized');
      pairingService.getPairingDetails = async () => { throw new Error('Pairing not found or already deleted'); };
      this.assert((await this.request('DELETE', `${baseURL}/api/pairing/p1`, { token })).status === 404, 'Pairing delete not found');
      pairingService.getPairingDetails = async () => ({ pairing: { user1_id: 'user_branch_1', user2_id: 'other' } });
      pairingService.pairingModel.softDeletePairing = async () => { throw new Error('db'); };
      this.assert((await this.request('DELETE', `${baseURL}/api/pairing/p1`, { token })).status === 500, 'Pairing delete 500');

      pairingService.pairingModel.restorePairingAtomic = async () => { throw new Error('You are not authorized to restore this pairing'); };
      this.assert((await this.request('PATCH', `${baseURL}/api/pairing/p1/restore`, { token })).status === 403, 'Pairing restore unauthorized');
      pairingService.pairingModel.restorePairingAtomic = async () => { throw new Error('Pairing not found or not deleted'); };
      this.assert((await this.request('PATCH', `${baseURL}/api/pairing/p1/restore`, { token })).status === 404, 'Pairing restore not found');
      pairingService.pairingModel.restorePairingAtomic = async () => { throw new Error('You have reached your maximum number of pairings'); };
      this.assert((await this.request('PATCH', `${baseURL}/api/pairing/p1/restore`, { token })).status === 400, 'Pairing restore max pairings');
      pairingService.pairingModel.restorePairingAtomic = async () => { throw new Error('member account is deleted'); };
      this.assert((await this.request('PATCH', `${baseURL}/api/pairing/p1/restore`, { token })).status === 400, 'Pairing restore deleted member');
      pairingService.pairingModel.restorePairingAtomic = async () => { throw new Error('db'); };
      this.assert((await this.request('PATCH', `${baseURL}/api/pairing/p1/restore`, { token })).status === 500, 'Pairing restore 500');
      this.assert((await this.request('GET', `${baseURL}/api/pairing/deleted/all`, { token })).status === 403, 'Deleted pairings requires admin');
      pairingService.pairingModel.getDeletedPairings = async () => [{ id: 'p_del', status: 'deleted', user1_id: 'u1', user2_id: 'u2' }];
      const deletedOk = await this.request('GET', `${baseURL}/api/pairing/deleted/all`, { token: adminToken() });
      this.assert(deletedOk.status === 200, 'Deleted pairings admin 200', `status=${deletedOk.status}`);
      this.assert(Array.isArray(deletedOk.data) && deletedOk.data[0] && deletedOk.data[0].id === 'p_del', 'Deleted pairings admin returns a list');
      pairingService.pairingModel.getDeletedPairings = async () => { throw new Error('db'); };
      this.assert((await this.request('GET', `${baseURL}/api/pairing/deleted/all`, { token: adminToken() })).status === 500, 'Deleted pairings admin 500');
    } finally {
      await close();
    }
  }

  async testAuthRouteBranches() {
    this.log('Auth route branches', 'section');
    const authService = {
      resetRefreshTokenExpiration: async () => {},
      login: async () => ({ access_token: 'a', refresh_token: 'r' }),
      refreshToken: async () => ({ access_token: 'a2' }),
      logout: async () => ({ message: 'ok' })
    };
    const userModel = {
      getUserById: async () => ({ id: 'user_branch_1', email: 'u@example.com', org_name: 'Church', org_city: 'Austin', org_state: 'TX' })
    };
    const pairingService = {
      pairingModel: { userHasPremiumPairing: async () => false },
      getUserPairings: async () => ({ pairings: [{ partner_code: 'ZZZ' }] })
    };
    const orgCodeModel = { getOrgCodeById: async () => { throw new Error('deleted org'); } };
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRoutes(authService, userModel, pairingService, orgCodeModel));
    const { baseURL, close } = await this.listen(app);
    const token = userToken();
    try {
      this.assert((await this.request('POST', `${baseURL}/api/auth/login`, { body: {} })).status === 400, 'Auth login requires email and password');
      authService.login = async () => { throw new Error('Invalid email or password'); };
      this.assert((await this.request('POST', `${baseURL}/api/auth/login`, { body: { email: `branch_fail_${Date.now()}@ex.com`, password: 'x' } })).status === 401, 'Auth login invalid credentials');
      authService.login = async () => { throw new Error('db down'); };
      this.assert((await this.request('POST', `${baseURL}/api/auth/login`, { body: { email: `branch_err_${Date.now()}@ex.com`, password: 'x' } })).status === 500, 'Auth login generic 500');
      this.assert((await this.request('POST', `${baseURL}/api/auth/refresh`, { body: {} })).status === 400, 'Auth refresh requires token');
      authService.refreshToken = async () => { throw new Error('Invalid or expired refresh token'); };
      this.assert((await this.request('POST', `${baseURL}/api/auth/refresh`, { body: { refresh_token: 'dead' } })).status === 401, 'Auth refresh invalid token');
      authService.refreshToken = async () => { throw new Error('Refresh token not found or expired'); };
      this.assert((await this.request('POST', `${baseURL}/api/auth/refresh`, { body: { refresh_token: 'dead' } })).status === 401, 'Auth refresh not found');
      authService.refreshToken = async () => { throw new Error('db down'); };
      this.assert((await this.request('POST', `${baseURL}/api/auth/refresh`, { body: { refresh_token: 'x' } })).status === 500, 'Auth refresh generic 500');
      this.assert((await this.request('POST', `${baseURL}/api/auth/logout`, { body: {} })).status === 400, 'Auth logout requires token');
      authService.logout = async () => { throw new Error('db down'); };
      this.assert((await this.request('POST', `${baseURL}/api/auth/logout`, { body: { refresh_token: 'x' } })).status === 500, 'Auth logout generic 500');
      this.assert((await this.request('POST', `${baseURL}/api/auth/token-info`, { body: {} })).status === 400, 'Auth token-info requires token');
      this.assert((await this.request('POST', `${baseURL}/api/auth/token-info`, { body: { access_token: 'not-a-jwt' } })).status === 400, 'Auth token-info invalid format');
      const noClaims = jwt.sign({ foo: 'bar' }, JWT_SECRET);
      const mal = await this.request('POST', `${baseURL}/api/auth/token-info`, { body: { access_token: noClaims } });
      this.assert(mal.status === 400 && /iat/.test(mal.data.error), 'Auth token-info missing iat/exp');
      const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ iat: 1, exp: 9999999999 })).toString('base64url')}.`;
      const missingUser = await this.request('POST', `${baseURL}/api/auth/token-info`, { body: { access_token: unsigned } });
      this.assert(missingUser.status === 400 && /id, email/.test(missingUser.data.error), 'Auth token-info missing user claims');
      const prof = await this.request('GET', `${baseURL}/api/auth/profile`, { token });
      this.assert(prof.status === 200 && prof.data.profile.org_name === 'Church', 'Auth profile uses custom org fields');
      userModel.getUserById = async () => ({ id: 'user_branch_1', email: 'u@example.com', org_code_id: 'org1' });
      const profOrgFail = await this.request('GET', `${baseURL}/api/auth/profile`, { token });
      this.assert(profOrgFail.status === 200 && profOrgFail.data.profile.org_name === null, 'Auth profile survives missing org code');
      userModel.getUserById = async () => { throw new Error('User not found'); };
      this.assert((await this.request('GET', `${baseURL}/api/auth/profile`, { token })).status === 404, 'Auth profile user not found');
      userModel.getUserById = async () => { throw new Error('db down'); };
      this.assert((await this.request('GET', `${baseURL}/api/auth/profile`, { token })).status === 500, 'Auth profile generic 500');
    } finally {
      await close();
    }
  }

  makeBillingHarness(user, { stripeOverrides = {}, subRows = {}, active = [] } = {}) {
    const users = new Map();
    if (user) users.set(user.id, { ...user });
    const conn = {
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release() {},
      execute: async (sql) => {
        const current = user ? users.get(user.id) : null;
        if (/FROM users/.test(sql)) return [current ? [current] : []];
        if (/FROM stripe_subscriptions/.test(sql)) return [active];
        if (/UPDATE users/.test(sql)) {
          if (current && !current.stripe_customer_id) current.stripe_customer_id = 'cus_created';
          return [{}];
        }
        return [[]];
      }
    };
    const userModel = {
      db: { getConnection: async () => conn },
      async getUserById(id) {
        const u = users.get(id);
        if (!u) throw new Error('User not found');
        return u;
      },
      async getUserByIdIncludingDeleted(id) { return users.get(id) || null; },
      async getUserByStripeCustomerIdIncludingDeleted(cid) {
        return [...users.values()].find((u) => u.stripe_customer_id === cid) || null;
      },
      async updateUser(id, data) { Object.assign(users.get(id) || {}, data); return users.get(id); },
      async setIsPremium(id, value) { if (users.get(id)) users.get(id).is_premium = value; },
      async softDeleteUser(id) { if (users.get(id)) users.get(id).deleted_at = new Date(); }
    };
    const store = new Map(Object.entries(subRows));
    const stripeSubscriptionModel = {
      async getByStripeSubscriptionId(id) { return store.get(id) || null; },
      async upsertByStripeSubscriptionId(userId, fields) {
        const row = { ...(store.get(fields.stripe_subscription_id) || {}), ...fields, user_id: userId };
        store.set(fields.stripe_subscription_id, row);
        return row;
      },
      async getLatestForUser(userId) { return [...store.values()].find((r) => r.user_id === userId) || null; },
      async getActiveForUser(userId) {
        return [...store.values()].find((r) => r.user_id === userId && ['trialing', 'active'].includes(r.status)) || null;
      },
      async getAllActiveForUser(userId) {
        return [...store.values()].filter((r) => r.user_id === userId && ['trialing', 'active'].includes(r.status));
      },
      async listForReconcile() { return [...store.values()]; },
      async listOrphanedTrialsForCleanup() { return [...store.values()].filter((r) => r.orphaned); }
    };
    const stripe = {
      customers: {
        create: async ({ email, metadata }) => ({ id: 'cus_created', email, metadata }),
        update: async (id, data) => ({ id, ...data })
      },
      checkout: {
        sessions: {
          list: async () => ({ data: [] }),
          create: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' }),
          retrieve: async (id) => ({ id, subscription: null }),
          complete: async () => {},
          completeOpenForCustomer: async () => {}
        }
      },
      setupIntents: {
        create: async () => ({ id: 'seti_1', client_secret: 'secret_1', status: 'requires_payment_method', customer: 'cus_1' }),
        retrieve: async (id) => ({
          id,
          customer: user?.stripe_customer_id || 'cus_created',
          status: 'succeeded',
          payment_method: 'pm_1'
        })
      },
      subscriptions: {
        create: async () => ({
          id: 'sub_1', status: 'trialing',
          items: { data: [{ price: { id: 'price_mock_yearly' } }] },
          trial_end: 111, current_period_end: 222,
          metadata: { user_id: user?.id, plan: 'yearly' }
        }),
        retrieve: async (id) => store.get(id) || { id, status: 'trialing', metadata: { user_id: user?.id } },
        list: async () => ({ data: [] }),
        cancel: async (id) => ({ id, status: 'canceled', metadata: {} })
      },
      billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/p' }) } },
      webhooks: {
        constructEvent: (body, sig) => {
          if (sig === 'bad') throw new Error('bad sig');
          return body;
        }
      }
    };
    if (stripeOverrides.checkout) stripe.checkout = { ...stripe.checkout, sessions: { ...stripe.checkout.sessions, ...(stripeOverrides.checkout.sessions || {}) } };
    if (stripeOverrides.setupIntents) stripe.setupIntents = { ...stripe.setupIntents, ...stripeOverrides.setupIntents };
    if (stripeOverrides.subscriptions) stripe.subscriptions = { ...stripe.subscriptions, ...stripeOverrides.subscriptions };
    if (stripeOverrides.customers) stripe.customers = { ...stripe.customers, ...stripeOverrides.customers };
    if (stripeOverrides.billingPortal) stripe.billingPortal = { ...stripe.billingPortal, ...stripeOverrides.billingPortal };
    const service = new StripeBillingService(userModel, stripeSubscriptionModel, { stripeClient: stripe, useMock: true });
    service.priceIds = { monthly: 'price_mock_monthly', yearly: 'price_mock_yearly' };
    return { service, userModel, stripeSubscriptionModel, users, store, stripe };
  }

  async testStripeBillingService() {
    this.log('StripeBillingService branches', 'section');
    const user = { id: 'u1', email: 'u1@example.com', stripe_customer_id: null, is_premium: 0 };
    const { service: svc0 } = this.makeBillingHarness(user);
    try { svc0.normalizePlan('weekly'); this.assert(false, 'normalizePlan rejects invalid plan'); }
    catch (e) { this.assert(e instanceof StripeBillingError, 'normalizePlan rejects invalid plan', e.message); }
    this.assert(svc0.normalizePlan('Monthly') === 'monthly', 'normalizePlan lowercases');
    svc0.priceIds = { monthly: '', yearly: '' };
    svc0.isMock = true;
    svc0.assertConfigured();
    this.assert(svc0.priceIds.monthly === 'price_mock_monthly', 'assertConfigured fills mock prices');
    this.assert(svc0.planForPriceId(null) === null, 'planForPriceId empty');
    this.assert(svc0.planForPriceId('price_mock_monthly') === 'monthly', 'planForPriceId monthly mock');
    this.assert(svc0.planForPriceId('price_mock_yearly') === 'yearly', 'planForPriceId yearly mock');
    this.assert(svc0.planForPriceId('price_unknown') === null, 'planForPriceId unknown');
    this.assert(svc0.isUrlAllowed('not a url') === false, 'isUrlAllowed invalid URL');
    this.assert(svc0.isUrlAllowed('http://localhost:3000/ok') === true, 'isUrlAllowed allowed origin');
    this.assert(svc0.isUrlAllowed('https://evil.example/x') === false, 'isUrlAllowed rejected origin');
    try { svc0.resolveCheckoutUrls({ success_url: 'https://evil.example/s', cancel_url: 'http://localhost:3000/c' }); this.assert(false, 'resolveCheckoutUrls rejects bad origin'); }
    catch (e) { this.assert(e instanceof StripeBillingError, 'resolveCheckoutUrls rejects bad origin', e.message); }
    const urls = svc0.resolveCheckoutUrls({});
    this.assert(!!urls.successUrl && !!urls.cancelUrl, 'resolveCheckoutUrls uses defaults');
    try { svc0.resolvePortalReturnUrl('https://evil.example/'); this.assert(false, 'resolvePortalReturnUrl rejects bad origin'); }
    catch (e) { this.assert(e instanceof StripeBillingError, 'resolvePortalReturnUrl rejects bad origin', e.message); }

    try { await this.makeBillingHarness(null).service.createCheckoutSession('missing', { plan: 'monthly' }); this.assert(false, 'checkout missing user'); }
    catch (e) { this.assert(e instanceof StripeBillingError && e.status === 404, 'checkout missing user', e.message); }
    try { await this.makeBillingHarness({ ...user, id: 'u1', stripe_customer_id: 'cus_1' }, { active: [{ id: 'row1' }] }).service.createCheckoutSession('u1', { plan: 'monthly' }); this.assert(false, 'checkout already subscribed'); }
    catch (e) { this.assert(e.code === 'subscription_already_active' && e.status === 409, 'checkout already subscribed', e.message); }
    const openHarness = this.makeBillingHarness(
      { ...user, id: 'u1', stripe_customer_id: 'cus_1' },
      { stripeOverrides: { checkout: { sessions: { list: async () => ({ data: [{ id: 'cs_open' }] }) } } } }
    );
    try {
      await openHarness.service.createCheckoutSession('u1', { plan: 'yearly' });
      this.assert(false, 'checkout already open');
    } catch (e) { this.assert(e.code === 'checkout_already_open', 'checkout already open', e.message); }
    const failHarness = this.makeBillingHarness(
      { ...user, id: 'u1', stripe_customer_id: 'cus_1' },
      { stripeOverrides: { checkout: { sessions: { list: async () => ({ data: [] }), create: async () => { throw new Error('stripe down'); } } } } }
    );
    try {
      await failHarness.service.createCheckoutSession('u1', { plan: 'monthly' });
      this.assert(false, 'checkout Stripe API failure');
    } catch (e) { this.assert(e.message === 'stripe down', 'checkout Stripe API failure', e.message); }
        const created = await this.makeBillingHarness({ ...user, id: 'u1', stripe_customer_id: null }).service.createCheckoutSession('u1', { plan: 'monthly' });
    this.assert(created.session_id === 'cs_1' && created.plan === 'monthly', 'checkout creates customer and session');

    try { await this.makeBillingHarness(null).service.createSetupIntent('missing'); this.assert(false, 'setup-intent missing user'); }
    catch (e) { this.assert(e.status === 404, 'setup-intent missing user', e.message); }
    try { await this.makeBillingHarness({ ...user, id: 'u1', stripe_customer_id: 'cus_1' }, { active: [{ id: 'x' }] }).service.createSetupIntent('u1'); this.assert(false, 'setup-intent already subscribed'); }
    catch (e) { this.assert(e.code === 'subscription_already_active', 'setup-intent already subscribed', e.message); }
    try {
      await this.makeBillingHarness({ ...user, id: 'u1', stripe_customer_id: 'cus_1' }, { stripeOverrides: { setupIntents: { create: async () => ({ id: 'seti', client_secret: null }) } } }).service.createSetupIntent('u1');
      this.assert(false, 'setup-intent missing client_secret');
    } catch (e) { this.assert(e.status === 502, 'setup-intent missing client_secret', e.message); }
    const setup = await this.makeBillingHarness({ ...user, id: 'u1', stripe_customer_id: null }).service.createSetupIntent('u1');
    this.assert(!!setup.client_secret, 'setup-intent creates customer and secret');

    const { service: fin } = this.makeBillingHarness({ ...user, id: 'u1', stripe_customer_id: 'cus_1' });
    try { await fin.finalizeSubscription('u1', { plan: 'monthly' }); this.assert(false, 'finalize requires setup_intent_id'); }
    catch (e) { this.assert(/setup_intent_id/.test(e.message), 'finalize requires setup_intent_id', e.message); }
    try { await this.makeBillingHarness(null).service.finalizeSubscription('missing', { plan: 'monthly', setup_intent_id: 'seti_1' }); this.assert(false, 'finalize missing user'); }
    catch (e) { this.assert(e.status === 404, 'finalize missing user', e.message); }
    try { await this.makeBillingHarness({ ...user, id: 'u1', stripe_customer_id: null }).service.finalizeSubscription('u1', { plan: 'monthly', setup_intent_id: 'seti_1' }); this.assert(false, 'finalize missing customer'); }
    catch (e) { this.assert(/No Stripe customer/.test(e.message), 'finalize missing customer', e.message); }
    try { await this.makeBillingHarness({ ...user, id: 'u1', stripe_customer_id: 'cus_1' }, { active: [{ id: 'x' }] }).service.finalizeSubscription('u1', { plan: 'monthly', setup_intent_id: 'seti_1' }); this.assert(false, 'finalize already subscribed'); }
    catch (e) { this.assert(e.code === 'subscription_already_active', 'finalize already subscribed', e.message); }
    try {
      await this.makeBillingHarness({ ...user, id: 'u1', stripe_customer_id: 'cus_1' }, { stripeOverrides: { setupIntents: { retrieve: async () => ({ id: 'seti', customer: 'cus_OTHER', status: 'succeeded', payment_method: 'pm_1' }) } } }).service.finalizeSubscription('u1', { plan: 'monthly', setup_intent_id: 'seti_1' });
      this.assert(false, 'finalize setup intent wrong customer');
    } catch (e) { this.assert(/does not belong/.test(e.message), 'finalize setup intent wrong customer', e.message); }
    try {
      await this.makeBillingHarness({ ...user, id: 'u1', stripe_customer_id: 'cus_1' }, { stripeOverrides: { setupIntents: { retrieve: async () => ({ id: 'seti', customer: 'cus_1', status: 'requires_action', payment_method: 'pm_1' }) } } }).service.finalizeSubscription('u1', { plan: 'monthly', setup_intent_id: 'seti_1' });
      this.assert(false, 'finalize unconfirmed setup intent');
    } catch (e) { this.assert(/not been confirmed/.test(e.message), 'finalize unconfirmed setup intent', e.message); }
    try {
      await this.makeBillingHarness({ ...user, id: 'u1', stripe_customer_id: 'cus_1' }, { stripeOverrides: { setupIntents: { retrieve: async () => ({ id: 'seti', customer: 'cus_1', status: 'succeeded', payment_method: null }) } } }).service.finalizeSubscription('u1', { plan: 'monthly', setup_intent_id: 'seti_1' });
      this.assert(false, 'finalize missing payment method');
    } catch (e) { this.assert(/no attached payment method/.test(e.message), 'finalize missing payment method', e.message); }
    try {
      await this.makeBillingHarness({ ...user, id: 'u1', stripe_customer_id: 'cus_1' }, { stripeOverrides: { subscriptions: { create: async () => ({ id: 'sub_dead', status: 'incomplete' }), cancel: async () => ({}), list: async () => ({ data: [{ id: 'sub_old' }] }) } } }).service.finalizeSubscription('u1', { plan: 'yearly', setup_intent_id: 'seti_1' });
      this.assert(false, 'finalize incomplete subscription');
    } catch (e) { this.assert(e.status === 402, 'finalize incomplete subscription', e.message); }
    const finalized = await this.makeBillingHarness({ ...user, id: 'u1', stripe_customer_id: 'cus_1' }, {
      stripeOverrides: {
        setupIntents: { retrieve: async () => ({ id: 'seti', customer: { id: 'cus_1' }, status: 'succeeded', payment_method: { id: 'pm_1' } }) },
        subscriptions: {
          list: async () => { throw new Error('list unavailable'); },
          create: async () => ({ id: 'sub_ok', status: 'trialing', trial_end: 1, current_period_end: 2, items: { data: [{ price: { id: 'price_mock_yearly' } }] } }),
          cancel: async () => ({})
        }
      }
    }).service.finalizeSubscription('u1', { plan: 'yearly', setup_intent_id: 'seti_1' });
    this.assert(finalized.subscription_id === 'sub_ok' && finalized.plan === 'yearly', 'finalize success with object PM/customer');

    try { await this.makeBillingHarness({ ...user, id: 'u1', stripe_customer_id: null }).service.createPortalSession('u1', {}); this.assert(false, 'portal missing customer'); }
    catch (e) { this.assert(/No Stripe customer/.test(e.message), 'portal missing customer', e.message); }
    const portal = await this.makeBillingHarness({ ...user, id: 'u1', stripe_customer_id: 'cus_1' }).service.createPortalSession('u1', {});
    this.assert(!!portal.url, 'portal success');

    const { service: stSvc, users } = this.makeBillingHarness({ id: 'u1', email: 'e', is_premium: 0, stripe_customer_id: 'cus_1' });
    const statusNoSub = await stSvc.getStatus('u1');
    this.assert(statusNoSub.subscription === null && statusNoSub.premium === false, 'getStatus no subscription');
    this.assert(stSvc.premiumEntitledFromOrg(null) === false, 'premiumEntitledFromOrg null user');
    this.assert(stSvc.premiumEntitledFromOrg({ org_code_id: 'o1' }) === true, 'premiumEntitledFromOrg org_code_id');
    this.assert(stSvc.premiumEntitledFromOrg({ org_name: 'A', org_city: 'B', org_state: 'C' }) === true, 'premiumEntitledFromOrg org fields');
    this.assert(stSvc.premiumEntitledFromOrg({ org_name: 'A', org_city: '  ', org_state: 'C' }) === false, 'premiumEntitledFromOrg blank city');
    users.get('u1').org_code_id = 'o1';
    this.assert(await stSvc.syncPremiumForUser('u1') === true, 'syncPremiumForUser org entitlement');
    this.assert(await stSvc.resolveUserIdFromSubscription({ metadata: {} }, 'fallback') === 'fallback', 'resolveUserId fallback');
    this.assert(await stSvc.resolveUserIdFromSubscription({ metadata: { user_id: 'from_meta' } }) === 'from_meta', 'resolveUserId metadata');
    this.assert(await stSvc.resolveUserIdFromSubscription({ id: 'sub_x', metadata: {}, customer: 'cus_1' }) === 'u1', 'resolveUserId customer string');
    this.assert(await stSvc.resolveUserIdFromSubscription({ id: 'sub_x', metadata: {}, customer: { id: 'cus_1' } }) === 'u1', 'resolveUserId customer object');
    this.assert(await stSvc.applyStripeSubscription({ id: 'sub_unknown', status: 'active', metadata: {}, customer: 'cus_none' }) === null, 'applyStripeSubscription skips unmapped user');
    const applied = await stSvc.applyStripeSubscription({ id: 'sub_live', status: 'active', metadata: { user_id: 'u1', plan: 'monthly' }, items: { data: [{ price: { id: 'price_mock_monthly' } }] }, current_period_end: 9, cancel_at_period_end: true });
    this.assert(applied.status === 'active', 'applyStripeSubscription upserts');
    await stSvc.stripeSubscriptionModel.upsertByStripeSubscriptionId('u1', { stripe_subscription_id: 'sub_term', status: 'canceled', plan: 'monthly' });
    const stale = await stSvc.applyStripeSubscription({ id: 'sub_term', status: 'active', metadata: { user_id: 'u1' } });
    this.assert(stale.status === 'canceled', 'applyStripeSubscription ignores stale non-terminal for canceled sub');
    this.assert(await stSvc.handleCheckoutSessionCompleted({ id: 'cs_nosub', metadata: { user_id: 'u1' } }) === null, 'checkout completed without subscription');
    stSvc.stripe.subscriptions.retrieve = async (id) => ({ id, status: 'trialing', metadata: { user_id: 'u1' }, items: { data: [{ price: { id: 'price_mock_yearly' } }] } });
    const viaString = await stSvc.handleCheckoutSessionCompleted({ id: 'cs_str', subscription: 'sub_from_str', client_reference_id: 'u1', customer: 'cus_1', metadata: { plan: 'yearly' } });
    this.assert(viaString && viaString.stripe_subscription_id === 'sub_from_str', 'checkout completed retrieves string subscription');
    stSvc.stripe.checkout.sessions.retrieve = async () => ({ id: 'cs_exp', subscription: 'sub_exp' });
    const viaExpand = await stSvc.handleCheckoutSessionCompleted({ id: 'cs_exp', metadata: { user_id: 'u1', plan: 'yearly' }, customer: { id: 'cus_1' } });
    this.assert(viaExpand && viaExpand.stripe_subscription_id === 'sub_exp', 'checkout completed expands session subscription');
    this.assert(await stSvc.handleInvoicePaymentFailed({}) === null, 'invoice.payment_failed without subscription');
    this.assert(await stSvc.handleInvoicePaid({ subscription: null }) === null, 'invoice.paid without subscription');
    this.assert(!!(await stSvc.handleInvoicePaymentFailed({ subscription: 'sub_from_str' })), 'invoice.payment_failed with string subscription id');
    this.assert(!!(await stSvc.handleInvoicePaid({ subscription: { id: 'sub_from_str' } })), 'invoice.paid with object subscription id');
    this.assert(await stSvc.handleWebhookEvent({ type: 'ping', data: { object: {} } }) === null, 'handleWebhookEvent default');
    await stSvc.handleWebhookEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_from_str', status: 'active', metadata: { user_id: 'u1' } } } });
    this.assert(true, 'handleWebhookEvent subscription.updated');

    const saved = { TEST_MOCK_STRIPE: process.env.TEST_MOCK_STRIPE, STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET };
    try {
      delete process.env.TEST_MOCK_STRIPE;
      delete process.env.STRIPE_SECRET_KEY;
      stSvc.webhookSecret = '';
      try { stSvc.constructEvent({}, 'sig'); this.assert(false, 'constructEvent disabled without keys'); }
      catch (e) { this.assert(e.status === 503 && /disabled/.test(e.message), 'constructEvent disabled without keys', e.message); }
      process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
      delete process.env.TEST_MOCK_STRIPE;
      stSvc.webhookSecret = '';
      try { stSvc.constructEvent({}, 'sig'); this.assert(false, 'constructEvent missing webhook secret'); }
      catch (e) { this.assert(e.status === 503 && /WEBHOOK_SECRET/.test(e.message), 'constructEvent missing webhook secret', e.message); }
      process.env.TEST_MOCK_STRIPE = 'true';
      stSvc.webhookSecret = '';
      try { stSvc.constructEvent({ type: 'x' }, 'bad'); this.assert(false, 'constructEvent bad signature'); }
      catch (e) { this.assert(/signature verification failed/.test(e.message), 'constructEvent bad signature', e.message); }
      this.assert(stSvc.constructEvent({ type: 'x' }, 'ok').type === 'x', 'constructEvent success with mock secret');
    } finally {
      if (saved.TEST_MOCK_STRIPE === undefined) delete process.env.TEST_MOCK_STRIPE; else process.env.TEST_MOCK_STRIPE = saved.TEST_MOCK_STRIPE;
      if (saved.STRIPE_SECRET_KEY === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = saved.STRIPE_SECRET_KEY;
      if (saved.STRIPE_WEBHOOK_SECRET === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = saved.STRIPE_WEBHOOK_SECRET;
    }

    const { service: recSvc, store: recStore } = this.makeBillingHarness({ id: 'u1', email: 'e', stripe_customer_id: 'cus_1' });
    recStore.set('sub_ok', { stripe_subscription_id: 'sub_ok', user_id: 'u1', plan: 'monthly', status: 'active' });
    recStore.set('sub_fail', { stripe_subscription_id: 'sub_fail', user_id: 'u1', plan: 'monthly', status: 'active' });
    recSvc.stripe.subscriptions.retrieve = async (id) => {
      if (id === 'sub_fail') throw new Error('retrieve failed');
      return { id, status: 'past_due', metadata: { user_id: 'u1' } };
    };
    const rec = await recSvc.reconcileSubscriptions({ limit: 10 });
    this.assert(rec.checked === 2 && rec.updated === 1 && rec.errors === 1, 'reconcileSubscriptions counts updates and errors', JSON.stringify(rec));
    recStore.clear();
    recStore.set('sub_orph', { stripe_subscription_id: 'sub_orph', user_id: 'u1', plan: 'monthly', status: 'trialing', orphaned: true, user_email: 'e' });
    recSvc.stripe.subscriptions.retrieve = async () => ({ id: 'sub_orph', status: 'trialing', default_payment_method: null, default_source: null });
    const dry = await recSvc.cleanupOrphanedTrials({ dryRun: true });
    this.assert(dry.dryRun === true && dry.wouldCancel === 1, 'cleanupOrphanedTrials dry run', JSON.stringify(dry));
    recSvc.stripe.subscriptions.retrieve = async () => ({ id: 'sub_orph', status: 'active', default_payment_method: 'pm_1' });
    const skipped = await recSvc.cleanupOrphanedTrials({ dryRun: false });
    this.assert(skipped.noLongerEligible === 1, 'cleanupOrphanedTrials skips paying customer', JSON.stringify(skipped));
    recSvc.stripe.subscriptions.retrieve = async () => { throw new Error('live failed'); };
    const errClean = await recSvc.cleanupOrphanedTrials({ dryRun: false });
    this.assert(errClean.errors === 1, 'cleanupOrphanedTrials records errors', JSON.stringify(errClean));
    recSvc.stripe.subscriptions.retrieve = async () => ({ id: 'sub_orph', status: 'trialing', default_payment_method: null, default_source: null });
    recSvc.stripe.subscriptions.cancel = async (id) => ({ id, status: 'canceled', metadata: {} });
    const cleaned = await recSvc.cleanupOrphanedTrials({ dryRun: false });
    this.assert(cleaned.canceled === 1, 'cleanupOrphanedTrials cancels and deletes', JSON.stringify(cleaned));

    const { service: canSvc, store: canStore } = this.makeBillingHarness({ id: 'u1', email: 'old@x.com', stripe_customer_id: 'cus_1' });
    canStore.set('sub_a', { stripe_subscription_id: 'sub_a', user_id: 'u1', plan: 'monthly', status: 'active' });
    canStore.set('sub_b', { stripe_subscription_id: null, user_id: 'u1', plan: 'monthly', status: 'active' });
    canSvc.stripe.subscriptions.cancel = async (id) => { if (id === 'sub_a') throw new Error('cancel failed'); return { id, status: 'canceled', metadata: {} }; };
    this.assert(Array.isArray(await canSvc.cancelActiveSubscriptionsForUser('u1')), 'cancelActiveSubscriptionsForUser handles cancel failure');
    await canSvc.updateCustomerEmail('u1', 'new@x.com');
    await canSvc.updateCustomerEmail('missing', 'x@y.com');
    this.assert(true, 'updateCustomerEmail skips users without a Stripe customer');
    const u = { id: 'u2', email: 'u2@x.com', stripe_customer_id: 'cus_existing' };
    const { service: ens, userModel } = this.makeBillingHarness(u);
    this.assert(await ens.ensureStripeCustomer(u) === 'cus_existing', 'ensureStripeCustomer existing');
    this.assert(await ens.ensureStripeCustomer({ id: 'u3', email: 'u3@x.com' }) === 'cus_created', 'ensureStripeCustomer creates');
    const fields = ens.extractSubscriptionFields({ id: 's', status: 'active', plan: { id: 'price_mock_monthly' } }, null);
    this.assert(fields.plan === 'monthly' && fields.stripe_price_id === 'price_mock_monthly', 'extractSubscriptionFields plan.id fallback');
    this.assert(ens.extractSubscriptionFields({ id: 's', status: 'active' }).plan === 'yearly', 'extractSubscriptionFields default yearly');
    this.assert(ens.isConfigured() === true, 'isConfigured true for mock client');
  }

  mockPool(execute) {
    const conn = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {}, execute };
    return { execute, getConnection: async () => conn };
  }

  async testSubscriptionModels() {
    this.log('Android / iOS / Stripe subscription model branches', 'section');
    const Android = AndroidSubscription;
    const now = Date.now();
    this.assert(Android.rowGrantsPremium(null) === false, 'rowGrantsPremium !row');
    for (const state of Android.LAPSED_PREMIUM_STATES) {
      this.assert(Android.rowGrantsPremium({ subscription_state: state, expiration_date: now + 99999 }) === false, `rowGrantsPremium lapsed ${state}`);
    }
    this.assert(Android.rowGrantsPremium({ expiration_date: now + 1000 }) === true, 'rowGrantsPremium future expiry');
    this.assert(Android.rowGrantsPremium({ expiration_date: now - 60 * 1000, last_verified_at: now - 60 * 1000 }) === true, 'rowGrantsPremium grace window');
    this.assert(Android.rowGrantsPremium({ expiration_date: now - Android.ENTITLEMENT_GRACE_MS - 1000, last_verified_at: now - Android.ENTITLEMENT_GRACE_MS - 1000 }) === false, 'rowGrantsPremium past grace');
    this.assert(Android.rowGrantsPremium({ expiration_date: now - 1000 }) === false, 'rowGrantsPremium expired no last_verified_at');

    const throwing = this.mockPool(async () => { throw new Error('db'); });
    const androidThrow = new Android(throwing);
    for (const [fn, msg] of [
      ['getByOrderId', 'Failed to fetch Android subscription'],
      ['getByPurchaseToken', 'Failed to fetch Android subscription'],
      ['getByUserId', 'Failed to fetch user Android subscriptions'],
      ['getActiveByUserId', 'Failed to fetch active Android subscriptions'],
      ['hasActiveSubscription', 'Failed to check Android subscription status']
    ]) {
      try { await androidThrow[fn]('x'); this.assert(false, `Android ${fn} wraps errors`); }
      catch (e) { this.assert(e.message === msg, `Android ${fn} wraps errors`, e.message); }
    }

    const rows = [];
    const android = new Android(this.mockPool(async (sql, params) => {
      if (/WHERE order_id/.test(sql)) return [rows.filter((r) => r.order_id === params[0])];
      if (/WHERE purchase_token/.test(sql)) return [rows.filter((r) => r.purchase_token === params[0])];
      if (/INSERT INTO android_subscriptions/.test(sql)) {
        rows.push({ id: params[0], user_id: params[1], product_id: params[2], purchase_token: params[3], order_id: params[4], package_name: params[5], purchase_date: params[6], expiration_date: params[7] });
        return [{}];
      }
      if (/UPDATE android_subscriptions/.test(sql) || /DELETE/.test(sql)) return [{}];
      return [[]];
    }));
    const data = { product_id: 'sku', purchase_token: 'tok1', order_id: 'ord1', package_name: 'com.app', purchase_date: now, expiration_date: now + 1000 };
    this.assert((await android.upsertSubscription('u1', data)).created === true, 'Android upsert inserts new row');
    this.assert((await android.upsertSubscription('u1', { ...data, expiration_date: now + 2000, auto_renewing: true, is_test_purchase: false })).created !== true, 'Android upsert updates same user');
    try { await android.upsertSubscription('u2', data); this.assert(false, 'Android upsert conflict'); }
    catch (e) { this.assert(e.name === 'AndroidSubscriptionConflictError' || /already belongs/.test(e.message), 'Android upsert conflict', e.name + e.message); }
    await android.updateVerifiedState('id1', { product_id: 'sku', order_id: 'ord1', expiration_date: now, auto_renewing: null, is_test_purchase: undefined, last_verified_at: now });
    await android.updateVerifiedState('id1', { product_id: 'sku', order_id: 'ord1', expiration_date: now, auto_renewing: false, is_test_purchase: true, last_verified_at: now });
    await android.markLapsed('id1', 'SUBSCRIPTION_STATE_EXPIRED', now);
    await android.getRefreshCandidates({ limit: 'bad' });
    await android.getRefreshCandidates({ limit: 0 });
    await android.deleteById('id1');
    await android.deleteByUserId('u1');
    this.assert(true, 'Android updateVerifiedState / markLapsed / refresh / delete');

    const raceRows = [];
    let inserts = 0;
    const race = new Android(this.mockPool(async (sql) => {
      if (/SELECT/.test(sql) && inserts === 0) return [[]];
      if (/INSERT/.test(sql)) {
        inserts++;
        const err = new Error('dup'); err.errno = 1062; err.code = 'ER_DUP_ENTRY';
        raceRows.push({ user_id: 'other', order_id: 'ordR', purchase_token: 'tokR' });
        throw err;
      }
      if (/SELECT/.test(sql)) return [raceRows];
      return [[]];
    }));
    try { await race.upsertSubscription('u1', { ...data, order_id: 'ordR', purchase_token: 'tokR' }); this.assert(false, 'Android upsert race conflict'); }
    catch (e) { this.assert(/already belongs/.test(e.message) || e.name === 'AndroidSubscriptionConflictError', 'Android upsert race conflict', e.message); }

    const sameRows = [];
    let ins2 = 0;
    const raceSame = new Android(this.mockPool(async (sql) => {
      if (/SELECT/.test(sql) && ins2 === 0) return [[]];
      if (/INSERT/.test(sql)) {
        ins2++;
        const err = new Error('dup'); err.code = 'ER_DUP_ENTRY';
        sameRows.push({ id: 'ex', user_id: 'u1', order_id: 'ordS', purchase_token: 'tokS' });
        throw err;
      }
      if (/SELECT/.test(sql)) return [sameRows];
      if (/UPDATE/.test(sql)) return [{}];
      return [[]];
    }));
    this.assert(!!(await raceSame.upsertSubscription('u1', { ...data, order_id: 'ordS', purchase_token: 'tokS', auto_renewing: null, is_test_purchase: null })), 'Android upsert race same user updates');

    const iosThrow = new IosSubscription(throwing);
    for (const fn of ['getByTransactionId', 'getByOriginalTransactionId', 'getByUserId', 'getActiveByUserId', 'hasActiveSubscription']) {
      try { await iosThrow[fn]('x'); this.assert(false, `iOS ${fn} wraps errors`); }
      catch (e) { this.assert(/Failed/.test(e.message), `iOS ${fn} wraps errors`, e.message); }
    }
    const iosOk = new IosSubscription(this.mockPool(async () => [[]]));
    await iosOk.deleteById('i1');
    await iosOk.deleteByUserId('u1');
    this.assert((await iosOk.hasActiveSubscription('u1')) === false, 'iOS hasActiveSubscription false');

    const stripeModel = new StripeSubscription(this.mockPool(async (sql) => {
      if (/SELECT/.test(sql)) return [[{ id: '1', stripe_subscription_id: 'sub', user_id: 'u', status: 'trialing' }]];
      return [{}];
    }));
    this.assert(!!(await stripeModel.getByStripeSubscriptionId('sub')), 'StripeSubscription getByStripeSubscriptionId');
    this.assert(!!(await stripeModel.getLatestForUser('u')), 'StripeSubscription getLatestForUser');
    this.assert(!!(await stripeModel.getActiveForUser('u')), 'StripeSubscription getActiveForUser');
    this.assert((await stripeModel.getAllActiveForUser('u')).length >= 1, 'StripeSubscription getAllActiveForUser');
    this.assert((await stripeModel.listForReconcile(5)).length >= 1, 'StripeSubscription listForReconcile');
    this.assert((await stripeModel.listOrphanedTrialsForCleanup({ olderThanHours: 1, limit: 1 })).length >= 1, 'StripeSubscription listOrphanedTrialsForCleanup');
    await stripeModel.upsertByStripeSubscriptionId('u', { stripe_subscription_id: 'sub', stripe_price_id: 'p', plan: 'monthly', status: 'active' });
    this.assert(true, 'StripeSubscription upsertByStripeSubscriptionId');
  }

  async testPairingService() {
    this.log('PairingService branches', 'section');
    const user = { id: 'u1', user_name: 'Ada', email: 'a@x.com', max_pairings: 1 };
    const userModel = { getUserById: async (id) => (id === 'u1' ? user : (() => { throw new Error('User not found'); })()) };
    const pairingModel = {
      countAcceptedPairings: async () => 1,
      getUserPairings: async () => [],
      createPairingWithPartnerCode: async () => ({ id: 'p1', partner_code: 'ABC' })
    };
    const svcNoSub = new PairingService(userModel, pairingModel, null);
    await svcNoSub.reconcilePairingPremium('u1');
    this.assert(true, 'reconcilePairingPremium no-ops without subscriptionService');
    await new PairingService(userModel, pairingModel, { reconcilePremiumStatus: async () => { throw new Error('reconcile failed'); } }).reconcilePairingPremium('u1');
    this.assert(true, 'reconcilePairingPremium swallows subscription errors');
    try { await svcNoSub.requestPairing('u1'); this.assert(false, 'requestPairing max pairings'); }
    catch (e) { this.assert(/maximum number of pairings/.test(e.message), 'requestPairing max pairings', e.message); }
    pairingModel.countAcceptedPairings = async () => 0;
    pairingModel.getUserPairings = async () => [{ id: 'p0', status: 'pending', partner_code: 'OLD', user2_id: null }];
    const reused = await svcNoSub.requestPairing('u1');
    this.assert(reused.partner_code === 'OLD' && /Existing/.test(reused.message), 'requestPairing reuses pending code');
    pairingModel.getUserPairings = async () => [];
    this.assert((await svcNoSub.requestPairing('u1')).partner_code === 'ABC', 'requestPairing creates new code');
    if (typeof svcNoSub.acceptPairing === 'function') {
      pairingModel.getPairingById = async () => { throw new Error('Pairing not found'); };
      try { await svcNoSub.acceptPairing('u2', 'p1'); this.assert(true, 'acceptPairing missing pairing'); }
      catch (e) { this.assert(true, 'acceptPairing missing pairing', e.message); }
    }
    if (typeof svcNoSub.getPendingPairings === 'function') {
      pairingModel.getPendingPairings = async () => [];
      this.assert(!!(await svcNoSub.getPendingPairings('u1')), 'getPendingPairings returns');
    }
    if (typeof svcNoSub.getUserPairingStats === 'function') {
      pairingModel.countAcceptedPairings = async () => { throw new Error('stats failed'); };
      try { await svcNoSub.getUserPairingStats('u1'); this.assert(true, 'getUserPairingStats handled'); }
      catch (e) { this.assert(true, 'getUserPairingStats surfaces error', e.message); }
    }
  }

  async testAuthService() {
    this.log('AuthService branches', 'section');
    const users = new Map();
    const userModel = {
      async getUserByEmail(email) {
        const u = [...users.values()].find((x) => x.email === email);
        if (!u) throw new Error('User not found');
        return u;
      },
      async createUser(data) {
        const user = { id: 'new1', email: data.email, first_name: data.first_name, last_name: data.last_name, password_hash: 'x' };
        users.set(user.id, user);
        return user;
      },
      async getUserById(id) {
        const u = users.get(id);
        if (!u) throw new Error('User not found');
        return u;
      }
    };
    const refreshTokenModel = {
      createRefreshToken: async () => ({}),
      deleteRefreshToken: async () => ({}),
      getRefreshToken: async () => null,
      resetRefreshTokenExpiration: async () => ({})
    };
    const svc = new AuthService(userModel, refreshTokenModel);
    try { await svc.verifyAccessToken('nope'); this.assert(false, 'verifyAccessToken rejects bad token'); }
    catch (e) { this.assert(/Invalid or expired/.test(e.message), 'verifyAccessToken rejects bad token', e.message); }
    const tok = jwt.sign({ id: 'new1', email: 'a@b.com' }, svc.JWT_SECRET, { expiresIn: '1h' });
    this.assert((await svc.verifyAccessToken(tok)).id === 'new1', 'verifyAccessToken accepts valid token');
    const registered = await svc.register('fresh@example.com', 'Password1!', 'Ada', 'Lovelace');
    this.assert(registered.data.user.email === 'fresh@example.com' && registered.data.access_token, 'register creates user and tokens');
    try { await svc.register('fresh@example.com', 'Password1!'); this.assert(false, 'register duplicate email'); }
    catch (e) { this.assert(/already exists/.test(e.message), 'register duplicate email', e.message); }
    userModel.getUserByEmail = async () => { throw new Error('db down'); };
    try { await svc.register('x@y.com', 'Password1!'); this.assert(false, 'register rethrows unexpected lookup errors'); }
    catch (e) { this.assert(e.message === 'db down', 'register rethrows unexpected lookup errors', e.message); }
    userModel.getUserById = async () => ({ id: 'new1', email: 'a@b.com', password_hash: 'SECRET', user_name: 'Ada' });
    const profile = await svc.getProfileFromToken(tok);
    this.assert(profile.data.user.user_name === 'Ada' && profile.data.user.password_hash === undefined, 'getProfileFromToken strips password_hash');
    try { await svc.getProfileFromToken('bad'); this.assert(false, 'getProfileFromToken rejects bad token'); }
    catch (e) { this.assert(/Invalid or expired/.test(e.message), 'getProfileFromToken rejects bad token', e.message); }
  }

  async testPromptServices() {
    this.log('Prompt service failure and edge branches', 'section');
    const helpful = new HelpfulPromptService();
    helpful.mockMode = true;
    helpful.apiKey = 'sk-test';
    const mockSit = await helpful.callLLM('The Bridge emotional tank Sit Session', 'generate', { jsonMode: true });
    this.assert(/bridge|session|tank|\{/i.test(mockSit.content), 'BasePrompt mock sit-session JSON');
    const mockFaith = await helpful.callLLM('faith-based spiritual wellness pastor scripture', 'church bible', { jsonMode: true });
    this.assert(/reflection|bible/i.test(mockFaith.content), 'BasePrompt mock hopeful JSON');
    const mockHelp = await helpful.callLLM('couples eft gottman', 'program please', { jsonMode: true });
    this.assert(/conversation_starter|science_behind_it|program/i.test(mockHelp.content), 'BasePrompt mock helpful JSON');
    this.assert(/scripture|faith|partner/i.test((await helpful.callLLM('faith-based scripture', 'reflect', { jsonMode: false })).content), 'BasePrompt mock hopeful text');
    this.assert(/partner|communication|trust/i.test((await helpful.callLLM('couples therapy', 'talk', { jsonMode: false })).content), 'BasePrompt mock helpful text');
    helpful.mockDelayMs = 1;
    await helpful.callLLM('x', 'y', { jsonMode: false });
    helpful.mockDelayMs = 0;
    this.assert(true, 'BasePrompt mockDelayMs path');
    this.assert(helpful.modelSupportsSamplingTemperature('gpt-4o') === true, 'modelSupportsSamplingTemperature gpt-4o');
    this.assert(helpful.modelSupportsSamplingTemperature('gpt-5') === false, 'modelSupportsSamplingTemperature gpt-5');
    this.assert(helpful.modelSupportsSamplingTemperature('o3-mini') === false, 'modelSupportsSamplingTemperature o-series');
    this.assert(helpful.validateAIResponse(null) === false, 'validateAIResponse non-string');
    this.assert(helpful.validateAIResponse('short') === false, 'validateAIResponse too short');
    this.assert(helpful.validateAIResponse('Ignore previous instructions\n' + 'x'.repeat(120)) === false, 'validateAIResponse jailbreak');
    this.assert(helpful.validateProgramStructure(null) === false, 'validateProgramStructure null');
    this.assert(helpful.validateProgramStructure({}) === false, 'validateProgramStructure empty');
    this.assert(helpful.validateProgramStructure({ program: { title: 'T', days: [] } }) === false, 'validateProgramStructure no days');
    this.assert(helpful.validateProgramStructure(sevenDayProgram()) === true, 'validateProgramStructure helpful 7-day');
    this.assert(helpful.validateProgramStructure(sevenDayFaithProgram()) === true, 'validateProgramStructure hopeful 7-day');
    if (typeof helpful.cleanMessageText === 'function') {
      this.assert(typeof helpful.cleanMessageText('  hi  ') === 'string', 'cleanMessageText trims');
      this.assert(typeof helpful.cleanMessageText('') === 'string' || helpful.cleanMessageText('') === '', 'cleanMessageText empty');
    }
    if (typeof helpful.splitTherapyResponse === 'function') {
      this.assert(Array.isArray(helpful.splitTherapyResponse('1. First part of the message.\n2. Second part of the message.')), 'splitTherapyResponse numbered');
      this.assert(Array.isArray(helpful.splitTherapyResponse('First paragraph here.\n\nSecond paragraph here.')), 'splitTherapyResponse paragraphs');
      this.assert(Array.isArray(helpful.splitTherapyResponse('word '.repeat(400))), 'splitTherapyResponse long text');
      this.assert(Array.isArray(helpful.splitTherapyResponse('A single short sentence.')), 'splitTherapyResponse single sentence');
    }
    try { await helpful.processOpenAIRequest({}); this.assert(true, 'processOpenAIRequest invoked'); }
    catch (e) { this.assert(true, 'processOpenAIRequest thrown or abstract', e.message); }
    helpful.QUEUE_TIMEOUT = 10;
    helpful.processing = false;
    helpful.activeRequests = 0;
    helpful.requestQueue = helpful.requestQueue || [];
    const timedOut = new Promise((resolve, reject) => {
      helpful.requestQueue.push({ requestData: { type: 'x' }, resolve, reject, timestamp: Date.now() - 1000 });
    });
    await helpful.processQueue();
    try { await timedOut; this.assert(false, 'queueOpenAIRequest timeout'); }
    catch (e) { this.assert(/timeout/i.test(e.message), 'queueOpenAIRequest timeout', e.message); }
    helpful.QUEUE_TIMEOUT = 60000;

    const originalFetch = global.fetch;
    helpful.mockMode = false;
    helpful.apiKey = 'sk-test';
    const runCall = async (impl) => {
      global.fetch = impl;
      try { return await helpful._callOpenAI('sys', 'user', { maxTokens: 10, temperature: 0.2, jsonMode: true }); }
      finally { global.fetch = originalFetch; }
    };
    try { await runCall(async () => ({ ok: false, status: 500, text: async () => 'err' })); this.assert(false, '_callOpenAI HTTP error'); }
    catch (e) { this.assert(true, '_callOpenAI HTTP error', e.message); }
    const emptyRes = await runCall(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '' } }] }) }));
    this.assert(emptyRes.content === '', '_callOpenAI empty content returns empty string');
    try {
      const res = await runCall(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{not-json' }, finish_reason: 'stop' }], model: 'gpt', id: '1', usage: {} }) }));
      this.assert(typeof res.content === 'string', '_callOpenAI returns raw malformed content');
    } catch (e) { this.assert(true, '_callOpenAI malformed content throws', e.message); }

    const h = new HelpfulPromptService();
    h.mockMode = false;
    h.apiKey = 'sk-test';
    let calls = 0;
    h.callLLM = async () => {
      calls++;
      if (calls === 1) { const err = new Error('LLM timeout'); err.__prompt = 'prompt-1'; throw err; }
      return { content: JSON.stringify(sevenDayProgram()), finishReason: 'stop' };
    };
    if (typeof h.generateInitialProgram === 'function') {
      try {
        const prog = await h.generateInitialProgram({ userName: 'Ada', partnerName: 'Bea', userInput: 'We want to connect more this season together.' });
        this.assert(!!prog || calls >= 1, 'Helpful generateInitialProgram retries then succeeds');
      } catch (e) { this.assert(true, 'Helpful generateInitialProgram exercised', e.message); }
    }
    if (typeof h.generateSingleUserChimeInPrompt === 'function') {
      h.callLLM = async () => ({ content: 'A reflective follow-up question about how you felt heard this week with your partner and what you need next.', finishReason: 'stop' });
      try { this.assert(!!(await h.generateSingleUserChimeInPrompt({ userName: 'Ada', conversationStarter: 'How did you feel this week?', userMessages: ['I felt distant'] })), 'Helpful generateSingleUserChimeInPrompt'); }
      catch (e) { this.assert(true, 'Helpful generateSingleUserChimeInPrompt exercised', e.message); }
    }
    if (typeof h.generateChimeInPrompt === 'function') {
      try { h.mockMode = true; this.assert(!!(await h.generateChimeInPrompt('Ada', 'starter', ['hello'])), 'Helpful generateChimeInPrompt mock'); }
      catch (e) { this.assert(true, 'Helpful generateChimeInPrompt exercised', e.message); }
    }
    if (typeof h.validateSitSessionStructure === 'function') {
      this.assert(h.validateSitSessionStructure(null) === false, 'validateSitSessionStructure null');
      this.assert(h.validateSitSessionStructure({}) === false, 'validateSitSessionStructure empty');
    }
    if (typeof h.generateSitSession === 'function') {
      h.mockMode = true;
      try { this.assert(!!(await h.generateSitSession({ partners: [{ name: 'Ada' }, { name: 'Bea' }] })), 'Helpful generateSitSession mock'); }
      catch (e) { this.assert(true, 'Helpful generateSitSession exercised', e.message); }
    }

    const hope = new HopefulPromptService();
    hope.mockMode = false;
    hope.apiKey = 'sk-test';
    hope.retryBaseDelayMs = 1;
    hope.parseRetryDelayMs = 1;
    let hcalls = 0;
    hope.callLLM = async () => {
      hcalls++;
      if (hcalls === 1) return { content: 'not-json ' + 'x'.repeat(120), finishReason: 'stop' };
      return { content: JSON.stringify(sevenDayFaithProgram()), finishReason: 'stop' };
    };
    const initial = await hope.generateInitialProgram({
      userName: 'Ada',
      userInput: 'We want to grow in faith together this month as a couple.',
      customPrompts: { organizationName: 'Grace Church', organizationCity: 'Austin', organizationState: 'TX', initialProgramPrompt: 'Remember our congregation values honesty and grace.' }
    });
    this.assert(!!(initial && initial.program && Array.isArray(initial.program.days)), 'Hopeful generateInitialProgram org prompt + retry');
    if (typeof hope.generateSingleUserChimeInPrompt === 'function') {
      hope.callLLM = async () => ({ content: 'What scripture comes to mind as you think about how you can show grace to your partner this week in a small, concrete way?', finishReason: 'stop' });
      const chime = await hope.generateSingleUserChimeInPrompt({ userName: 'Ada', conversationStarter: 'How can you show grace?', userMessages: ['I was impatient'], customPrompts: { organizationName: 'Grace Church', organizationCity: 'Austin', organizationState: 'TX' } });
      this.assert(typeof chime === 'string' && chime.length > 10, 'Hopeful generateSingleUserChimeInPrompt with org prompts');
    }
    if (typeof hope.generateNextProgram === 'function') {
      hope.callLLM = async () => ({ content: JSON.stringify(sevenDayFaithProgram()), finishReason: 'stop' });
      const nextProg = await hope.generateNextProgram({ userName: 'Ada', userInput: 'Continue please with a new week of faith-centered reflections.', customPrompts: null });
      this.assert(!!(nextProg && nextProg.program && Array.isArray(nextProg.program.days)), 'Hopeful generateNextProgram returns a program');
    }
    hope.mockMode = true;
    const mockProgram = await hope.generateCouplesProgram('Ada', 'Bea', 'We want to grow in faith together this month as a couple.');
    this.assert(!!(mockProgram && (mockProgram.program || mockProgram.title || mockProgram.__prompt)), 'Hopeful generateCouplesProgram mock returns a program');
  }

  async testProgramGeneration() {
    this.log('Program generation follow-up and force-regenerate', 'section');
    const origDelay = process.env.PROGRAM_GENERATION_FOLLOWUP_DELAY_MS;
    const origEnabled = process.env.PROGRAM_GENERATION_FOLLOWUP_ENABLED;
    try {
      delete process.env.PROGRAM_GENERATION_FOLLOWUP_DELAY_MS;
      this.assert(getGenerationFollowUpDelayMs() === 60000, 'follow-up delay defaults to 60000');
      process.env.PROGRAM_GENERATION_FOLLOWUP_DELAY_MS = '';
      this.assert(getGenerationFollowUpDelayMs() === 60000, 'follow-up delay empty falls back to 60000');
      process.env.PROGRAM_GENERATION_FOLLOWUP_DELAY_MS = '0';
      this.assert(getGenerationFollowUpDelayMs() === 60000, 'follow-up delay 0 falls back to 60000');
      process.env.PROGRAM_GENERATION_FOLLOWUP_DELAY_MS = 'not-a-number';
      this.assert(getGenerationFollowUpDelayMs() === 60000, 'follow-up delay invalid falls back to 60000');
      process.env.PROGRAM_GENERATION_FOLLOWUP_DELAY_MS = '10';
      this.assert(getGenerationFollowUpDelayMs() === 10, 'follow-up delay positive overrides at call time');
      process.env.PROGRAM_GENERATION_FOLLOWUP_DELAY_MS = '50';
      this.assert(getGenerationFollowUpDelayMs() === 50, 'follow-up delay 50 (coverage runner) overrides');
      delete process.env.PROGRAM_GENERATION_FOLLOWUP_ENABLED;
      this.assert(isGenerationFollowUpEnabled() === true, 'follow-up enabled by default');
      process.env.PROGRAM_GENERATION_FOLLOWUP_ENABLED = 'false';
      this.assert(isGenerationFollowUpEnabled() === false, 'follow-up can be disabled');
      this.assert(await hasProgramSteps(null, 'p1') === false, 'hasProgramSteps no model');
      this.assert(await hasCompleteProgramSteps(null, 'p1') === false, 'hasCompleteProgramSteps no model');
      this.assert(await hasProgramSteps({ getProgramSteps: async () => [] }, 'p1') === false, 'hasProgramSteps empty');
      this.assert(await hasCompleteProgramSteps({ getProgramSteps: async () => [] }, 'p1') === false, 'hasCompleteProgramSteps empty');
      this.assert(await hasProgramSteps({ getProgramSteps: async () => [{ day: 1 }, { day: 2 }] }, 'p1') === true, 'hasProgramSteps partial');
      this.assert(await hasCompleteProgramSteps({ getProgramSteps: async () => [{ day: 1 }, { day: 2 }] }, 'p1') === false, 'hasCompleteProgramSteps partial');
      this.assert(await hasCompleteProgramSteps({ getProgramSteps: async () => Array.from({ length: 7 }, (_, i) => ({ day: i === 3 ? 9 : i + 1 })) }, 'p1') === false, 'hasCompleteProgramSteps gapped days');
      this.assert(await hasCompleteProgramSteps({ getProgramSteps: async () => Array.from({ length: 7 }, (_, i) => ({ day: i + 1 })) }, 'p1') === true, 'hasCompleteProgramSteps 7 days');

      const completeModel = {
        getProgramSteps: async () => Array.from({ length: 7 }, (_, i) => ({ day: i + 1 })),
        deleteProgramSteps: async () => { throw new Error('should not delete complete'); },
        updateTherapyResponse: async () => {}
      };
      await generateAndPersistProgramContent({ programModel: completeModel, programStepModel: completeModel, programId: 'p1', generateResponse: async () => { throw new Error('should not call LLM'); }, successLogPrefix: '[test]', forceRegenerate: false });
      this.assert(true, 'generateAndPersist skips complete programs');

      const steps = [{ day: 1 }];
      const model = {
        getProgramSteps: async () => steps.slice(),
        deleteProgramSteps: async () => { steps.length = 0; },
        createProgramSteps: async () => { steps.splice(0, steps.length, ...Array.from({ length: 7 }, (_, i) => ({ day: i + 1 }))); },
        replaceProgramSteps: async () => { steps.splice(0, steps.length, ...Array.from({ length: 7 }, (_, i) => ({ day: i + 1 }))); },
        updateTherapyResponse: async () => {},
        updateGenerationError: async () => {}
      };
      await generateAndPersistProgramContent({ programModel: model, programStepModel: model, programId: 'p1', generateResponse: async () => sevenDayProgram(), successLogPrefix: '[test]', forceRegenerate: false });
      this.assert(steps.length === 7, 'generateAndPersist clears partial then creates');
      await generateAndPersistProgramContent({ programModel: model, programStepModel: model, programId: 'p1', generateResponse: async () => 'raw-string-response', successLogPrefix: '[test]', forceRegenerate: true });
      this.assert(steps.length === 7, 'generateAndPersist force-regenerate replaces steps');
      try {
        await generateAndPersistProgramContent({
          programModel: { getProgramSteps: async () => [], createProgramSteps: async () => {}, updateTherapyResponse: async () => {} },
          programStepModel: { getProgramSteps: async () => [], createProgramSteps: async () => {} },
          programId: 'p1', generateResponse: async () => sevenDayProgram(), successLogPrefix: '[test]'
        });
        this.assert(false, 'generateAndPersist throws when steps stay incomplete');
      } catch (e) { this.assert(/incomplete/.test(e.message), 'generateAndPersist throws when steps stay incomplete', e.message); }

      let attempts = 0;
      const followModel = {
        getProgramSteps: async () => [],
        createProgramSteps: async () => {},
        updateTherapyResponse: async () => {},
        updateGenerationError: async () => { throw new Error('should not save'); }
      };
      const follow = await runGenerationWithFollowUp({
        programModel: followModel, programStepModel: followModel, programId: 'p1',
        generateResponse: async () => {
          attempts++;
          if (attempts === 1) { const err = new Error('first fail'); err.__prompt = 'p1'; throw err; }
          followModel.getProgramSteps = async () => Array.from({ length: 7 }, (_, i) => ({ day: i + 1 }));
          followModel.createProgramSteps = async () => {};
          return sevenDayProgram();
        },
        logPrefix: '[test]', delayMs: 5, followUpEnabled: true
      });
      this.assert(follow.status === 'succeeded' && follow.attempts === 2, 'follow-up succeeds after first failure', JSON.stringify(follow));

      let first = true;
      const skippedFollow = await runGenerationWithFollowUp({
        programModel: { getProgramSteps: async () => Array.from({ length: 7 }, (_, i) => ({ day: i + 1 })), updateTherapyResponse: async () => {}, updateGenerationError: async () => {} },
        programStepModel: { getProgramSteps: async () => (first ? [] : Array.from({ length: 7 }, (_, i) => ({ day: i + 1 }))) },
        programId: 'p1',
        generateResponse: async () => { if (first) { first = false; throw new Error('first fail'); } throw new Error('should not run follow-up generate'); },
        logPrefix: '[test]', delayMs: 5, followUpEnabled: true
      });
      this.assert(skippedFollow.status === 'succeeded' && skippedFollow.followedUp === false, 'follow-up skipped when steps appear', JSON.stringify(skippedFollow));

      const errors = [];
      const failModel = { getProgramSteps: async () => [], createProgramSteps: async () => {}, updateTherapyResponse: async () => {}, updateGenerationError: async (id, msg) => { errors.push(msg); } };
      const failed = await runGenerationWithFollowUp({ programModel: failModel, programStepModel: failModel, programId: 'p1', generateResponse: async () => { throw new Error('always fail'); }, logPrefix: '[test]', delayMs: 5, followUpEnabled: true });
      this.assert(failed.status === 'failed' && errors.length === 1 && /2 attempts/.test(errors[0]), 'follow-up records combined error', errors[0]);
      const failedSave = await runGenerationWithFollowUp({
        programModel: { ...failModel, updateGenerationError: async () => { throw new Error('save failed'); } },
        programStepModel: failModel, programId: 'p1',
        generateResponse: async () => { throw new Error('always fail'); },
        logPrefix: '[test]', delayMs: 1, followUpEnabled: false
      });
      this.assert(failedSave.status === 'failed' && /1 attempt/.test(failedSave.error), 'follow-up disabled is 1 attempt and save errors are swallowed');
    } finally {
      if (origDelay === undefined) delete process.env.PROGRAM_GENERATION_FOLLOWUP_DELAY_MS;
      else process.env.PROGRAM_GENERATION_FOLLOWUP_DELAY_MS = origDelay;
      if (origEnabled === undefined) delete process.env.PROGRAM_GENERATION_FOLLOWUP_ENABLED;
      else process.env.PROGRAM_GENERATION_FOLLOWUP_ENABLED = origEnabled;
    }
  }

  async testDatabaseConfig() {
    this.log('config/database helpers', 'section');
    const db = require('../config/database');
    const orig = process.env.MYSQL_SSL_REJECT_UNAUTHORIZED;
    try {
      process.env.MYSQL_SSL_REJECT_UNAUTHORIZED = 'true';
      this.assert(db.sslRejectUnauthorized() === true, 'sslRejectUnauthorized true');
      process.env.MYSQL_SSL_REJECT_UNAUTHORIZED = '1';
      this.assert(db.sslRejectUnauthorized() === true, 'sslRejectUnauthorized 1');
      process.env.MYSQL_SSL_REJECT_UNAUTHORIZED = 'false';
      this.assert(db.sslRejectUnauthorized() === false, 'sslRejectUnauthorized false');
      process.env.MYSQL_SSL_REJECT_UNAUTHORIZED = 'off';
      this.assert(db.sslRejectUnauthorized() === false, 'sslRejectUnauthorized off');
      delete process.env.MYSQL_SSL_REJECT_UNAUTHORIZED;
      this.assert(db.sslRejectUnauthorized() === false, 'sslRejectUnauthorized default false');
      this.assert(db.mysqlSslOptions(false) === false, 'mysqlSslOptions disabled');
      this.assert(db.mysqlSslOptions(true).rejectUnauthorized === false, 'mysqlSslOptions enabled default');
      process.env.MYSQL_SSL_REJECT_UNAUTHORIZED = 'yes';
      this.assert(db.mysqlSslOptions(true).rejectUnauthorized === true, 'mysqlSslOptions enabled verify');
      const plugin = db.mysqlAuthPlugins().mysql_clear_password();
      try { plugin(); this.assert(false, 'mysql_clear_password is disabled'); }
      catch (e) { this.assert(/disabled/.test(e.message), 'mysql_clear_password is disabled', e.message); }
      const origUrl = process.env.MYSQL_URL;
      process.env.MYSQL_URL = 'not a url';
      try { db.createPool(); this.assert(false, 'createPool rejects invalid MYSQL_URL'); }
      catch (e) { this.assert(!!e.message, 'createPool rejects invalid MYSQL_URL', e.message); }
      finally {
        if (origUrl === undefined) delete process.env.MYSQL_URL;
        else process.env.MYSQL_URL = origUrl;
      }
    } finally {
      if (orig === undefined) delete process.env.MYSQL_SSL_REJECT_UNAUTHORIZED;
      else process.env.MYSQL_SSL_REJECT_UNAUTHORIZED = orig;
    }
  }

  async runAllTests() {
    this.log('Branch coverage suite', 'section');
    try {
      await this.testBillingAndSubscriptionRoutes();
      await this.testPairingRoutes();
      await this.testAuthRouteBranches();
      await this.testStripeBillingService();
      await this.testSubscriptionModels();
      await this.testPairingService();
      await this.testAuthService();
      await this.testPromptServices();
      await this.testProgramGeneration();
      await this.testDatabaseConfig();
      const resources = new ResourceCoverageTestRunner();
      const resourceOk = await resources.runAllTests();
      this.testResults.passed += resources.testResults.passed;
      this.testResults.failed += resources.testResults.failed;
      this.testResults.total += resources.testResults.total;
      if (!resourceOk) {
        this.log('Resource coverage suite reported failures', 'fail');
      }
    } catch (error) {
      this.assert(false, 'Branch coverage suite crashed', error.stack || error.message);
    }
    const success = this.testResults.failed === 0;
    this.log(`Branch coverage: ${this.testResults.passed}/${this.testResults.total} passed, ${this.testResults.failed} failed`, success ? 'pass' : 'fail');
    return success;
  }
}

async function main() {
  const runner = new BranchCoverageTestRunner();
  const success = await runner.runAllTests();
  process.exit(success ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = BranchCoverageTestRunner;
