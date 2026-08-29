const Stripe = require('stripe');

class StripeBillingError extends Error {
  constructor(message, { status = 400, code = null } = {}) {
    super(message);
    this.name = 'StripeBillingError';
    this.status = status;
    this.code = code;
  }
}

const VALID_PLANS = ['monthly', 'yearly'];
const PREMIUM_STATUSES = new Set(['trialing', 'active']);

function createMockStripe() {
  const customers = new Map();
  const sessionsById = new Map();
  // Include a process-unique prefix so restarts do not collide with leftover
  // users.unique_stripe_customer_id rows from earlier mock runs (cus_mock_1…).
  const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  let customerSeq = 0;
  let sessionSeq = 0;
  let subSeq = 0;

  return {
    customers: {
      create: async ({ email, metadata }) => {
        customerSeq += 1;
        const id = `cus_mock_${runId}_${customerSeq}`;
        const customer = { id, email, metadata: metadata || {} };
        customers.set(id, customer);
        return customer;
      },
      retrieve: async (id) => {
        const customer = customers.get(id);
        if (!customer) {
          const err = new Error('No such customer');
          err.statusCode = 404;
          throw err;
        }
        return customer;
      }
    },
    checkout: {
      sessions: {
        create: async (params) => {
          sessionSeq += 1;
          subSeq += 1;
          const session = {
            id: `cs_mock_${runId}_${sessionSeq}`,
            url: `https://checkout.stripe.com/c/pay/cs_mock_${runId}_${sessionSeq}`,
            mode: params.mode,
            status: 'open',
            client_reference_id: params.client_reference_id || null,
            metadata: params.metadata || {},
            subscription: `sub_mock_${runId}_${subSeq}`,
            customer: params.customer
          };
          sessionsById.set(session.id, session);
          return session;
        },
        list: async ({ customer, status, limit = 10 } = {}) => {
          let data = [...sessionsById.values()].filter((s) => s.customer === customer);
          if (status) data = data.filter((s) => s.status === status);
          return { data: data.slice(0, limit) };
        },
        // Test helpers: mark sessions complete so later checkouts are not stuck
        // behind forever-open mock sessions after webhook processing.
        complete: async (id) => {
          const stored = sessionsById.get(id);
          if (stored) stored.status = 'complete';
          return stored || null;
        },
        completeOpenForCustomer: async (customerId) => {
          if (!customerId) return 0;
          let count = 0;
          for (const session of sessionsById.values()) {
            if (session.customer === customerId && session.status === 'open') {
              session.status = 'complete';
              count += 1;
            }
          }
          return count;
        },
        retrieve: async (id, opts = {}) => {
          const stored = sessionsById.get(id);
          const base = stored || {
            id,
            mode: 'subscription',
            status: 'open',
            client_reference_id: null,
            metadata: {},
            customer: `cus_mock_${runId}_fallback`
          };
          return {
            ...base,
            subscription: typeof opts.expand?.[0] === 'string'
              ? {
                  id: typeof base.subscription === 'string' ? base.subscription : `sub_mock_${runId}_${subSeq || 1}`,
                  status: 'trialing',
                  items: {
                    data: [{ price: { id: process.env.STRIPE_PRICE_YEARLY || 'price_mock_yearly' } }]
                  },
                  trial_end: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
                  current_period_end: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
                  cancel_at_period_end: false,
                  metadata: base.metadata || {}
                }
              : (base.subscription || `sub_mock_${runId}_${subSeq || 1}`)
          };
        }
      }
    },
    billingPortal: {
      sessions: {
        create: async ({ customer, return_url }) => ({
          id: `bps_mock_${Date.now()}`,
          url: `https://billing.stripe.com/p/session/mock?customer=${customer}&return=${encodeURIComponent(return_url)}`
        })
      }
    },
    subscriptions: {
      _store: new Map(),
      create: async (params = {}) => {
        subSeq += 1;
        const id = `sub_mock_${runId}_${subSeq}`;
        const setupId = `seti_mock_${runId}_${subSeq}`;
        const priceId = params.items?.[0]?.price || process.env.STRIPE_PRICE_YEARLY || 'price_mock_yearly';
        const trialDays = Number(params.trial_period_days) || 0;
        const now = Math.floor(Date.now() / 1000);
        const sub = {
          id,
          status: trialDays > 0 ? 'incomplete' : 'incomplete',
          items: { data: [{ price: { id: priceId } }] },
          trial_end: trialDays > 0 ? now + trialDays * 24 * 3600 : null,
          current_period_end: now + (trialDays > 0 ? trialDays : 30) * 24 * 3600,
          cancel_at_period_end: false,
          metadata: params.metadata || {},
          customer: params.customer,
          pending_setup_intent: trialDays > 0
            ? {
                id: setupId,
                object: 'setup_intent',
                client_secret: `${setupId}_secret_mock`,
                status: 'requires_payment_method'
              }
            : null,
          latest_invoice: trialDays > 0
            ? null
            : {
                id: `in_mock_${runId}_${subSeq}`,
                payment_intent: {
                  id: `pi_mock_${runId}_${subSeq}`,
                  client_secret: `pi_mock_${runId}_${subSeq}_secret_mock`,
                  status: 'requires_payment_method'
                }
              }
        };
        return sub;
      },
      list: async ({ customer, status, limit = 10 } = {}) => {
        // Minimal list support for canceling incompletes; empty in mock by default.
        void customer;
        void status;
        void limit;
        return { data: [] };
      },
      retrieve: async (id) => ({
        id,
        status: 'trialing',
        items: {
          data: [{ price: { id: process.env.STRIPE_PRICE_YEARLY || 'price_mock_yearly' } }]
        },
        trial_end: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
        current_period_end: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
        cancel_at_period_end: false,
        metadata: {},
        customer: `cus_mock_${runId}_fallback`
      }),
      cancel: async (id) => ({
        id,
        status: 'canceled',
        items: {
          data: [{ price: { id: process.env.STRIPE_PRICE_YEARLY || 'price_mock_yearly' } }]
        },
        trial_end: null,
        current_period_end: Math.floor(Date.now() / 1000),
        cancel_at_period_end: false,
        metadata: {},
        customer: `cus_mock_${runId}_fallback`
      }),
      update: async (id, params = {}) => ({
        id,
        status: 'active',
        items: {
          data: [{ price: { id: process.env.STRIPE_PRICE_YEARLY || 'price_mock_yearly' } }]
        },
        trial_end: null,
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
        cancel_at_period_end: !!params.cancel_at_period_end,
        metadata: {},
        customer: `cus_mock_${runId}_fallback`
      })
    },
    webhooks: {
      constructEvent: (payload, signature, secret) => {
        if (!signature || !secret) {
          throw new Error('Missing stripe webhook signature or secret');
        }
        const body = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
        return JSON.parse(body);
      }
    }
  };
}

