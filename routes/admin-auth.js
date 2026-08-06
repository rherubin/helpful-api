const express = require('express');
const { createAuthenticateToken } = require('../middleware/auth');
const {
  loginLimiter,
  isAccountLocked,
  recordFailedAttempt,
  clearFailedAttempts,
  getAccountLockInfo,
  securityLogger
} = require('../middleware/security');

// Helper function to filter sensitive fields from admin user objects
function filterAdminUserData(user) {
  if (!user) return null;
  // Remove password_hash and premium (premium should be set explicitly as boolean)
  const { password_hash, premium, ...filteredUser } = user;
  return filteredUser;
}

function createAdminAuthRoutes(adminAuthService, adminUserModel) {
  const router = express.Router();
  const authenticateToken = createAuthenticateToken(adminAuthService);

  // Apply security logging to all admin auth routes
  router.use(securityLogger);

  // Admin login endpoint with security measures
  router.post('/login', loginLimiter, async (req, res) => {
    try {
      const { email, password } = req.body;

      // Validation
      if (!email || !password) {
        return res.status(400).json({
          error: 'Email and password are required'
        });
      }

      // Check if account is locked
      if (isAccountLocked(email)) {
        const lockInfo = getAccountLockInfo(email);
        return res.status(423).json({
          error: 'Account temporarily locked due to too many failed attempts',
          lockInfo: {
            remainingTime: Math.ceil(lockInfo.remainingTime / 1000 / 60), // minutes
            attemptCount: lockInfo.attemptCount
          }
        });
      }

      const result = await adminAuthService.loginAdmin(email, password);

      // Clear failed attempts on successful login
      clearFailedAttempts(email);

      res.status(200).json(result);
    } catch (error) {
      console.error('Admin login error:', error.message);

      // Record failed attempt (only if email was provided)
      if (email) {
        recordFailedAttempt(email);
      }

      if (error.message === 'Admin user not found' || error.message === 'Invalid email or password') {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      return res.status(500).json({ error: 'Login failed' });
    }
  });

  // Admin registration endpoint.
  // Open registration is an auth bypass in production — only allowed when:
  //   1) ALLOW_ADMIN_REGISTRATION=true (explicit opt-in for tests/dev), OR
  //   2) ADMIN_REGISTRATION_SECRET matches header/body, OR
  //   3) No active admins exist yet (one-time bootstrap).
  router.post('/register', async (req, res) => {
    try {
      const { email, password, registration_secret } = req.body;

      // Explicit opt-in, or common test-harness flags (never set on production).
      const allowOpen =
        process.env.ALLOW_ADMIN_REGISTRATION === 'true' ||
        process.env.TEST_MOCK_LLM === 'true' ||
        process.env.TEST_MOCK_STRIPE === 'true';
      const configuredSecret = process.env.ADMIN_REGISTRATION_SECRET || '';
      const providedSecret =
        req.get('x-admin-registration-secret') || registration_secret || '';
      const secretOk =
        configuredSecret.length > 0 &&
        providedSecret.length > 0 &&
        providedSecret === configuredSecret;

      if (!allowOpen && !secretOk) {
        let activeAdminCount = 0;
        try {
          activeAdminCount = await adminUserModel.countActiveAdminUsers();
        } catch (countError) {
          console.error('Admin registration gate count failed:', countError.message);
          return res.status(503).json({ error: 'Admin registration unavailable' });
        }
        if (activeAdminCount > 0) {
          return res.status(403).json({
            error: 'Admin registration is disabled. Set ALLOW_ADMIN_REGISTRATION=true or provide ADMIN_REGISTRATION_SECRET.'
          });
        }
        // activeAdminCount === 0 → allow bootstrap of the first admin.
      }

      // Validation
      if (!email || !password) {
        return res.status(400).json({
          error: 'Email and password are required'
        });
      }

      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          error: 'Invalid email format'
        });
      }

      const result = await adminAuthService.registerAdmin(email, password);

      res.status(201).json(result);
    } catch (error) {
      console.error('Admin registration error:', error.message);
      if (error.message === 'Email already exists') {
        return res.status(409).json({ error: 'Email already exists' });
      }
      if (error.message.includes('Password')) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Registration failed' });
    }
  });

  // Get admin user profile
  router.get('/profile', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;

      // Ensure this is an admin user token
      if (req.user.type !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const profile = await adminAuthService.getAdminProfile(userId);

      res.status(200).json({
        message: 'Admin profile retrieved successfully',
        profile: profile
      });
    } catch (error) {
      console.error('Admin profile error:', error.message);
      if (error.message === 'Admin user not found') {
        return res.status(404).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to fetch admin profile' });
    }
  });

  // Update admin user profile
  router.put('/profile', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;

      // Ensure this is an admin user token
      if (req.user.type !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const { email, user_name, partner_name, children } = req.body;

      // Validate email format if provided
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return res.status(400).json({
            error: 'Invalid email format'
          });
        }
      }

      const updatedProfile = await adminAuthService.updateAdminProfile(userId, {
        email,
        user_name,
        partner_name,
        children
      });

      res.status(200).json({
        message: 'Admin profile updated successfully',
        profile: updatedProfile
      });
    } catch (error) {
      console.error('Admin profile update error:', error.message);
      if (error.message === 'Admin user not found') {
        return res.status(404).json({ error: error.message });
      }
      if (error.message === 'Email already exists') {
        return res.status(409).json({ error: error.message });
      }
      if (error.message.includes('Children')) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to update admin profile' });
    }
  });

  // Token refresh endpoint for admin users
  router.post('/refresh', async (req, res) => {
    try {
      const { refresh_token } = req.body;

      if (!refresh_token) {
        return res.status(400).json({ error: 'Refresh token is required' });
      }

      const result = await adminAuthService.verifyAndRefreshTokens(null, refresh_token);

      res.status(200).json({
        message: 'Admin tokens refreshed successfully',
        ...result
      });
    } catch (error) {
      console.error('Admin token refresh error:', error.message);
      return res.status(401).json({ error: 'Token refresh failed' });
    }
  });

  // Admin logout endpoint
  router.post('/logout', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;

      // Ensure this is an admin user token
      if (req.user.type !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const result = await adminAuthService.logoutAdmin(userId);

      res.status(200).json(result);
    } catch (error) {
      console.error('Admin logout error:', error.message);
      return res.status(500).json({ error: 'Logout failed' });
    }
  });

  return router;
}

module.exports = createAdminAuthRoutes;