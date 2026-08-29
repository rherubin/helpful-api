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

  // POST /api/billing/subscription-intent
  // Body: { plan: 'monthly' | 'yearly' }
  // Returns client_secret for Stripe Payment Element (no hosted redirect).
  router.post('/subscription-intent', authenticateToken, async (req, res) => {
    try {
      const { plan } = req.body || {};
      const result = await stripeBillingService.createSubscriptionIntent(req.user.id, { plan });
      return res.status(200).json({
        message: 'Subscription intent created',
        ...result
      });
    } catch (error) {
      console.error('Billing subscription-intent error:', error.message);
      const status = error instanceof StripeBillingError ? error.status : 500;
      return res.status(status).json({
        error: error.message || 'Failed to create subscription intent',
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