class StripeBillingService {
  constructor(userModel, stripeSubscriptionModel, options = {}) {
    this.userModel = userModel;
    this.stripeSubscriptionModel = stripeSubscriptionModel;
    this.trialPeriodDays = Number(process.env.STRIPE_TRIAL_PERIOD_DAYS || 7);
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    this.priceIds = {
      monthly: process.env.STRIPE_PRICE_MONTHLY || '',
      yearly: process.env.STRIPE_PRICE_YEARLY || ''
    };
    this.defaultSuccessUrl = process.env.STRIPE_CHECKOUT_SUCCESS_URL
      || 'http://localhost:3000/get-started?billing=success';
    this.defaultCancelUrl = process.env.STRIPE_CHECKOUT_CANCEL_URL
      || 'http://localhost:3000/get-started?billing=cancel';
    this.defaultPortalReturnUrl = process.env.STRIPE_PORTAL_RETURN_URL
      || 'http://localhost:3000/get-started?flow=subscription';
    this.allowedOrigins = (process.env.STRIPE_CHECKOUT_ALLOWED_ORIGINS
      || process.env.WEB_APP_ORIGIN
      || 'http://localhost:3000')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const useMock = options.useMock
      || process.env.TEST_MOCK_STRIPE === 'true'
      || !process.env.STRIPE_SECRET_KEY;

    if (useMock && !process.env.STRIPE_SECRET_KEY) {
      console.warn('[stripe-billing] STRIPE_SECRET_KEY unset — using mock Stripe client');
    }

    this.stripe = options.stripeClient
      || (useMock && !process.env.STRIPE_SECRET_KEY
        ? createMockStripe()
        : (process.env.TEST_MOCK_STRIPE === 'true'
          ? createMockStripe()
          : new Stripe(process.env.STRIPE_SECRET_KEY)));

    this.isMock = !!(options.stripeClient || useMock);
  }

