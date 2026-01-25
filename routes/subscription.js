const express = require('express');
const { createAuthenticateToken } = require('../middleware/auth');
const { SubscriptionError } = require('../services/SubscriptionService');

function createSubscriptionRoutes(subscriptionService, authService) {
  const router = express.Router();
  const authenticateToken = createAuthenticateToken(authService);

  // POST /api/subscription - Submit a purchase receipt
  router.post('/', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const result = await subscriptionService.processReceipt(userId, req.body);
      const statusCode = result.subscription.created ? 201 : 200;

      res.status(statusCode).json({
        message: result.subscription.created
          ? 'Subscription receipt created successfully' 
          : 'Subscription receipt updated successfully',
        subscription: {
          id: result.subscription.id,
          platform: result.platform,
          product_id: result.subscription.product_id,
          is_active: result.isActive,
          expiration_date: result.subscription.expiration_date
        },
        premium_status: {
          active: result.isActive,
          pairings_updated: result.premiumUpdates.length
        }
      });

    } catch (error) {
      console.error('Subscription error:', error);
      if (error instanceof SubscriptionError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to process subscription receipt' });
    }
  });

  // GET /api/subscription - Get current user's subscription status
  router.get('/', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const status = await subscriptionService.getStatus(userId);
      res.status(200).json(status);

    } catch (error) {
      console.error('Get subscription error:', error);
      if (error.message === 'User not found') {
        return res.status(404).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to fetch subscription status' });
    }
  });

  // GET /api/subscription/receipts - Get all receipts for current user
  router.get('/receipts', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const receipts = await subscriptionService.getReceipts(userId);
      res.status(200).json({
        message: 'Receipts retrieved successfully',
        data: receipts
      });
    } catch (error) {
      console.error('Get subscription receipts error:', error);
      return res.status(500).json({ error: 'Failed to fetch subscription receipts' });
    }
  });

  return router;
}

module.exports = createSubscriptionRoutes;
