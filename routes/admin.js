const express = require('express');
const { createAuthenticateToken } = require('../middleware/auth');
const { adminActionLimiter } = require('../middleware/security');

function createAdminRoutes(adminAuthService, pushNotificationService, userModel) {
  const router = express.Router();
  const authenticateToken = createAuthenticateToken(adminAuthService);

  // Manually send a push notification to a specific user.
  // Useful for smoke-testing FCM credentials and device token registration.
  // POST /api/admin/push-test
  router.post('/push-test', adminActionLimiter, authenticateToken, async (req, res) => {
    try {
      if (req.user.type !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const { user_id, title, body, data } = req.body;

      if (!user_id) {
        return res.status(400).json({ error: 'user_id is required' });
      }
      if (!title && !body) {
        return res.status(400).json({ error: 'At least one of title or body is required' });
      }

      if (!pushNotificationService || !pushNotificationService.isConfigured()) {
        return res.status(503).json({
          error: 'Push notification service is not configured',
          details: 'Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH, or use TEST_MOCK_PUSH=true'
        });
      }

      // Verify the target user exists before attempting to send.
      if (userModel) {
        try {
          await userModel.getUserById(user_id);
        } catch {
          return res.status(404).json({ error: 'User not found' });
        }
      }

      const result = await pushNotificationService.sendToUser(user_id, {
        title: title || '',
        body: body || '',
        data: data || {}
      });

      res.status(200).json({
        message: 'Push notification sent',
        result
      });
    } catch (error) {
      console.error('[push-test] error:', error.message);
      return res.status(500).json({ error: 'Failed to send push notification' });
    }
  });

  return router;
}

module.exports = createAdminRoutes;