  isConfigured() {
    if (process.env.TEST_MOCK_STRIPE === 'true' || this.isMock) return true;
    return Boolean(
      process.env.STRIPE_SECRET_KEY
      && this.priceIds.monthly
      && this.priceIds.yearly
    );
  }

  assertConfigured() {
    if (this.isMock || process.env.TEST_MOCK_STRIPE === 'true' || !process.env.STRIPE_SECRET_KEY) {
      this.priceIds.monthly = this.priceIds.monthly || 'price_mock_monthly';
      this.priceIds.yearly = this.priceIds.yearly || 'price_mock_yearly';
      return;
    }
    if (!this.priceIds.monthly || !this.priceIds.yearly) {
      throw new StripeBillingError('Stripe price IDs are not configured', { status: 503 });
    }
  }

  normalizePlan(plan) {
    const value = String(plan || '').toLowerCase();
    if (!VALID_PLANS.includes(value)) {
      throw new StripeBillingError(`Invalid plan. Must be one of: ${VALID_PLANS.join(', ')}`);
    }
    return value;
  }

  priceIdForPlan(plan) {
    const priceId = this.priceIds[plan];
    if (!priceId) {
      throw new StripeBillingError(`No Stripe price configured for plan: ${plan}`, { status: 503 });
    }
    return priceId;
  }

  planForPriceId(priceId) {
    if (!priceId) return null;
    if (priceId === this.priceIds.monthly || priceId === 'price_mock_monthly') return 'monthly';
    if (priceId === this.priceIds.yearly || priceId === 'price_mock_yearly') return 'yearly';
    return null;
  }

  isUrlAllowed(urlString) {
    try {
      const url = new URL(urlString);
      const origin = `${url.protocol}//${url.host}`;
      return this.allowedOrigins.includes(origin);
    } catch {
      return false;
    }
  }

  resolveCheckoutUrls({ success_url, cancel_url } = {}) {
    const successUrl = success_url || this.defaultSuccessUrl;
    const cancelUrl = cancel_url || this.defaultCancelUrl;
    if (!this.isUrlAllowed(successUrl) || !this.isUrlAllowed(cancelUrl)) {
      throw new StripeBillingError('Checkout return URL origin is not allowed');
    }
    return { successUrl, cancelUrl };
  }

  resolvePortalReturnUrl(return_url) {
    const returnUrl = return_url || this.defaultPortalReturnUrl;
    if (!this.isUrlAllowed(returnUrl)) {
      throw new StripeBillingError('Portal return URL origin is not allowed');
    }
    return returnUrl;
  }

  async ensureStripeCustomer(user) {
    if (user.stripe_customer_id) {
      return user.stripe_customer_id;
    }

    const customer = await this.stripe.customers.create({
      email: user.email,
      metadata: { user_id: user.id }
    });

    await this.userModel.updateUser(user.id, { stripe_customer_id: customer.id });
    return customer.id;
  }

