const express = require('express');
const { createAuthenticateToken } = require('../middleware/auth');
const { StripeBillingError } = require('../services/StripeBillingService');

function createBillingRoutes(stripeBillingService, authService) {
  const router = express.Router();
  const authenticateToken = createAuthenticateToken(authService);

  // POST /api/billing/checkout
  // Body: { plan: 'monthly' | 'yearly', success_url?, cancel_url? }
  // Hosted Checkout redirect (legacy / optional). Prefer /subscription-intent for in-app Elements.
  router.post('/checkout', authenticateToken, async (req, res) => {
    try {
      const { plan, success_url, cancel_url } = req.body || {};
      const result = await stripeBillingService.createCheckoutSession(req.user.id, {
        plan,
        success_url,
        cancel_url
      });
      return res.status(200).json({
        message: 'Checkout session created',
        ...result
      });
    } catch (error) {
      console.error('Billing checkout error:', error.message);
      const status = error instanceof StripeBillingError ? error.status : 500;
      return res.status(status).json({ error: error.message || 'Failed to create checkout session' });
    }
  });

  // POST /api/billing/setup-intent
  // Returns client_secret for a stand-alone Stripe SetupIntent (no hosted
  // redirect). No subscription exists yet, so nothing is billed and no trial
  // has started — that only happens once /subscribe is called after this
  // SetupIntent is confirmed.
  router.post('/setup-intent', authenticateToken, async (req, res) => {
    try {
      const result = await stripeBillingService.createSetupIntent(req.user.id);
      return res.status(200).json({
        message: 'Setup intent created',
        ...result
      });
    } catch (error) {
      console.error('Billing setup-intent error:', error.message);
      const status = error instanceof StripeBillingError ? error.status : 500;
      return res.status(status).json({
        error: error.message || 'Failed to create setup intent',
        ...(error.code ? { code: error.code } : {})
      });
    }
  });

  // POST /api/billing/subscribe
  // Body: { plan: 'monthly' | 'yearly', setup_intent_id }
  // Creates the real subscription once the SetupIntent above has been
  // confirmed with a payment method — this is the only place the trial
  // clock starts.
  router.post('/subscribe', authenticateToken, async (req, res) => {
    try {
      const { plan, setup_intent_id } = req.body || {};
      const result = await stripeBillingService.finalizeSubscription(req.user.id, { plan, setup_intent_id });
      return res.status(200).json({
        message: 'Subscription created',
        ...result
      });
    } catch (error) {
      console.error('Billing subscribe error:', error.message);
      const status = error instanceof StripeBillingError ? error.status : 500;
      return res.status(status).json({
        error: error.message || 'Failed to create subscription',
        ...(error.code ? { code: error.code } : {})
      });
    }
  });

  // POST /api/billing/portal
  // Body: { return_url? }
  router.post('/portal', authenticateToken, async (req, res) => {
    try {
      const { return_url } = req.body || {};
      const result = await stripeBillingService.createPortalSession(req.user.id, { return_url });
      return res.status(200).json({
        message: 'Portal session created',
        ...result
      });
    } catch (error) {
      console.error('Billing portal error:', error.message);
      const status = error instanceof StripeBillingError ? error.status : 500;
      return res.status(status).json({ error: error.message || 'Failed to create portal session' });
    }
  });

  // GET /api/billing/status
  router.get('/status', authenticateToken, async (req, res) => {
    try {
      const status = await stripeBillingService.getStatus(req.user.id);
      return res.status(200).json({
        message: 'Billing status retrieved',
        ...status
      });
    } catch (error) {
      console.error('Billing status error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch billing status' });
    }
  });

  return router;
}

function createBillingWebhookHandler(stripeBillingService) {
  return async function billingWebhookHandler(req, res) {
    try {
      const signature = req.headers['stripe-signature'];
      if (!signature) {
        return res.status(400).json({ error: 'Missing stripe-signature header' });
      }

      const event = stripeBillingService.constructEvent(req.body, signature);
      await stripeBillingService.handleWebhookEvent(event);
      return res.status(200).json({ received: true });
    } catch (error) {
      console.error('Billing webhook error:', error.message);
      const status = error instanceof StripeBillingError ? error.status : 400;
      return res.status(status).json({ error: error.message || 'Webhook handler failed' });
    }
  };
}

module.exports = {
  createBillingRoutes,
  createBillingWebhookHandler
};
