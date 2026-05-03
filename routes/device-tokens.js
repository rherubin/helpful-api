const express = require('express');
const { createAuthenticateToken } = require('../middleware/auth');

const VALID_PLATFORMS = ['ios', 'android', 'web'];

function createDeviceTokenRoutes(deviceTokenModel, authService) {
  const router = express.Router();
  const authenticateToken = createAuthenticateToken(authService);

  // POST /api/device-tokens
  // Register a push notification device token for the authenticated user.
  // Body: { device_token: string, platform: 'ios' | 'android' | 'web' }
  // Returns 201 on first registration, 200 on re-registration (idempotent).
  router.post('/', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const { device_token: deviceToken, platform } = req.body;

      if (!deviceToken) {
        return res.status(400).json({ error: 'device_token is required' });
      }
      if (typeof deviceToken !== 'string') {
        return res.status(400).json({ error: 'device_token must be a string' });
      }
      if (!platform) {
        return res.status(400).json({ error: 'platform is required' });
      }
      if (!VALID_PLATFORMS.includes(platform)) {
        return res.status(400).json({ error: `Invalid platform. Must be one of: ${VALID_PLATFORMS.join(', ')}` });
      }

      const result = await deviceTokenModel.registerDeviceToken(userId, deviceToken, platform);

      res.status(result.isNew ? 201 : 200).json({
        device_token: {
          id: result.id,
          platform
        }
      });
    } catch (error) {
      console.error('Device token registration error:', error.message);
      if (error.message === 'User not found') {
        return res.status(404).json({ error: error.message });
      }
      if (error.message.includes('Invalid') || error.message.includes('Device token limit')) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to register device token' });
    }
  });

  // GET /api/device-tokens
  // Returns all device token records for the authenticated user.
  // Token strings are intentionally omitted; use the record `id` to delete.
  router.get('/', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const deviceTokens = await deviceTokenModel.getUserDeviceTokens(userId);
      res.status(200).json({
        device_tokens: deviceTokens,
        count: deviceTokens.length
      });
    } catch (error) {
      console.error('Get device tokens error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch device tokens' });
    }
  });

  // DELETE /api/device-tokens/:id
  // Remove a specific device token by its record ID.
  // Only deletes tokens owned by the authenticated user.
  router.delete('/:id', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const { id: tokenId } = req.params;

      const removed = await deviceTokenModel.removeDeviceToken(userId, tokenId);

      if (removed) {
        return res.status(200).json({ success: true });
      }
      return res.status(404).json({ error: 'Device token not found' });
    } catch (error) {
      console.error('Device token removal error:', error.message);
      return res.status(500).json({ error: 'Failed to remove device token' });
    }
  });

  return router;
}

module.exports = createDeviceTokenRoutes;