  async createCheckoutSession(userId, { plan, success_url, cancel_url } = {}) {
    this.assertConfigured();
    const normalizedPlan = this.normalizePlan(plan);
    const { successUrl, cancelUrl } = this.resolveCheckoutUrls({ success_url, cancel_url });
    const priceId = this.priceIdForPlan(normalizedPlan);

    // Serialize checkout creation per user. getActiveForUser alone is not enough:
    // Checkout sessions exist before webhooks write stripe_subscriptions, so two
    // POSTs before completion can both pass the DB check and double-bill.
    const conn = await this.userModel.db.getConnection();
    try {
      await conn.beginTransaction();

      const [userRows] = await conn.execute(
        'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
        [userId]
      );
      const user = userRows[0];
      if (!user) {
        throw new StripeBillingError('User not found', { status: 404 });
      }

      const [activeRows] = await conn.execute(
        `SELECT id FROM stripe_subscriptions
         WHERE user_id = ? AND status IN ('trialing', 'active')
         LIMIT 1`,
        [userId]
      );
      if (activeRows.length > 0) {
        throw new StripeBillingError(
          'An active Stripe subscription already exists. Use the billing portal to manage it.',
          { status: 409, code: 'subscription_already_active' }
        );
      }

      let customerId = user.stripe_customer_id;
      if (!customerId) {
        const customer = await this.stripe.customers.create({
          email: user.email,
          metadata: { user_id: userId }
        });
        customerId = customer.id;
        await conn.execute(
          'UPDATE users SET stripe_customer_id = ?, updated_at = NOW() WHERE id = ?',
          [customerId, userId]
        );
      }

      // Block while Stripe still has an open Checkout for this customer.
      if (typeof this.stripe.checkout?.sessions?.list === 'function') {
        const openSessions = await this.stripe.checkout.sessions.list({
          customer: customerId,
          status: 'open',
          limit: 1
        });
        if (openSessions?.data?.length) {
          throw new StripeBillingError(
            'A checkout session is already open. Complete or abandon it before starting another, or use the billing portal.',
            { status: 409, code: 'checkout_already_open' }
          );
        }
      }

      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: userId,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: {
          trial_period_days: this.trialPeriodDays,
          metadata: {
            user_id: userId,
            plan: normalizedPlan
          }
        },
        metadata: {
          user_id: userId,
          plan: normalizedPlan
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: true
      });

      await conn.commit();

      return {
        url: session.url,
        session_id: session.id,
        plan: normalizedPlan
      };
    } catch (error) {
      try {
        await conn.rollback();
      } catch (_) {
        /* ignore rollback errors */
      }
      throw error;
    } finally {
      conn.release();
    }
  }

  /**
   * Create an incomplete Stripe subscription and return a client_secret for
   * Payment Element (SetupIntent during trial, PaymentIntent otherwise).
   * Keeps the buyer on the Sit Together UI — no hosted Checkout redirect.
   */
  async createSubscriptionIntent(userId, { plan } = {}) {
    this.assertConfigured();
    const normalizedPlan = this.normalizePlan(plan);
    const priceId = this.priceIdForPlan(normalizedPlan);

    const conn = await this.userModel.db.getConnection();
    try {
      await conn.beginTransaction();

      const [userRows] = await conn.execute(
        'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
        [userId]
      );
      const user = userRows[0];
      if (!user) {
        throw new StripeBillingError('User not found', { status: 404 });
      }

      const [activeRows] = await conn.execute(
        `SELECT id FROM stripe_subscriptions
         WHERE user_id = ? AND status IN ('trialing', 'active')
         LIMIT 1`,
        [userId]
      );
      if (activeRows.length > 0) {
        throw new StripeBillingError(
          'An active Stripe subscription already exists. Use the billing portal to manage it.',
          { status: 409, code: 'subscription_already_active' }
        );
      }

      let customerId = user.stripe_customer_id;
      if (!customerId) {
        const customer = await this.stripe.customers.create({
          email: user.email,
          metadata: { user_id: userId }
        });
        customerId = customer.id;
        await conn.execute(
          'UPDATE users SET stripe_customer_id = ?, updated_at = NOW() WHERE id = ?',
          [customerId, userId]
        );
      }

      // Cancel leftover incomplete subscriptions so Elements can start clean.
      if (typeof this.stripe.subscriptions?.list === 'function') {
        try {
          const incomplete = await this.stripe.subscriptions.list({
            customer: customerId,
            status: 'incomplete',
            limit: 10
          });
          for (const sub of incomplete.data || []) {
            try {
              await this.stripe.subscriptions.cancel(sub.id);
            } catch (_) {
              /* best-effort */
            }
          }
        } catch (_) {
          /* list may be unavailable on older mocks */
        }
      }

      const createParams = {
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription'
        },
        metadata: {
          user_id: userId,
          plan: normalizedPlan
        },
        expand: ['latest_invoice.payment_intent', 'pending_setup_intent']
      };
      if (this.trialPeriodDays > 0) {
        createParams.trial_period_days = this.trialPeriodDays;
      }

      const subscription = await this.stripe.subscriptions.create(createParams);

      await conn.commit();

      // Persist incomplete row so webhooks/cron have a record (after commit).
      try {
        await this.stripeSubscriptionModel.upsertByStripeSubscriptionId(userId, {
          stripe_subscription_id: subscription.id,
          stripe_price_id: priceId,
          plan: normalizedPlan,
          status: subscription.status || 'incomplete',
          trial_end: subscription.trial_end || null,
          current_period_end: subscription.current_period_end || null,
          cancel_at_period_end: !!subscription.cancel_at_period_end
        });
      } catch (persistErr) {
        console.warn('[stripe-billing] failed to persist incomplete subscription row:', persistErr.message);
      }

      const setupSecret = subscription.pending_setup_intent?.client_secret || null;
      const paymentSecret = subscription.latest_invoice?.payment_intent?.client_secret || null;
      const clientSecret = setupSecret || paymentSecret;
      if (!clientSecret) {
        throw new StripeBillingError(
          'Stripe did not return a client_secret for Payment Element',
          { status: 502 }
        );
      }

      return {
        client_secret: clientSecret,
        mode: setupSecret ? 'setup' : 'payment',
        subscription_id: subscription.id,
        plan: normalizedPlan
      };
    } catch (error) {
      try {
        await conn.rollback();
      } catch (_) {
        /* ignore */
      }
      throw error;
    } finally {
      conn.release();
    }
  }

  async createPortalSession(userId, { return_url } = {}) {
    this.assertConfigured();
    const returnUrl = this.resolvePortalReturnUrl(return_url);
    const user = await this.userModel.getUserById(userId);
    if (!user.stripe_customer_id) {
      throw new StripeBillingError('No Stripe customer for this account', { status: 400 });
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: returnUrl
    });

    return { url: session.url };
  }

  async getStatus(userId) {
    const user = await this.userModel.getUserById(userId);
    const subscription = await this.stripeSubscriptionModel.getLatestForUser(userId);
    const active = subscription && PREMIUM_STATUSES.has(subscription.status);

    return {
      premium: !!(active || user.is_premium),
      is_premium: !!user.is_premium,
      stripe_customer_id: user.stripe_customer_id || null,
      subscription: subscription
        ? {
            plan: subscription.plan,
            status: subscription.status,
            stripe_subscription_id: subscription.stripe_subscription_id,
            stripe_price_id: subscription.stripe_price_id,
            trial_end: subscription.trial_end,
            current_period_end: subscription.current_period_end,
            cancel_at_period_end: !!subscription.cancel_at_period_end
          }
        : null
    };
  }

  // Mirror routes/users.js: org_code_id OR complete custom org fields grant premium
  // independently of Stripe. Must not be wiped when a Stripe sub lapses.
  premiumEntitledFromOrg(user) {
    if (!user) return false;
    if (user.org_code_id) return true;
    const hasNonEmptyText = (value) =>
      typeof value === 'string' && value.trim().length > 0;
    return hasNonEmptyText(user.org_name)
      && hasNonEmptyText(user.org_city)
      && hasNonEmptyText(user.org_state);
  }

  async syncPremiumForUser(userId) {
    const active = await this.stripeSubscriptionModel.getActiveForUser(userId);
    // Soft-deleted users still own Stripe customers/subscriptions. Webhooks must
    // reconcile is_premium while deleted_at IS NOT NULL — getUserById would throw
    // and leave billed users without (or with stale) premium after restore.
    const user = await this.userModel.getUserByIdIncludingDeleted(userId);
    const shouldBePremium = !!active || this.premiumEntitledFromOrg(user);
    await this.userModel.setIsPremium(userId, shouldBePremium);
    return shouldBePremium;
  }

  extractSubscriptionFields(stripeSubscription, fallbackPlan = null) {
    const priceId = stripeSubscription?.items?.data?.[0]?.price?.id
      || stripeSubscription?.plan?.id
      || null;
    const plan = stripeSubscription?.metadata?.plan
      || this.planForPriceId(priceId)
      || fallbackPlan
      || 'yearly';

    return {
      stripe_subscription_id: stripeSubscription.id,
      stripe_price_id: priceId,
      plan,
      status: stripeSubscription.status,
      trial_end: stripeSubscription.trial_end || null,
      current_period_end: stripeSubscription.current_period_end || null,
      cancel_at_period_end: !!stripeSubscription.cancel_at_period_end
    };
  }

  async resolveUserIdFromSubscription(stripeSubscription, fallbackUserId = null) {
    if (fallbackUserId) return fallbackUserId;
    if (stripeSubscription?.metadata?.user_id) return stripeSubscription.metadata.user_id;

    const customerId = typeof stripeSubscription.customer === 'string'
      ? stripeSubscription.customer
      : stripeSubscription.customer?.id;
    if (customerId) {
      const user = await this.userModel.getUserByStripeCustomerIdIncludingDeleted(customerId);
      if (user) return user.id;
    }

    const existing = await this.stripeSubscriptionModel.getByStripeSubscriptionId(stripeSubscription.id);
    return existing?.user_id || null;
  }

  async applyStripeSubscription(stripeSubscription, { userId = null, plan = null } = {}) {
    const resolvedUserId = await this.resolveUserIdFromSubscription(stripeSubscription, userId);
    if (!resolvedUserId) {
      console.warn('[stripe-billing] Skipping subscription sync — no user_id mapping', stripeSubscription.id);
      return null;
    }

    const fields = this.extractSubscriptionFields(stripeSubscription, plan);

    // Stripe may deliver customer.subscription.updated after
    // customer.subscription.deleted (retries / out-of-order). A canceled
    // subscription cannot be reactivated on the same Stripe id — ignore any
    // non-terminal payload so stale updates cannot resurrect premium.
    const TERMINAL_STATUSES = new Set(['canceled', 'incomplete_expired']);
    if (fields.stripe_subscription_id && TERMINAL_STATUSES.has(String(fields.status)) === false) {
      const existing = await this.stripeSubscriptionModel.getByStripeSubscriptionId(
        fields.stripe_subscription_id
      );
      if (existing && TERMINAL_STATUSES.has(String(existing.status))) {
        console.warn(
          '[stripe-billing] Ignoring stale non-terminal webhook for terminal subscription',
          fields.stripe_subscription_id,
          `existing=${existing.status}`,
          `incoming=${fields.status}`
        );
        await this.syncPremiumForUser(resolvedUserId);
        return existing;
      }
    }

    const row = await this.stripeSubscriptionModel.upsertByStripeSubscriptionId(resolvedUserId, fields);
    await this.syncPremiumForUser(resolvedUserId);
    return row;
  }

  async handleCheckoutSessionCompleted(session) {
    const userId = session.client_reference_id || session.metadata?.user_id || null;
    const plan = session.metadata?.plan || null;

    // Mark mock Checkout sessions complete so a later re-subscribe is not
    // blocked by a forever-open session left over from the first checkout.
    // Webhook fixtures may use a different session id than the one create()
    // returned, so also clear by customer.
    try {
      if (session?.id && typeof this.stripe.checkout?.sessions?.complete === 'function') {
        await this.stripe.checkout.sessions.complete(session.id);
      }
      const customerId = typeof session?.customer === 'string'
        ? session.customer
        : session?.customer?.id;
      if (customerId && typeof this.stripe.checkout?.sessions?.completeOpenForCustomer === 'function') {
        await this.stripe.checkout.sessions.completeOpenForCustomer(customerId);
      }
      // Fall back: complete open sessions for the mapped user customer.
      const mappedUserId = session?.client_reference_id || session?.metadata?.user_id || null;
      if (mappedUserId && typeof this.stripe.checkout?.sessions?.completeOpenForCustomer === 'function') {
        const mappedUser = await this.userModel.getUserById(mappedUserId).catch(() => null);
        if (mappedUser?.stripe_customer_id) {
          await this.stripe.checkout.sessions.completeOpenForCustomer(mappedUser.stripe_customer_id);
        }
      }
    } catch (_) {
      /* non-fatal */
    }

    let stripeSubscription = session.subscription;
    if (typeof stripeSubscription === 'string') {
      stripeSubscription = await this.stripe.subscriptions.retrieve(stripeSubscription);
    } else if (!stripeSubscription && session.id) {
      const expanded = await this.stripe.checkout.sessions.retrieve(session.id, {
        expand: ['subscription']
      });
      stripeSubscription = expanded.subscription;
      if (typeof stripeSubscription === 'string') {
        stripeSubscription = await this.stripe.subscriptions.retrieve(stripeSubscription);
      }
    }

    if (!stripeSubscription) {
      console.warn('[stripe-billing] checkout.session.completed without subscription', session.id);
      return null;
    }

    if (userId && session.customer && typeof session.customer === 'string') {
      const user = await this.userModel.getUserById(userId).catch(() => null);
      if (user && !user.stripe_customer_id) {
        await this.userModel.updateUser(userId, { stripe_customer_id: session.customer });
      }
    }

    return this.applyStripeSubscription(stripeSubscription, { userId, plan });
  }

  // Cancel every trialing/active Stripe subscription for a user. Used on account
  // soft-delete so deleted accounts are not left billed with no in-app premium.
  async cancelActiveSubscriptionsForUser(userId) {
    let activeRows = [];
    if (typeof this.stripeSubscriptionModel.getAllActiveForUser === 'function') {
      activeRows = await this.stripeSubscriptionModel.getAllActiveForUser(userId);
    } else {
      const one = await this.stripeSubscriptionModel.getActiveForUser(userId);
      activeRows = one ? [one] : [];
    }

    const canceledIds = [];
    for (const row of activeRows) {
      if (!row?.stripe_subscription_id) continue;
      try {
        let stripeSubscription;
        if (typeof this.stripe.subscriptions.cancel === 'function') {
          stripeSubscription = await this.stripe.subscriptions.cancel(row.stripe_subscription_id);
        } else {
          stripeSubscription = await this.stripe.subscriptions.retrieve(row.stripe_subscription_id);
          stripeSubscription = { ...stripeSubscription, status: 'canceled' };
        }
        if (!stripeSubscription.metadata) stripeSubscription.metadata = {};
        if (!stripeSubscription.metadata.user_id) {
          stripeSubscription.metadata.user_id = userId;
        }
        await this.applyStripeSubscription(stripeSubscription, { userId, plan: row.plan });
        canceledIds.push(row.stripe_subscription_id);
      } catch (err) {
        console.warn(
          `[stripe-billing] Failed to cancel subscription ${row.stripe_subscription_id} for user ${userId}:`,
          err.message
        );
      }
    }
    return canceledIds;
  }

  async handleSubscriptionEvent(stripeSubscription) {
    return this.applyStripeSubscription(stripeSubscription);
  }

  async handleInvoicePaymentFailed(invoice) {
    const subscriptionId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription?.id;
    if (!subscriptionId) return null;

    const stripeSubscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    return this.applyStripeSubscription(stripeSubscription);
  }

  async handleInvoicePaid(invoice) {
    const subscriptionId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription?.id;
    if (!subscriptionId) return null;

    const stripeSubscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    return this.applyStripeSubscription(stripeSubscription);
  }

  /**
   * Re-fetch open/local subscriptions from Stripe and sync premium.
   * Safety net when webhooks are delayed or missed (failed renewals, cancels).
   */
  async reconcileSubscriptions({ limit = 50 } = {}) {
    if (!this.isConfigured() && process.env.TEST_MOCK_STRIPE !== 'true') {
      return { checked: 0, updated: 0, skipped: true };
    }

    const rows = await this.stripeSubscriptionModel.listForReconcile(limit);
    let updated = 0;
    let errors = 0;

    for (const row of rows) {
      try {
        const stripeSubscription = await this.stripe.subscriptions.retrieve(
          row.stripe_subscription_id
        );
        await this.applyStripeSubscription(stripeSubscription, {
          userId: row.user_id,
          plan: row.plan
        });
        updated += 1;
      } catch (err) {
        errors += 1;
        console.warn(
          '[stripe-billing] reconcile failed for',
          row.stripe_subscription_id,
          err.message
        );
      }
    }

    return { checked: rows.length, updated, errors };
  }

  constructEvent(rawBody, signature) {
    // Mock Stripe (used when STRIPE_SECRET_KEY is unset) does not verify signatures.
    // Only allow that insecure path when tests explicitly opt in via TEST_MOCK_STRIPE.
    // Otherwise a publicly reachable API without Stripe keys would accept forged
    // webhooks and grant arbitrary users premium.
    if (!process.env.STRIPE_SECRET_KEY && process.env.TEST_MOCK_STRIPE !== 'true') {
      throw new StripeBillingError(
        'Stripe webhooks disabled: configure STRIPE_SECRET_KEY (or TEST_MOCK_STRIPE=true for tests)',
        { status: 503 }
      );
    }
    if (!this.webhookSecret && process.env.TEST_MOCK_STRIPE !== 'true' && process.env.STRIPE_SECRET_KEY) {
      throw new StripeBillingError('STRIPE_WEBHOOK_SECRET is not configured', { status: 503 });
    }
    const secret = this.webhookSecret || 'whsec_mock_secret';
    try {
      return this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      throw new StripeBillingError(`Webhook signature verification failed: ${err.message}`, { status: 400 });
    }
  }

  async handleWebhookEvent(event) {
    switch (event.type) {
      case 'checkout.session.completed':
        return this.handleCheckoutSessionCompleted(event.data.object);
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        return this.handleSubscriptionEvent(event.data.object);
      case 'invoice.payment_failed':
        return this.handleInvoicePaymentFailed(event.data.object);
      case 'invoice.paid':
        return this.handleInvoicePaid(event.data.object);
      default:
        return null;
    }
  }
}

module.exports = {
  StripeBillingService,
  StripeBillingError,
  createMockStripe,
  VALID_PLANS,
  PREMIUM_STATUSES
};
