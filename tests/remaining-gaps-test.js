const http = require('http');
const express = require('express');
const axios = require('axios');
const { generateTestEmail } = require('./test-helpers');
const createAdminAuthRoutes = require('../routes/admin-auth');

/**
 * Remaining coverage gaps after the urgent-area sweep:
 *   - Admin auth HTTP (profile, refresh, logout, validation, user-token 403)
 *   - Production denial of open admin registration (isolated app)
 *   - Admin org-code CRUD, authz, validation, not-found
 *   - programs.js error/edge + next_program happy path (needs user_name)
 *   - HTTP invoice.payment_failed -> past_due -> premium off, then invoice.paid
 *
 * Run: node tests/remaining-gaps-test.js
 */
class RemainingGapsTestRunner {
  constructor(options = {}) {
    this.baseURL = options.baseURL || process.env.TEST_BASE_URL || 'http://127.0.0.1:9000';
    this.timeout = options.timeout || 20000;
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

  async request(method, path, { token, body, headers, baseURL } = {}) {
    return axios({
      method,
      url: `${baseURL || this.baseURL}${path}`,
      timeout: this.timeout,
      validateStatus: () => true,
      headers: {
        ...(headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      data: body
    });
  }

  async createUser(prefix, extra = {}) {
    const email = generateTestEmail(prefix);
    const res = await this.request('POST', '/api/users', {
      body: { email, password: this.password, ...extra }
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

  async createAdmin(prefix) {
    const email = generateTestEmail(prefix);
    const res = await this.request('POST', '/api/admin/auth/register', {
      body: { email, password: this.password }
    });
    if (![200, 201].includes(res.status) || !res.data?.access_token) {
      throw new Error(`createAdmin failed: status=${res.status} body=${JSON.stringify(res.data)}`);
    }
    return {
      id: res.data.user?.id,
      email,
      password: this.password,
      token: res.data.access_token,
      refresh_token: res.data.refresh_token
    };
  }

  postWebhook(event) {
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

  buildSubscription(user, { id, status = 'trialing', plan = 'yearly', customer } = {}) {
    const subId = id || `sub_rem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      id: subId,
      object: 'subscription',
      status,
      items: { data: [{ price: { id: process.env.STRIPE_PRICE_YEARLY || 'price_mock_yearly' } }] },
      trial_end: status === 'trialing' ? Math.floor(Date.now() / 1000) + 7 * 24 * 3600 : null,
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      cancel_at_period_end: status === 'canceled',
      metadata: { user_id: user.id, plan },
      customer: customer || `cus_rem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    };
  }

  async withEnv(overrides, fn) {
    const prev = {};
    for (const [key, value] of Object.entries(overrides)) {
      prev[key] = Object.prototype.hasOwnProperty.call(process.env, key)
        ? process.env[key]
        : undefined;
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      return await fn();
    } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  async listenApp(app) {
    const server = http.createServer(app);
    await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
    });
    const { port } = server.address();
    return {
      baseURL: `http://127.0.0.1:${port}`,
      close: () => new Promise((resolve) => server.close(() => resolve()))
    };
  }

  async testAdminAuthHttp() {
    this.log('Admin auth HTTP: login, profile, refresh, logout, authz', 'section');

    const missing = await this.request('POST', '/api/admin/auth/register', { body: {} });
    this.assert(missing.status === 400, 'Admin register without email/password → 400', `status=${missing.status}`);

    const badEmail = await this.request('POST', '/api/admin/auth/register', {
      body: { email: 'not-an-email', password: this.password }
    });
    this.assert(badEmail.status === 400, 'Admin register with invalid email → 400', `status=${badEmail.status}`);

    const admin = await this.createAdmin('rem-admin');
    this.assert(Boolean(admin.token && admin.refresh_token && admin.id), 'Admin register returns tokens and user id');

    const dup = await this.request('POST', '/api/admin/auth/register', {
      body: { email: admin.email, password: this.password }
    });
    this.assert(dup.status === 409, 'Duplicate admin email → 409', `status=${dup.status}`);

    const loginMissing = await this.request('POST', '/api/admin/auth/login', { body: {} });
    this.assert(loginMissing.status === 400, 'Admin login without credentials → 400', `status=${loginMissing.status}`);

    const badLogin = await this.request('POST', '/api/admin/auth/login', {
      body: { email: admin.email, password: 'WrongPassword1!' }
    });
    this.assert(badLogin.status === 401, 'Admin login with wrong password → 401', `status=${badLogin.status}`);
    this.assert(
      badLogin.data?.error === 'Invalid email or password',
      'Admin login uses a generic error',
      `error=${badLogin.data?.error}`
    );

    const login = await this.request('POST', '/api/admin/auth/login', {
      body: { email: admin.email, password: admin.password }
    });
    this.assert(login.status === 200 && login.data?.access_token, 'Admin login → 200 with access_token');
    this.assert(login.data?.user_type === 'admin', 'Admin login marks user_type admin', `type=${login.data?.user_type}`);
    const token = login.data.access_token;
    const refresh = login.data.refresh_token;

    const profile = await this.request('GET', '/api/admin/auth/profile', { token });
    this.assert(profile.status === 200, 'GET admin profile → 200', `status=${profile.status}`);
    this.assert(
      profile.data?.profile?.id === admin.id && profile.data?.profile?.email === admin.email,
      'Admin profile is the expected account',
      `id=${profile.data?.profile?.id}`
    );
    this.assert(
      profile.data?.profile?.password_hash === undefined,
      'Admin profile does not include password_hash'
    );

    const badUpdate = await this.request('PUT', '/api/admin/auth/profile', {
      token,
      body: { email: 'not-an-email' }
    });
    this.assert(badUpdate.status === 400, 'PUT admin profile invalid email → 400', `status=${badUpdate.status}`);

    const update = await this.request('PUT', '/api/admin/auth/profile', {
      token,
      body: { user_name: 'Ada Admin' }
    });
    this.assert(update.status === 200, 'PUT admin profile → 200', `status=${update.status}`);
    this.assert(
      update.data?.profile?.user_name === 'Ada Admin',
      'Updated admin profile includes user_name',
      `name=${update.data?.profile?.user_name}`
    );

    const refreshed = await this.request('POST', '/api/admin/auth/refresh', {
      body: { refresh_token: refresh }
    });
    this.assert(refreshed.status === 200 && refreshed.data?.access_token, 'Admin refresh → 200 with new access_token');
    this.assert(Boolean(refreshed.data?.refresh_token), 'Admin refresh rotates the refresh token');

    const missingRefresh = await this.request('POST', '/api/admin/auth/refresh', { body: {} });
    this.assert(missingRefresh.status === 400, 'Admin refresh without token → 400', `status=${missingRefresh.status}`);

    const badRefresh = await this.request('POST', '/api/admin/auth/refresh', {
      body: { refresh_token: 'not-a-token' }
    });
    this.assert(badRefresh.status === 401, 'Admin refresh with garbage token → 401', `status=${badRefresh.status}`);

    const user = await this.createUser('rem-admin-target');
    const userOnProfile = await this.request('GET', '/api/admin/auth/profile', { token: user.token });
    this.assert(
      [401, 403].includes(userOnProfile.status),
      'User JWT on GET /api/admin/auth/profile is denied',
      `status=${userOnProfile.status}`
    );
    const userOnUpdate = await this.request('PUT', '/api/admin/auth/profile', {
      token: user.token,
      body: { user_name: 'Nope' }
    });
    this.assert(
      [401, 403].includes(userOnUpdate.status),
      'User JWT on PUT /api/admin/auth/profile is denied',
      `status=${userOnUpdate.status}`
    );
    const userOnLogout = await this.request('POST', '/api/admin/auth/logout', { token: user.token });
    this.assert(
      [401, 403].includes(userOnLogout.status),
      'User JWT on POST /api/admin/auth/logout is denied',
      `status=${userOnLogout.status}`
    );

    const noAuthProfile = await this.request('GET', '/api/admin/auth/profile');
    this.assert([401, 403].includes(noAuthProfile.status), 'Unauthenticated admin profile → 401/403', `status=${noAuthProfile.status}`);

    const logout = await this.request('POST', '/api/admin/auth/logout', { token: refreshed.data.access_token });
    this.assert(logout.status === 200, 'Admin logout → 200', `status=${logout.status}`);
    this.assert(
      typeof logout.data?.message === 'string' && /logout/i.test(logout.data.message),
      'Admin logout confirms success',
      `message=${logout.data?.message}`
    );

    const reuse = await this.request('POST', '/api/admin/auth/refresh', {
      body: { refresh_token: refreshed.data.refresh_token }
    });
    this.assert(reuse.status === 401, 'Admin refresh after logout → 401', `status=${reuse.status}`);
  }

  async testAdminRegisterProductionGate() {
    this.log('Admin register production gate (isolated app)', 'section');

    const registerCalls = [];
    const adminUserModel = {
      count: 2,
      async countActiveAdminUsers() { return this.count; }
    };
    const adminAuthService = {
      async registerAdmin(email, password) {
        registerCalls.push({ email, password });
        return {
          message: 'Admin account created successfully',
          user: { id: 'admin_new', email },
          access_token: 'tok',
          refresh_token: 'ref'
        };
      }
    };

    await this.withEnv({
      RAILWAY_ENVIRONMENT_NAME: 'production',
      RAILWAY_ENVIRONMENT: undefined,
      ALLOW_ADMIN_REGISTRATION: 'true',
      TEST_MOCK_LLM: 'true',
      TEST_MOCK_STRIPE: 'true',
      ADMIN_REGISTRATION_SECRET: undefined
    }, async () => {
      const app = express();
      app.use(express.json());
      app.use('/api/admin/auth', createAdminAuthRoutes(adminAuthService, adminUserModel));
      const listener = await this.listenApp(app);
      try {
        const denied = await this.request('POST', '/api/admin/auth/register', {
          baseURL: listener.baseURL,
          body: { email: 'prod-admin@example.com', password: this.password }
        });
        this.assert(
          denied.status === 403,
          'Production ignores TEST_MOCK_* / ALLOW_ADMIN_REGISTRATION when admins already exist',
          `status=${denied.status} body=${JSON.stringify(denied.data)}`
        );
        this.assert(registerCalls.length === 0, 'Denied production register does not create an admin');

        adminUserModel.count = 0;
        const bootstrap = await this.request('POST', '/api/admin/auth/register', {
          baseURL: listener.baseURL,
          body: { email: 'first-admin@example.com', password: this.password }
        });
        this.assert(
          bootstrap.status === 201,
          'Production still allows bootstrap of the first admin',
          `status=${bootstrap.status}`
        );
      } finally {
        await listener.close();
      }
    });

    registerCalls.length = 0;
    adminUserModel.count = 3;
    await this.withEnv({
      RAILWAY_ENVIRONMENT_NAME: 'production',
      RAILWAY_ENVIRONMENT: undefined,
      ALLOW_ADMIN_REGISTRATION: undefined,
      TEST_MOCK_LLM: 'true',
      ADMIN_REGISTRATION_SECRET: 's3cret-admin-gate'
    }, async () => {
      const app = express();
      app.use(express.json());
      app.use('/api/admin/auth', createAdminAuthRoutes(adminAuthService, adminUserModel));
      const listener = await this.listenApp(app);
      try {
        const wrong = await this.request('POST', '/api/admin/auth/register', {
          baseURL: listener.baseURL,
          body: { email: 'wrong-secret@example.com', password: this.password, registration_secret: 'nope' }
        });
        this.assert(wrong.status === 403, 'Production register with the wrong secret → 403', `status=${wrong.status}`);

        const ok = await this.request('POST', '/api/admin/auth/register', {
          baseURL: listener.baseURL,
          headers: { 'x-admin-registration-secret': 's3cret-admin-gate' },
          body: { email: 'secret-admin@example.com', password: this.password }
        });
        this.assert(ok.status === 201, 'Production register with the matching secret → 201', `status=${ok.status}`);
        this.assert(registerCalls.length === 1, 'Matching secret actually registers the admin');
      } finally {
        await listener.close();
      }
    });
  }

  async testOrgCodeCrud() {
    this.log('Admin org-code CRUD, authz, validation, not-found', 'section');

    const admin = await this.createAdmin('rem-org-admin');
    const user = await this.createUser('rem-org-user');
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const code = `REMTST_${suffix}`;

    const unauth = await this.request('POST', '/api/org-codes', {
      body: { org_code: code, organization: 'Denied' }
    });
    this.assert([401, 403].includes(unauth.status), 'Create org code without auth is denied', `status=${unauth.status}`);

    const userCreate = await this.request('POST', '/api/org-codes', {
      token: user.token,
      body: { org_code: code, organization: 'Denied' }
    });
    this.assert(userCreate.status === 403, 'User JWT cannot create an org code', `status=${userCreate.status}`);

    const missingFields = await this.request('POST', '/api/org-codes', {
      token: admin.token,
      body: { organization: 'No Code' }
    });
    this.assert(missingFields.status === 400, 'Create org code without org_code → 400', `status=${missingFields.status}`);

    const created = await this.request('POST', '/api/org-codes', {
      token: admin.token,
      body: {
        org_code: code,
        organization: 'Remaining Gaps Org',
        city: 'Austin',
        state: 'TX',
        address1: '123 Secret St',
        initial_program_prompt: 'SECRET_PROMPT_INITIAL',
        next_program_prompt: 'SECRET_PROMPT_NEXT',
        therapy_response_prompt: 'SECRET_PROMPT_THERAPY'
      }
    });
    this.assert(created.status === 201, 'Admin creates org code → 201', `status=${created.status}`);
    const orgId = created.data?.org_code?.id;
    this.assert(Boolean(orgId), 'Create response includes org id');
    this.assert(
      created.data?.org_code?.org_code === code
        && created.data?.org_code?.initial_program_prompt === 'SECRET_PROMPT_INITIAL',
      'Admin create response includes the redeemable code and prompt fields'
    );

    const dup = await this.request('POST', '/api/org-codes', {
      token: admin.token,
      body: { org_code: code, organization: 'Duplicate' }
    });
    this.assert(dup.status === 400, 'Duplicate org_code → 400', `status=${dup.status}`);

    const adminGet = await this.request('GET', `/api/org-codes/${orgId}`, { token: admin.token });
    this.assert(adminGet.status === 200, 'Admin GET org code by id → 200', `status=${adminGet.status}`);
    this.assert(adminGet.data?.org_code?.org_code === code, 'Admin GET by id includes org_code');

    const userGetById = await this.request('GET', `/api/org-codes/${orgId}`, { token: user.token });
    this.assert(userGetById.status === 403, 'User JWT cannot GET org code by id', `status=${userGetById.status}`);
    this.assert(
      !JSON.stringify(userGetById.data || {}).includes(code),
      'Denied GET by id does not leak org_code'
    );

    const missing = await this.request('GET', '/api/org-codes/does-not-exist-id', { token: admin.token });
    this.assert(missing.status === 404, 'Admin GET missing org code → 404', `status=${missing.status}`);

    const userList = await this.request('GET', '/api/org-codes', { token: user.token });
    this.assert(userList.status === 200, 'User can list org directory metadata', `status=${userList.status}`);
    const listed = (userList.data?.org_codes || []).find((row) => row.id === orgId);
    this.assert(Boolean(listed), 'Created org appears in the public directory list');
    this.assert(
      listed && listed.org_code === undefined && listed.initial_program_prompt === undefined
        && listed.next_program_prompt === undefined && listed.therapy_response_prompt === undefined
        && listed.address1 === undefined && listed.city === undefined,
      'User list strips org_code, prompts, and address fields',
      `keys=${listed ? Object.keys(listed).join(',') : 'missing'}`
    );

    const adminList = await this.request('GET', '/api/org-codes', { token: admin.token });
    const adminListed = (adminList.data?.org_codes || []).find((row) => row.id === orgId);
    this.assert(
      adminListed && adminListed.org_code === code && adminListed.initial_program_prompt === 'SECRET_PROMPT_INITIAL',
      'Admin list includes org_code and prompt fields'
    );

    const userUpdate = await this.request('PUT', `/api/org-codes/${orgId}`, {
      token: user.token,
      body: { organization: 'Hacked' }
    });
    this.assert(userUpdate.status === 403, 'User JWT cannot update an org code', `status=${userUpdate.status}`);

    const updated = await this.request('PUT', `/api/org-codes/${orgId}`, {
      token: admin.token,
      body: { organization: 'Remaining Gaps Org Updated' }
    });
    this.assert(updated.status === 200, 'Admin updates org code → 200', `status=${updated.status}`);
    this.assert(
      updated.data?.org_code?.organization === 'Remaining Gaps Org Updated',
      'Update response reflects the new organization name'
    );

    const updateMissing = await this.request('PUT', '/api/org-codes/does-not-exist-id', {
      token: admin.token,
      body: { organization: 'Nope' }
    });
    this.assert(updateMissing.status === 404, 'Admin update missing org code → 404', `status=${updateMissing.status}`);

    const userAudit = await this.request('GET', '/api/org-codes/audit/org-linkages', { token: user.token });
    this.assert(userAudit.status === 403, 'User JWT cannot read org linkage audit', `status=${userAudit.status}`);

    const adminAudit = await this.request('GET', '/api/org-codes/audit/org-linkages?limit=5', { token: admin.token });
    this.assert(adminAudit.status === 200, 'Admin can read org linkage audit', `status=${adminAudit.status}`);
    this.assert(Array.isArray(adminAudit.data?.audit_logs), 'Audit response includes audit_logs array');

    const userDelete = await this.request('DELETE', `/api/org-codes/${orgId}`, { token: user.token });
    this.assert(userDelete.status === 403, 'User JWT cannot delete an org code', `status=${userDelete.status}`);

    const deleted = await this.request('DELETE', `/api/org-codes/${orgId}`, { token: admin.token });
    this.assert(deleted.status === 200, 'Admin deletes org code → 200', `status=${deleted.status}`);

    const afterDelete = await this.request('GET', `/api/org-codes/${orgId}`, { token: admin.token });
    this.assert(afterDelete.status === 404, 'Deleted org code GET → 404', `status=${afterDelete.status}`);

    const deleteMissing = await this.request('DELETE', '/api/org-codes/does-not-exist-id', { token: admin.token });
    this.assert(deleteMissing.status === 404, 'Admin delete missing org code → 404', `status=${deleteMissing.status}`);
  }

  async testProgramEdges() {
    this.log('Programs error/edge paths and next_program happy path', 'section');

    const owner = await this.createUser('rem-prog-owner');
    const outsider = await this.createUser('rem-prog-out');
    const admin = await this.createAdmin('rem-prog-admin');

    const unauthList = await this.request('GET', '/api/programs');
    this.assert([401, 403].includes(unauthList.status), 'GET /api/programs without auth is denied', `status=${unauthList.status}`);

    const unauthDelete = await this.request('DELETE', '/api/programs/whatever');
    this.assert([401, 403].includes(unauthDelete.status), 'DELETE /api/programs/:id without auth is denied', `status=${unauthDelete.status}`);

    const named = await this.request('PUT', `/api/users/${owner.id}`, {
      token: owner.token,
      body: { user_name: 'Riley' }
    });
    this.assert(named.status === 200, 'Owner profile can set user_name', `status=${named.status}`);

    const created = await this.request('POST', '/api/programs', {
      token: owner.token,
      body: { user_input: 'We want to communicate better' }
    });
    this.assert([200, 201].includes(created.status), 'Owner creates a program', `status=${created.status}`);
    const programId = created.data?.program?.id;
    this.assert(Boolean(programId), 'Create program returns an id');

    const nextProgram = await this.request('POST', `/api/programs/${programId}/next_program`, {
      token: owner.token,
      body: { user_input: 'Continue with trust and listening' }
    });
    this.assert(
      nextProgram.status === 201 && nextProgram.data?.program?.id,
      'next_program happy path → 201',
      `status=${nextProgram.status} body=${JSON.stringify(nextProgram.data)}`
    );
    this.assert(
      nextProgram.data?.program?.id !== programId,
      'next_program creates a distinct program',
      `next=${nextProgram.data?.program?.id}`
    );
    this.assert(
      nextProgram.data?.program?.previous_program_id === programId,
      'New program is linked to the previous one'
    );

    const metricsUser = await this.request('GET', '/api/programs/metrics', { token: owner.token });
    this.assert(metricsUser.status === 403, 'User JWT cannot read program metrics', `status=${metricsUser.status}`);

    const metricsAdmin = await this.request('GET', '/api/programs/metrics', { token: admin.token });
    this.assert(
      metricsAdmin.status === 200,
      'Admin JWT can read program metrics',
      `status=${metricsAdmin.status}`
    );

    const deleteMissing = await this.request('DELETE', '/api/programs/does-not-exist-id', { token: owner.token });
    this.assert(deleteMissing.status === 404, 'DELETE missing program → 404', `status=${deleteMissing.status}`);

    // therapy_response is posted against the original program (programId), not
    // the next_program. After mock generation completes the 7-day set, a second
    // request is a deterministic 409.
    const deadline = Date.now() + 10000;
    let stepsReady = false;
    while (Date.now() < deadline) {
      const peek = await this.request('GET', `/api/programs/${programId}`, { token: owner.token });
      const steps = peek.data?.program?.program_steps || peek.data?.program_steps || [];
      if (Array.isArray(steps) && steps.length >= 7) { stepsReady = true; break; }
      await new Promise((r) => setTimeout(r, 250));
    }
    this.assert(stepsReady, 'Original program finished generating its 7 steps before therapy_response');
    const therapy = await this.request('POST', `/api/programs/${programId}/therapy_response`, {
      token: owner.token
    });
    this.assert(
      therapy.status === 409,
      'Owner therapy_response is 409 once complete steps exist',
      `status=${therapy.status}`
    );

    const outsiderTherapy = await this.request('POST', `/api/programs/${programId}/therapy_response`, {
      token: outsider.token
    });
    this.assert(outsiderTherapy.status === 403, 'Outsider therapy_response → 403', `status=${outsiderTherapy.status}`);

    void outsider;
  }

  async testInvoicePaymentFailedHttp() {
    this.log('HTTP invoice.payment_failed → past_due → premium off, invoice.paid restores', 'section');

    const user = await this.createUser('rem-invoice');
    const sub = this.buildSubscription(user, { status: 'trialing' });

    const checkout = await this.postWebhook({
      id: `evt_rem_cs_${Date.now()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_rem_${Date.now()}`,
          mode: 'subscription',
          client_reference_id: user.id,
          customer: sub.customer,
          metadata: { user_id: user.id, plan: 'yearly' },
          subscription: sub
        }
      }
    });
    this.assert(checkout.status === 200, 'checkout.session.completed → 200', `status=${checkout.status}`);

    const afterCheckout = await this.request('GET', '/api/billing/status', { token: user.token });
    this.assert(
      afterCheckout.status === 200 && afterCheckout.data?.premium === true,
      'User is premium after checkout',
      `premium=${afterCheckout.data?.premium}`
    );

    const failedSub = { ...sub, status: 'past_due', trial_end: null };
    const failed = await this.postWebhook({
      id: `evt_rem_fail_${Date.now()}`,
      type: 'invoice.payment_failed',
      data: { object: { id: `in_rem_fail_${Date.now()}`, subscription: failedSub } }
    });
    this.assert(failed.status === 200, 'invoice.payment_failed → 200', `status=${failed.status}`);

    const afterFail = await this.request('GET', '/api/billing/status', { token: user.token });
    this.assert(
      afterFail.status === 200 && afterFail.data?.premium === false,
      'past_due from invoice.payment_failed clears premium',
      `premium=${afterFail.data?.premium} status=${afterFail.data?.subscription?.status}`
    );
    this.assert(
      afterFail.data?.subscription?.status === 'past_due',
      'Billing status reports past_due',
      `status=${afterFail.data?.subscription?.status}`
    );

    const paidSub = { ...sub, status: 'active', trial_end: null };
    const paid = await this.postWebhook({
      id: `evt_rem_paid_${Date.now()}`,
      type: 'invoice.paid',
      data: { object: { id: `in_rem_paid_${Date.now()}`, subscription: paidSub } }
    });
    this.assert(paid.status === 200, 'invoice.paid → 200', `status=${paid.status}`);

    const afterPaid = await this.request('GET', '/api/billing/status', { token: user.token });
    this.assert(
      afterPaid.status === 200 && afterPaid.data?.premium === true,
      'invoice.paid restores premium',
      `premium=${afterPaid.data?.premium}`
    );
    this.assert(
      afterPaid.data?.subscription?.status === 'active',
      'Billing status reports active after invoice.paid',
      `status=${afterPaid.data?.subscription?.status}`
    );
  }

  async runAllTests() {
    this.log('Remaining coverage gaps', 'section');
    this.testResults = { passed: 0, failed: 0, total: 0 };

    try {
      await this.testAdminRegisterProductionGate();
      await this.testAdminAuthHttp();
      await this.testOrgCodeCrud();
      await this.testProgramEdges();
      await this.testInvoicePaymentFailedHttp();
    } catch (error) {
      this.assert(false, 'Remaining gaps suite crashed', error.stack || error.message);
    }

    const success = this.testResults.failed === 0;
    this.log(
      `Remaining gaps: ${this.testResults.passed}/${this.testResults.total} passed, ${this.testResults.failed} failed`,
      success ? 'pass' : 'fail'
    );
    return success;
  }
}

async function main() {
  const runner = new RemainingGapsTestRunner();
  const success = await runner.runAllTests();
  process.exit(success ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = RemainingGapsTestRunner;
